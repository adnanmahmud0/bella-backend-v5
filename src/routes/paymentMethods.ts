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
const createPaymentMethodSchema = Joi.object({
  paymentMethodId: Joi.string().required(),
});

const createCustomerSchema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().required(),
});

// Get user's payment methods
router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get user to check if they have a Stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get payment methods from database
    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // If user has a Stripe customer ID, also get from Stripe
    let stripePaymentMethods: Stripe.PaymentMethod[] = [];
    if (user.stripeCustomerId) {
      try {
        const stripeMethods = await stripe.paymentMethods.list({
          customer: user.stripeCustomerId,
          type: 'card',
        });
        stripePaymentMethods = stripeMethods.data;
      } catch (error) {
        console.error('Error fetching Stripe payment methods:', error);
      }
    }

    res.json({
      paymentMethods,
      stripePaymentMethods,
    });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

// Create Stripe customer for user
router.post('/create-customer', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { error, value } = createCustomerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user!.id;
    const { email, name } = value;

    // Check if user already has a Stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (user?.stripeCustomerId) {
      return res.status(400).json({ error: 'User already has a Stripe customer' });
    }

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: {
        userId,
      },
    });

    // Update user with Stripe customer ID
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });

    res.json({
      customerId: customer.id,
      message: 'Stripe customer created successfully',
    });
  } catch (error) {
    console.error('Error creating Stripe customer:', error);
    res.status(500).json({ error: 'Failed to create Stripe customer' });
  }
});

// Add payment method
router.post('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { error, value } = createPaymentMethodSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user!.id;
    const { paymentMethodId } = value;

    // Get user's Stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Ensure user has a Stripe customer - create if doesn't exist
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId },
      });
      
      stripeCustomerId = customer.id;
      
      // Update user with Stripe customer ID
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId },
      });
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: stripeCustomerId,
    });

    // Get payment method details from Stripe
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    // Save payment method to database
    const savedPaymentMethod = await prisma.paymentMethod.create({
      data: {
        userId,
        stripePaymentMethodId: paymentMethodId,
        type: paymentMethod.type,
        last4: paymentMethod.card?.last4 || null,
        brand: paymentMethod.card?.brand || null,
        expiryMonth: paymentMethod.card?.exp_month || null,
        expiryYear: paymentMethod.card?.exp_year || null,
        isDefault: false,
      },
    });

    res.status(201).json({
      paymentMethod: savedPaymentMethod,
      message: 'Payment method added successfully',
    });
  } catch (error) {
    console.error('Error adding payment method:', error);
    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to add payment method' });
  }
});

// Set default payment method
router.put('/:id/default', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const paymentMethodId = parseInt(req.params.id);

    if (isNaN(paymentMethodId)) {
      return res.status(400).json({ error: 'Invalid payment method ID' });
    }

    // First, unset all payment methods as default
    await prisma.paymentMethod.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    // Set the selected payment method as default
    const updatedPaymentMethod = await prisma.paymentMethod.update({
      where: {
        id: paymentMethodId,
        userId,
      },
      data: { isDefault: true },
    });

    // Also update in Stripe (set as default payment method for customer)
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (user?.stripeCustomerId) {
      await stripe.customers.update(user.stripeCustomerId, {
        invoice_settings: {
          default_payment_method: updatedPaymentMethod.stripePaymentMethodId,
        },
      });
    }

    res.json({
      paymentMethod: updatedPaymentMethod,
      message: 'Default payment method updated',
    });
  } catch (error) {
    console.error('Error setting default payment method:', error);
    res.status(500).json({ error: 'Failed to update default payment method' });
  }
});

// Delete payment method
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const paymentMethodId = parseInt(req.params.id);

    if (isNaN(paymentMethodId)) {
      return res.status(400).json({ error: 'Invalid payment method ID' });
    }

    // Get payment method from database
    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: {
        id: paymentMethodId,
        userId,
      },
    });

    if (!paymentMethod) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    // Detach from Stripe
    try {
      await stripe.paymentMethods.detach(paymentMethod.stripePaymentMethodId);
    } catch (error) {
      console.error('Error detaching from Stripe:', error);
      // Continue with database deletion even if Stripe fails
    }

    // Delete from database
    await prisma.paymentMethod.delete({
      where: { id: paymentMethodId },
    });

    res.json({ message: 'Payment method deleted successfully' });
  } catch (error) {
    console.error('Error deleting payment method:', error);
    res.status(500).json({ error: 'Failed to delete payment method' });
  }
});

// Create setup intent for adding payment methods
router.post('/setup-intent', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get user's Stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'User must have a Stripe customer account' });
    }

    // Create setup intent
    const setupIntent = await stripe.setupIntents.create({
      customer: user.stripeCustomerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    res.json({
      clientSecret: setupIntent.client_secret,
    });
  } catch (error) {
    console.error('Error creating setup intent:', error);
    res.status(500).json({ error: 'Failed to create setup intent' });
  }
});

export default router;