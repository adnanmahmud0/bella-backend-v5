import { Router } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import Joi from 'joi';

const router = Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

// Validation schemas
const createSubscriptionSchema = Joi.object({
  planId: Joi.number().required(),
  paymentMethodId: Joi.string().optional(),
});

const upgradeSubscriptionSchema = Joi.object({
  newPlanId: Joi.number().required(),
});

// Get all available plans (filtered by vehicle type if user is authenticated)
router.get('/plans', async (req, res) => {
  try {
    const { vehicleType } = req.query;

    const where: any = { active: true };

    // Filter by vehicle type if provided
    if (vehicleType && ['CAR', 'TAXI', 'VAN'].includes(vehicleType as string)) {
      where.vehicleType = vehicleType;
    }

    const plans = await prisma.plan.findMany({
      where,
      orderBy: [
        { vehicleType: 'asc' },
        { price: 'asc' },
      ],
    });

    res.json({ plans });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// Create subscription with Stripe
router.post('/subscribe', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { error, value } = createSubscriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user!.id;
    const { planId, paymentMethodId } = value;

    // Get user and check if they already have an active subscription
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'PENDING'] } },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.subscriptions.length > 0) {
      return res.status(400).json({ error: 'User already has an active or pending subscription' });
    }

    // Get plan details
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan || !plan.active) {
      return res.status(404).json({ error: 'Plan not found or inactive' });
    }

    // Ensure user has a Stripe customer
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId },
      });

      stripeCustomerId = customer.id;
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId },
      });
    }

    // Create or get Stripe product and price for the plan
    let stripePriceId: string;

    try {
      // Try to find existing products with this plan metadata
      const products = await stripe.products.search({
        query: `metadata['planId']:'${planId}'`,
        limit: 1,
      });

      if (products.data.length > 0) {
        // Product exists, get its active price
        const prices = await stripe.prices.list({
          product: products.data[0].id,
          active: true,
          limit: 1,
        });

        if (prices.data.length > 0) {
          stripePriceId = prices.data[0].id;
        } else {
          throw new Error('No active price found');
        }
      } else {
        throw new Error('Product not found');
      }
    } catch (error) {
      // Price/Product doesn't exist, create it
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description || undefined,
        metadata: { planId },
      });

      const price = await stripe.prices.create({
        currency: 'gbp',
        recurring: { interval: 'month' },
        unit_amount: Math.round(plan.price * 100),
        product: product.id,
        metadata: { planId },
      });

      stripePriceId = price.id;
    }

    // Verify payment method is attached to customer if provided
    if (paymentMethodId) {
      try {
        const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

        // If payment method is not attached, attach it now
        if (paymentMethod.customer !== stripeCustomerId) {
          await stripe.paymentMethods.attach(paymentMethodId, {
            customer: stripeCustomerId,
          });
        }
      } catch (error) {
        console.error('Error verifying payment method:', error);
        return res.status(400).json({ error: 'Invalid payment method' });
      }
    }

    // Create Stripe subscription
    const subscriptionData: Stripe.SubscriptionCreateParams = {
      customer: stripeCustomerId,
      items: [{ price: stripePriceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    };

    if (paymentMethodId) {
      subscriptionData.default_payment_method = paymentMethodId;
    }

    const stripeSubscription = await stripe.subscriptions.create(subscriptionData);

    // Calculate dates
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + plan.duration);

    // Create subscription in database
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        planId,
        status: 'PENDING',
        startDate,
        endDate,
        stripeSubscriptionId: stripeSubscription.id,
        inAndOutWashesUsed: 0,
        outsideOnlyWashesUsed: 0,
      },
      include: {
        plan: true,
      },
    });

    const invoice = stripeSubscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent;

    res.json({
      subscription,
      clientSecret: paymentIntent?.client_secret,
      subscriptionId: stripeSubscription.id,
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Upgrade/change subscription plan
router.post('/upgrade', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { error, value } = upgradeSubscriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user!.id;
    const { newPlanId } = value;

    // Get current subscription
    const currentSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    if (!currentSubscription) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Get new plan
    const newPlan = await prisma.plan.findUnique({
      where: { id: newPlanId },
    });

    if (!newPlan || !newPlan.active) {
      return res.status(404).json({ error: 'New plan not found or inactive' });
    }

    if (currentSubscription.planId === newPlanId) {
      return res.status(400).json({ error: 'User is already on this plan' });
    }

    // Update Stripe subscription
    if (currentSubscription.stripeSubscriptionId) {
      const stripeSubscription = await stripe.subscriptions.retrieve(
        currentSubscription.stripeSubscriptionId
      );

      // Create or get price for new plan
      let newStripePriceId: string;

      try {
        // Try to find existing products with this plan metadata
        const products = await stripe.products.search({
          query: `metadata['planId']:'${newPlanId}'`,
          limit: 1,
        });

        if (products.data.length > 0) {
          // Product exists, get its active price
          const prices = await stripe.prices.list({
            product: products.data[0].id,
            active: true,
            limit: 1,
          });

          if (prices.data.length > 0) {
            newStripePriceId = prices.data[0].id;
          } else {
            throw new Error('No active price found');
          }
        } else {
          throw new Error('Product not found');
        }
      } catch (error) {
        const product = await stripe.products.create({
          name: newPlan.name,
          description: newPlan.description || undefined,
          metadata: { planId: newPlanId },
        });

        const price = await stripe.prices.create({
          currency: 'gbp',
          recurring: { interval: 'month' },
          unit_amount: Math.round(newPlan.price * 100),
          product: product.id,
          metadata: { planId: newPlanId },
        });
        newStripePriceId = price.id;
      }

      const updatedStripeSubscription = await stripe.subscriptions.update(currentSubscription.stripeSubscriptionId, {
        items: [{
          id: stripeSubscription.items.data[0].id,
          price: newStripePriceId,
        }],
        proration_behavior: 'always_invoice',
      });

      // Update subscription in database with Stripe date
      const updatedSubscription = await prisma.subscription.update({
        where: { id: currentSubscription.id },
        data: {
          planId: newPlanId,
          endDate: new Date(updatedStripeSubscription.current_period_end * 1000),
        },
        include: {
          plan: true,
        },
      });

      res.json({
        subscription: updatedSubscription,
        message: 'Subscription updated successfully',
      });
    } else {
      // Manual subscription update (no Stripe)
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + newPlan.duration);

      const updatedSubscription = await prisma.subscription.update({
        where: { id: currentSubscription.id },
        data: {
          planId: newPlanId,
          endDate,
        },
        include: {
          plan: true,
        },
      });

      res.json({
        subscription: updatedSubscription,
        message: 'Subscription updated successfully',
      });
    }
  } catch (error) {
    console.error('Error upgrading subscription:', error);
    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to upgrade subscription' });
  }
});

// Cancel subscription
router.post('/cancel', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get current subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },
    });

    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Update subscription status
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELLED' },
      include: { plan: true },
    });

    // Cancel in Stripe
    if (subscription.stripeSubscriptionId) {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }


    res.json({
      subscription: updatedSubscription,
      message: 'Subscription cancelled successfully',
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Get billing history (invoices from Stripe)
router.get('/invoices', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get user's Stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeCustomerId) {
      return res.json({ invoices: [] });
    }

    // Get invoices from Stripe
    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 100,
    });

    // Format invoices for frontend
    const formattedInvoices = invoices.data.map(invoice => ({
      id: invoice.id,
      amount: invoice.amount_paid / 100, // Convert from cents
      currency: invoice.currency,
      status: invoice.status,
      created: invoice.created,
      dueDate: invoice.due_date,
      paidAt: invoice.status_transitions.paid_at,
      invoiceUrl: invoice.hosted_invoice_url,
      invoicePdf: invoice.invoice_pdf,
      description: invoice.lines.data[0]?.description || 'Subscription',
    }));

    res.json({ invoices: formattedInvoices });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Failed to fetch billing history' });
  }
});

// Create payment intent for immediate payment
router.post('/payment-intent', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { planId } = req.body;
    const userId = req.user!.id;

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Ensure user has a Stripe customer
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId },
      });

      stripeCustomerId = customer.id;
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId },
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(plan.price * 100),
      currency: 'gbp',
      customer: stripeCustomerId,
      setup_future_usage: 'off_session',
      metadata: {
        planId,
        userId,
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

export default router;