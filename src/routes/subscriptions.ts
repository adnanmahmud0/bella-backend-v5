import { Router, Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { prisma } from '../index';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { WashType } from '@prisma/client';
import { NotificationService } from '../services/notificationService';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

// Get user's subscriptions
router.get('/user', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: { userId: req.user!.id },
      include: {
        plan: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: subscriptions,
    });
  } catch (error) {
    next(error);
  }
});

// Get user's current active subscription
router.get('/current', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let currentSubscription = await prisma.subscription.findFirst({
      where: {
        userId: req.user!.id,
        status: { in: ['ACTIVE', 'PENDING'] },
        endDate: {
          gte: new Date(),
        },
      },
      include: {
        plan: true,
      },
      orderBy: {
        endDate: 'desc',
      },
    });

    // Check Stripe status if pending
    if (currentSubscription?.status === 'PENDING' && currentSubscription.stripeSubscriptionId) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(currentSubscription.stripeSubscriptionId);

        if (stripeSubscription.status === 'active') {
          currentSubscription = await prisma.subscription.update({
            where: { id: currentSubscription.id },
            data: { status: 'ACTIVE' },
            include: { plan: true },
          });
        }
      } catch (error) {
        console.error('Error checking Stripe subscription status:', error);
      }
    }

    // Add additional info about cancellation status if present
    if (currentSubscription && currentSubscription.cancelAtPeriodEnd) {
      const remainingDays = Math.ceil((currentSubscription.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      res.json({
        success: true,
        data: {
          ...currentSubscription,
          isCanceled: true,
          remainingDays,
        },
      });
    } else {
      res.json({
        success: true,
        data: currentSubscription,
      });
    }
  } catch (error) {
    next(error);
  }
});

// Create a new subscription
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { planId, paymentMethodId } = req.body;

    // Get the plan
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan || !plan.active) {
      return res.status(404).json({
        success: false,
        error: 'Plan not found or no longer available',
      });
    }

    // Check if user already has an active or pending subscription
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        userId: req.user!.id,
        status: { in: ['ACTIVE', 'PENDING'] },
        endDate: {
          gte: new Date(),
        },
      },
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        error: 'You already have an active or pending subscription.',
      });
    }

    // Calculate subscription dates
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + plan.duration);

    // Create subscription
    const subscription = await prisma.subscription.create({
      data: {
        userId: req.user!.id,
        planId,
        status: 'ACTIVE',
        startDate,
        endDate,
        stripeSubscriptionId: null, // Will be updated after Stripe integration
        inAndOutWashesUsed: 0,
        outsideOnlyWashesUsed: 0,
      },
      include: {
        plan: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
});

// Update subscription status
router.patch('/:id/status', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }
    const { washType } = req.body;

    if (!washType || !['IN_AND_OUT', 'OUTSIDE_ONLY'].includes(washType)) {
      return res.status(400).json({ success: false, error: 'Valid wash type (IN_AND_OUT or OUTSIDE_ONLY) is required' });
    }
    const { status } = req.body;

    // Verify subscription belongs to user
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        id,
        userId: req.user!.id,
      },
    });

    if (!existingSubscription) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found',
      });
    }

    const subscription = await prisma.subscription.update({
      where: { id },
      data: { status },
      include: {
        plan: true,
      },
    });

    res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
});

// Cancel subscription
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    // Verify subscription belongs to user
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        id,
        userId: req.user!.id,
      },
    });

    if (!existingSubscription) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found',
      });
    }

    const subscription = await prisma.subscription.update({
      where: { id },
      data: {
        status: 'CANCELLED',
      },
      include: {
        plan: true,
      },
    });

    // Notify user
    await NotificationService.sendToUser(
      req.user!.id,
      'Subscription Cancelled',
      `Your subscription to ${subscription.plan.name} has been cancelled.`
    );

    res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
});

// Use a wash (decrement remaining washes)
router.post('/:id/use-wash', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const { washType } = req.body;

    if (!washType || !['IN_AND_OUT', 'OUTSIDE_ONLY'].includes(washType)) {
      return res.status(400).json({ success: false, error: 'Valid wash type (IN_AND_OUT or OUTSIDE_ONLY) is required' });
    }

    // Verify subscription belongs to user and is active
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        id,
        userId: req.user!.id,
        status: 'ACTIVE',
      },
    });

    if (!existingSubscription) {
      return res.status(404).json({
        success: false,
        error: 'Active subscription not found',
      });
    }

    // Get the plan to check quota
    const plan = await prisma.plan.findUnique({
      where: { id: existingSubscription.planId },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Subscription plan not found',
      });
    }

    // Check if there are any remaining washes for the requested type
    if (washType === 'IN_AND_OUT') {
      const inAndOutRemaining = (plan.inAndOutQuota || 0) - existingSubscription.inAndOutWashesUsed;
      if (inAndOutRemaining <= 0) {
        return res.status(400).json({ success: false, error: 'No In & Out washes remaining' });
      }
    } else {
      const outsideOnlyRemaining = (plan.outsideOnlyQuota || 0) - existingSubscription.outsideOnlyWashesUsed;
      if (outsideOnlyRemaining <= 0) {
        return res.status(400).json({ success: false, error: 'No Outside Only washes remaining' });
      }
    }

    const updateData: any = {};
    if (washType === 'IN_AND_OUT') {
      updateData.inAndOutWashesUsed = { increment: 1 };
    } else {
      updateData.outsideOnlyWashesUsed = { increment: 1 };
    }

    const subscription = await prisma.subscription.update({
      where: { id },
      data: updateData,
      include: {
        plan: true,
      },
    });

    res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
});

export default router;