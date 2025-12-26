import { Router } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { NotificationService } from '../services/notificationService';

const router = Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Stripe webhook endpoint
router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature']!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`Received webhook event: ${event.type}`);

  try {
    switch (event.type) {
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'payment_method.attached':
        await handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle successful invoice payment
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  console.log('Invoice payment succeeded:', invoice.id);

  // Update subscription status to active if it was pending
  if (invoice.subscription) {
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: invoice.subscription as string },
    });

    if (subscription) {
      // Update status to ACTIVE and reset wash usage for the new billing period
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          inAndOutWashesUsed: 0,
          outsideOnlyWashesUsed: 0
        },
      });

      console.log(`Subscription ${subscription.id} activated and usage reset`);

      // Send notification
      await NotificationService.sendToUser(
        subscription.userId,
        'Payment Successful',
        'Your subscription payment was successful. Your wash quota has been reset.'
      );
    }
  }
}

// Handle failed invoice payment
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log('Invoice payment failed:', invoice.id);

  if (invoice.subscription) {
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: invoice.subscription as string },
    });

    if (subscription) {
      console.log(`Payment failed for subscription ${subscription.id}`);
    }
  }
}

// Handle subscription creation
async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  console.log('Subscription created:', subscription.id);

  const dbSubscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (dbSubscription) {
    const status = subscription.status === 'active' ? 'ACTIVE' : 'PENDING';

    await prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: { status },
    });

    console.log(`Subscription ${dbSubscription.id} status updated to ${status}`);
  }
}

// Handle subscription updates
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log('Subscription updated:', subscription.id);

  const dbSubscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (dbSubscription) {
    let status = dbSubscription.status;

    console.log('Subscription updated status from stripe: ', subscription.status);
    console.log('Cancel at period end: ', subscription.cancel_at_period_end);
    console.log('Current period end: ', subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : 'N/A');

    // Check if subscription is scheduled to be canceled
    if (subscription.cancel_at_period_end) {
      // Subscription is scheduled to be canceled but still active until current_period_end
      // Keep status as ACTIVE to continue providing service
      console.log(`Subscription ${dbSubscription.id} is scheduled to be canceled at ${new Date(subscription.current_period_end * 1000)}`);
      status = 'ACTIVE'; // Continue providing access until period ends

      // Update the subscription with cancellation info
      await prisma.subscription.update({
        where: { id: dbSubscription.id },
        data: {
          status,
          endDate: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: true,
          canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : new Date(),
        },
      });

      console.log(`Subscription ${dbSubscription.id} will remain active until ${new Date(subscription.current_period_end * 1000)}`);
      return;
    }

    // If cancel_at_period_end is false, clear the cancellation flag (user reactivated)
    const cancelAtPeriodEnd = subscription.cancel_at_period_end;

    // Handle normal status changes
    switch (subscription.status) {
      case 'active':
        status = 'ACTIVE';
        break;
      case 'canceled':
        status = 'CANCELLED';
        break;
      case 'past_due':
      case 'unpaid':
        status = 'EXPIRED';
        break;
    }

    await prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        status,
        cancelAtPeriodEnd,
        canceledAt: cancelAtPeriodEnd && subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      },
    });

    console.log(`Subscription ${dbSubscription.id} status updated to ${status}`);
  }
}

// Handle subscription deletion
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('Subscription deleted:', subscription.id);

  const dbSubscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (dbSubscription) {
    await prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: { status: 'CANCELLED' },
    });

    console.log(`Subscription ${dbSubscription.id} marked as cancelled`);
  }
}

// Handle payment method attachment
async function handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod) {
  console.log('Payment method attached:', paymentMethod.id);

  const dbPaymentMethod = await prisma.paymentMethod.findFirst({
    where: { stripePaymentMethodId: paymentMethod.id },
  });

  if (dbPaymentMethod) {
    console.log(`Payment method ${paymentMethod.id} confirmed for user ${dbPaymentMethod.userId}`);
  }
}

export default router;