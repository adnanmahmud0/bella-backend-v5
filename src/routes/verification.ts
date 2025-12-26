import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { processPayoutToStripe } from '../services/payoutService';
import { authenticate, AuthenticatedRequest, partnerAuthenticate } from '../middleware/auth';
import Joi from 'joi';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { NotificationService } from '../services/notificationService';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const verifyCodeSchema = Joi.object({
  code: Joi.string().required(),
});

const actionSchema = Joi.object({
  verificationId: Joi.number().required(),
});

// Helper function to generate unique short code
const generateShortCode = (): string => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

// Helper function to check if code is expired
const isCodeExpired = (expiresAt: Date): boolean => {
  return new Date() > expiresAt;
};

// POST /api/verification/generate - Generate new verification code
router.post('/generate', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { washType } = req.body; // Get wash type from request body

    // Validate wash type
    if (!washType || !['IN_AND_OUT', 'OUTSIDE_ONLY'].includes(washType)) {
      return res.status(400).json({
        error: 'Invalid wash type',
        message: 'washType must be either IN_AND_OUT or OUTSIDE_ONLY',
      });
    }

    let subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        endDate: { gte: new Date() },
      },
      include: {
        plan: true,
      },
    });

    let useSubscription = false;
    let oneTimePurchase = null;

    // Check if subscription has remaining washes for the selected type
    if (subscription) {
      const inAndOutRemaining = (subscription.plan.inAndOutQuota || 0) - subscription.inAndOutWashesUsed;
      const outsideOnlyRemaining = (subscription.plan.outsideOnlyQuota || 0) - subscription.outsideOnlyWashesUsed;

      if (washType === 'IN_AND_OUT' && inAndOutRemaining > 0) {
        useSubscription = true;
      } else if (washType === 'OUTSIDE_ONLY' && outsideOnlyRemaining > 0) {
        useSubscription = true;
      }
    }

    // If no subscription quota, check for unused One-Time Purchase
    if (!useSubscription) {
      oneTimePurchase = await prisma.oneTimePurchase.findFirst({
        where: {
          userId,
          status: 'COMPLETED',
          used: false,
          service: {
            type: washType,
          },
          // Ensure not expired if expiration logic exists
        },
        include: {
          service: true,
        },
        orderBy: { createdAt: 'asc' }, // Use oldest first
      });

      if (!oneTimePurchase) {
        // Determine specific error message
        let message = 'You need an active subscription or a one-time purchase to generate a code.';
        if (subscription) {
          message = `You have used all your ${washType === 'IN_AND_OUT' ? 'In & Out' : 'Outside Only'} washes for this period. Buy an extra service or wait for renewal.`;
        }

        return res.status(400).json({
          error: 'No washes remaining',
          message,
        });
      }
    }

    // Generate unique code
    let code: string;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      code = generateShortCode();
      const existing = await prisma.verificationCode.findUnique({
        where: { code },
      });
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ error: 'Failed to generate unique code' });
    }

    // Set expiration time (30 minutes from now)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // Generate QR code data URL
    const qrData = JSON.stringify({
      code: code!,
      subscriptionId: useSubscription ? subscription!.id : undefined,
      oneTimePurchaseId: oneTimePurchase ? oneTimePurchase.id : undefined,
      userId,
      washType,
      timestamp: Date.now(),
    });

    const qrCodeDataURL = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    // Invalidate any existing pending codes for this user (subscription or one-time)
    // Complex query: find pending codes for this subscription OR this oneTimePurchase?
    // Actually, just find pending codes for this USER? 
    // But VerificationCode doesn't have userId directly.
    // It has subscriptionId or oneTimePurchaseId.

    if (useSubscription) {
      await prisma.verificationCode.updateMany({
        where: {
          subscriptionId: subscription!.id,
          status: 'PENDING',
        },
        data: { status: 'EXPIRED' },
      });
    } else if (oneTimePurchase) {
      await prisma.verificationCode.updateMany({
        where: {
          oneTimePurchaseId: oneTimePurchase.id,
          status: 'PENDING',
        },
        data: { status: 'EXPIRED' },
      });
    }

    // Create new verification code
    const verificationCode = await prisma.verificationCode.create({
      data: {
        subscriptionId: useSubscription ? subscription!.id : null,
        oneTimePurchaseId: oneTimePurchase ? oneTimePurchase.id : null,
        code: code!,
        qrCodeData: qrCodeDataURL,
        washType: washType,
        status: 'PENDING',
        expiresAt,
      },
    });

    // Notify user
    await NotificationService.sendToUser(
      userId,
      'QR Code Generated',
      'Your wash QR code is ready. Show it to the partner.'
    );

    // Prepare response data
    // Calculate remaining (if subscription)
    let inAndOutRemaining = 0;
    let outsideOnlyRemaining = 0;

    if (subscription) {
      inAndOutRemaining = (subscription.plan.inAndOutQuota || 0) - subscription.inAndOutWashesUsed;
      outsideOnlyRemaining = (subscription.plan.outsideOnlyQuota || 0) - subscription.outsideOnlyWashesUsed;
    }

    res.status(201).json({
      success: true,
      data: {
        id: verificationCode.id,
        code: verificationCode.code,
        qrCode: verificationCode.qrCodeData,
        washType: verificationCode.washType,
        expiresAt: verificationCode.expiresAt,
        inAndOutRemaining: subscription ? inAndOutRemaining : undefined,
        outsideOnlyRemaining: subscription ? outsideOnlyRemaining : undefined,
        subscription: subscription ? {
          plan: subscription.plan.name,
          inAndOutQuota: subscription.plan.inAndOutQuota,
          outsideOnlyQuota: subscription.plan.outsideOnlyQuota,
          inAndOutUsed: subscription.inAndOutWashesUsed,
          outsideOnlyUsed: subscription.outsideOnlyWashesUsed,
        } : null,
        oneTimePurchase: oneTimePurchase ? {
          serviceName: oneTimePurchase.service.name,
        } : null
      },
    });
  } catch (error: unknown) {
    console.error('Error generating verification code:', error);
    res.status(500).json({ error: 'Failed to generate verification code' });
  }
});

// POST /api/verification/verify - Verify code (partner)
router.post('/verify', partnerAuthenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { error, value } = verifyCodeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { code } = value;

    // Find verification code
    const verificationCode = await prisma.verificationCode.findUnique({
      where: { code },
      include: {
        subscription: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                status: true,
              },
            },
            plan: true,
          },
        },
        oneTimePurchase: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                status: true,
              },
            },
            service: true,
          },
        },
      },
    });

    if (!verificationCode) {
      return res.status(404).json({
        error: 'Invalid code',
        message: 'Verification code not found',
      });
    }

    // Check if code is expired
    if (isCodeExpired(verificationCode.expiresAt)) {
      await prisma.verificationCode.update({
        where: { id: verificationCode.id },
        data: { status: 'EXPIRED' },
      });

      return res.status(400).json({
        error: 'Code expired',
        message: 'This verification code has expired',
      });
    }

    // Check if code is already used
    if (verificationCode.status !== 'PENDING') {
      return res.status(400).json({
        error: 'Code already used',
        message: `This code has been ${verificationCode.status.toLowerCase()}`,
      });
    }

    // Determine context (Subscription vs OneTimePurchase)
    let user;
    let subscriptionData = null;
    let oneTimePurchaseData = null;
    let inAndOutRemaining = 0;
    let outsideOnlyRemaining = 0;

    if (verificationCode.subscription) {
      const { subscription } = verificationCode;
      user = subscription.user;

      // Check if user is suspended or inactive
      if (user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
        return res.status(403).json({
          error: 'Account suspended',
          message: 'User account is suspended or inactive',
        });
      }

      if (subscription.status !== 'ACTIVE') {
        return res.status(400).json({
          error: 'Inactive subscription',
          message: 'User subscription is not active',
        });
      }

      if (new Date() > subscription.endDate) {
        return res.status(400).json({
          error: 'Subscription expired',
          message: 'User subscription has expired',
        });
      }

      const washType = verificationCode.washType || 'IN_AND_OUT';
      inAndOutRemaining = (subscription.plan.inAndOutQuota || 0) - subscription.inAndOutWashesUsed;
      outsideOnlyRemaining = (subscription.plan.outsideOnlyQuota || 0) - subscription.outsideOnlyWashesUsed;

      if (washType === 'IN_AND_OUT' && inAndOutRemaining <= 0) {
        return res.status(400).json({
          error: 'No washes remaining',
          message: 'User has no remaining In & Out washes',
        });
      }

      if (washType === 'OUTSIDE_ONLY' && outsideOnlyRemaining <= 0) {
        return res.status(400).json({
          error: 'No washes remaining',
          message: 'User has no remaining Outside Only washes',
        });
      }

      subscriptionData = {
        plan: subscription.plan.name,
        vehicleType: subscription.plan.vehicleType,
        tier: subscription.plan.tier,
        inAndOutQuota: subscription.plan.inAndOutQuota,
        outsideOnlyQuota: subscription.plan.outsideOnlyQuota,
        inAndOutUsed: subscription.inAndOutWashesUsed,
        outsideOnlyUsed: subscription.outsideOnlyWashesUsed,
        inAndOutRemaining,
        outsideOnlyRemaining,
      };
    } else if (verificationCode.oneTimePurchase) {
      const { oneTimePurchase } = verificationCode;
      user = oneTimePurchase.user;

      if (user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
        return res.status(403).json({
          error: 'Account suspended',
          message: 'User account is suspended or inactive',
        });
      }

      if (oneTimePurchase.status !== 'COMPLETED') {
        return res.status(400).json({
          error: 'Invalid purchase',
          message: 'One-time purchase is not completed',
        });
      }

      if (oneTimePurchase.used) {
        return res.status(400).json({
          error: 'Purchase used',
          message: 'One-time purchase has already been used',
        });
      }

      // Mock subscription data for frontend compatibility if needed, or send separate field
      // But the Partner App expects 'subscription' object likely.
      // We'll construct a compatible object.
      subscriptionData = {
        plan: `Extra: ${oneTimePurchase.service.name}`,
        vehicleType: 'CAR', // Default or fetch from user
        tier: 'BASE',
        inAndOutQuota: 1,
        outsideOnlyQuota: 1,
        inAndOutUsed: 0,
        outsideOnlyUsed: 0,
        inAndOutRemaining: 1,
        outsideOnlyRemaining: 1,
      };
    } else {
      return res.status(500).json({ error: 'Invalid verification code state' });
    }

    // Code is valid and eligible
    res.json({
      success: true,
      eligible: true,
      message: 'Verification successful',
      data: {
        verificationId: verificationCode.id,
        code: verificationCode.code,
        washType: verificationCode.washType,
        user: user,
        subscription: subscriptionData,
        status: verificationCode.status,
      },
    });
  } catch (error: unknown) {
    console.error('Error verifying code:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// POST /api/verification/start - Start service
router.post('/start', partnerAuthenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { error, value } = actionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { verificationId } = value;
    const partnerId = req.partner!.id;

    // Find verification code
    const verificationCode = await prisma.verificationCode.findUnique({
      where: { id: verificationId },
      include: {
        subscription: {
          include: {
            user: {
              select: { name: true },
            },
            plan: true,
          },
        },
        oneTimePurchase: {
          include: {
            user: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!verificationCode) {
      return res.status(404).json({ error: 'Verification code not found' });
    }

    // Check if code is still pending
    if (verificationCode.status !== 'PENDING') {
      return res.status(400).json({
        error: 'Invalid status',
        message: `Cannot start service. Code status is ${verificationCode.status}`,
      });
    }

    // Check if code is expired
    if (isCodeExpired(verificationCode.expiresAt)) {
      await prisma.verificationCode.update({
        where: { id: verificationId },
        data: { status: 'EXPIRED' },
      });

      return res.status(400).json({ error: 'Code has expired' });
    }

    // Update status to IN_PROGRESS
    const updated = await prisma.verificationCode.update({
      where: { id: verificationId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        usedBy: partnerId,
      },
    });

    const userName = verificationCode.subscription?.user.name || verificationCode.oneTimePurchase?.user.name || 'Unknown User';

    res.json({
      success: true,
      message: 'Service started successfully',
      data: {
        verificationId: updated.id,
        status: updated.status,
        startedAt: updated.startedAt,
        user: userName,
      },
    });
  } catch (error: unknown) {
    console.error('Error starting service:', error);
    res.status(500).json({ error: 'Failed to start service' });
  }
});

// POST /api/verification/complete - Complete service and deduct wash
router.post('/complete', partnerAuthenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { error, value } = actionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { verificationId } = value;
    const partnerId = req.partner!.id;

    // Find verification code
    const verificationCode = await prisma.verificationCode.findUnique({
      where: { id: verificationId },
      include: {
        subscription: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
            plan: true,
          },
        },
        oneTimePurchase: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
            service: true,
          },
        },
      },
    });

    if (!verificationCode) {
      return res.status(404).json({ error: 'Verification code not found' });
    }

    // Check status and permissions
    if (verificationCode.status === 'PENDING') {
      // Allow direct completion from PENDING (One-step process)
      // Check if code is expired before allowing processing
      if (isCodeExpired(verificationCode.expiresAt)) {
        await prisma.verificationCode.update({
          where: { id: verificationId },
          data: { status: 'EXPIRED' },
        });
        return res.status(400).json({ error: 'Code has expired' });
      }
    } else if (verificationCode.status === 'IN_PROGRESS') {
      // Check if service was started by this partner
      if (verificationCode.usedBy !== partnerId) {
        return res.status(403).json({
          error: 'Unauthorized',
          message: 'This service was not started by you',
        });
      }
    } else {
      return res.status(400).json({
        error: 'Invalid status',
        message: `Cannot complete service. Code status is ${verificationCode.status}`,
      });
    }

    // Check if code is linked to subscription or purchase
    if (!verificationCode.subscription && !verificationCode.oneTimePurchase) {
      console.error('Verification code has no associated subscription or one-time purchase:', verificationId);
      return res.status(400).json({
        error: 'Invalid Code',
        message: 'Verification code is not linked to any subscription or purchase'
      });
    }

    // Determine payout amount based on plan and wash type
    const washType = verificationCode.washType || 'IN_AND_OUT'; // Default to IN_AND_OUT for old records
    let payoutAmount: number;

    if (verificationCode.subscription) {
      const plan = verificationCode.subscription.plan;
      if (washType === 'IN_AND_OUT') {
        payoutAmount = plan.inAndOutPayout || 10.00;
      } else {
        payoutAmount = plan.outsideOnlyPayout || 8.00;
      }
    } else if (verificationCode.oneTimePurchase) {
      // For one-time purchases, use default payout values since we don't have plan payouts
      // Or could be stored in ExtraService (future improvement)
      if (washType === 'IN_AND_OUT') {
        payoutAmount = 10.00;
      } else {
        payoutAmount = 8.00;
      }
    } else {
      // Fallback
      payoutAmount = 8.00;
    }

    // Use transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Update verification code status
      const updatedCode = await tx.verificationCode.update({
        where: { id: verificationId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      let updatedSubscription = null;
      let updatedOneTimePurchase = null;
      let userId: number;

      if (verificationCode.subscription) {
        userId = verificationCode.subscription.userId;
        // Deduct wash from subscription based on wash type
        const updateData: any = {};
        if (washType === 'IN_AND_OUT') {
          updateData.inAndOutWashesUsed = { increment: 1 };
        } else {
          updateData.outsideOnlyWashesUsed = { increment: 1 };
        }

        updatedSubscription = await tx.subscription.update({
          where: { id: verificationCode.subscriptionId! },
          data: updateData,
          include: {
            plan: true,
          },
        });
      } else if (verificationCode.oneTimePurchase) {
        userId = verificationCode.oneTimePurchase.userId;
        updatedOneTimePurchase = await tx.oneTimePurchase.update({
          where: { id: verificationCode.oneTimePurchaseId! },
          data: {
            used: true,
            usedAt: new Date(),
            status: 'COMPLETED' // Ensure it's completed (should be already)
          }
        });
      } else {
        throw new Error('Verification code has no associated subscription or one-time purchase (transaction)');
      }

      // Create verification record with wash type and payout amount
      const verification = await tx.verification.create({
        data: {
          userId: userId,
          partnerId,
          subscriptionId: verificationCode.subscriptionId, // Can be null now
          washType: washType,
          payoutAmount: payoutAmount,
          verifiedAt: new Date(),
          oneTimePurchaseId: verificationCode.oneTimePurchaseId
        },
      });

      return { updatedCode, updatedSubscription, updatedOneTimePurchase, verification };
    });

    // Create payout record
    const payoutRecord = await prisma.payout.create({
      data: {
        partnerId,
        verificationId: result.verification.id,
        amount: payoutAmount,
        currency: 'gbp',
        status: 'PENDING',
        description: `Payout for ${washType === 'IN_AND_OUT' ? 'In & Out' : 'Outside Only'} wash service`,
        scheduledFor: new Date(),
      },
    });

    // Check for auto-payout setting
    let payoutResult = {
      success: true,
      payoutId: payoutRecord.id,
    };

    try {
      const autoPayoutSetting = await prisma.systemSetting.findUnique({
        where: { key: 'AUTO_PAYOUT_ENABLED' }
      });
      const isAutoPayoutEnabled = autoPayoutSetting?.value === 'true';

      if (isAutoPayoutEnabled) {
        // Try to process via Stripe immediately
        const stripeSuccess = await processPayoutToStripe(payoutRecord.id);
        console.log(`Auto-payout processing for ${payoutRecord.id}: ${stripeSuccess ? 'Success' : 'Failed/Skipped'}`);
      }
    } catch (payoutError) {
      console.error('Error in auto-payout processing (non-fatal):', payoutError);
      // We don't fail the request here because the service was successfully completed
      // The payout is recorded as PENDING and can be retried later
    }

    console.log(`💰 Payout created: £${payoutAmount.toFixed(2)} for partner ${partnerId} (${washType})`);

    // Prepare response data
    let washesUsed = { inAndOut: 0, outsideOnly: 0 };
    let remainingWashes = { inAndOut: 0, outsideOnly: 0 };
    let userDetails = { name: '', email: '' };

    if (result.updatedSubscription) {
      washesUsed = {
        inAndOut: result.updatedSubscription.inAndOutWashesUsed,
        outsideOnly: result.updatedSubscription.outsideOnlyWashesUsed
      };
      remainingWashes = {
        inAndOut: (result.updatedSubscription.plan.inAndOutQuota || 0) - result.updatedSubscription.inAndOutWashesUsed,
        outsideOnly: (result.updatedSubscription.plan.outsideOnlyQuota || 0) - result.updatedSubscription.outsideOnlyWashesUsed
      };
      userDetails = {
        name: verificationCode.subscription!.user.name,
        email: verificationCode.subscription!.user.email
      };
    } else if (verificationCode.oneTimePurchase) {
      userDetails = {
        name: verificationCode.oneTimePurchase.user.name,
        email: verificationCode.oneTimePurchase.user.email
      };
      // For one-time purchase, remaining is 0 after use
    }

    res.json({
      success: true,
      message: 'Service completed successfully',
      data: {
        verificationId: result.updatedCode.id,
        status: result.updatedCode.status,
        completedAt: result.updatedCode.completedAt,
        washType: washType,
        payoutAmount: payoutAmount,
        washesUsed,
        remainingWashes,
        user: userDetails,
        payout: payoutResult.success ? {
          id: payoutResult.payoutId,
          status: 'created',
          amount: payoutAmount,
        } : null,
      },
    });
  } catch (error: unknown) {
    console.error('Error completing service:', error);
    res.status(500).json({ error: 'Failed to complete service' });
  }
});

// GET /api/verification/history - Get verification history for current user
router.get('/history', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;

    const verifications = await prisma.verificationCode.findMany({
      where: {
        OR: [
          { subscription: { userId } },
          { oneTimePurchase: { userId } },
        ],
      },
      include: {
        subscription: {
          include: {
            plan: {
              select: {
                name: true,
              },
            },
          },
        },
        oneTimePurchase: {
          include: {
            service: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    res.json({
      success: true,
      data: verifications.map(v => ({
        id: v.id,
        code: v.code,
        status: v.status,
        plan: v.subscription?.plan.name || (v.oneTimePurchase?.service.name ? `Extra: ${v.oneTimePurchase.service.name}` : 'Unknown'),
        createdAt: v.createdAt,
        expiresAt: v.expiresAt,
        startedAt: v.startedAt,
        completedAt: v.completedAt,
      })),
    });
  } catch (error: unknown) {
    console.error('Error fetching verification history:', error);
    res.status(500).json({ error: 'Failed to fetch verification history' });
  }
});

// GET /api/verification/current - Get current active code
router.get('/current', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;

    const verificationCode = await prisma.verificationCode.findFirst({
      where: {
        OR: [
          { subscription: { userId } },
          { oneTimePurchase: { userId } },
        ],
        status: 'PENDING',
        expiresAt: { gte: new Date() },
      },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
        oneTimePurchase: {
          include: {
            service: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!verificationCode) {
      return res.json({
        success: true,
        data: null,
      });
    }

    let inAndOutRemaining = 0;
    let outsideOnlyRemaining = 0;
    let subscriptionData = null;
    let oneTimePurchaseData = null;

    if (verificationCode.subscription) {
      inAndOutRemaining = (verificationCode.subscription.plan.inAndOutQuota || 0) - verificationCode.subscription.inAndOutWashesUsed;
      outsideOnlyRemaining = (verificationCode.subscription.plan.outsideOnlyQuota || 0) - verificationCode.subscription.outsideOnlyWashesUsed;

      subscriptionData = {
        plan: verificationCode.subscription.plan.name,
        inAndOutQuota: verificationCode.subscription.plan.inAndOutQuota,
        outsideOnlyQuota: verificationCode.subscription.plan.outsideOnlyQuota,
        inAndOutUsed: verificationCode.subscription.inAndOutWashesUsed,
        outsideOnlyUsed: verificationCode.subscription.outsideOnlyWashesUsed,
      };
    } else if (verificationCode.oneTimePurchase) {
      // One-time purchase implies 1 wash available (which is this one)
      // If we want to display remaining washes in UI, we can say 1/1
      inAndOutRemaining = 1;
      outsideOnlyRemaining = 1;

      // Use a dummy subscription object for frontend compatibility if needed, 
      // OR frontend should handle null subscription.
      // Looking at QRCodePage.tsx, it expects `subscription` object.
      // We should populate it with something meaningful or update frontend.
      // Updating frontend is safer but for now let's mock it to avoid breakage.
      subscriptionData = {
        plan: `Extra: ${verificationCode.oneTimePurchase.service.name}`,
        inAndOutQuota: 1,
        outsideOnlyQuota: 1,
        inAndOutUsed: 0,
        outsideOnlyUsed: 0
      };
    }

    res.json({
      success: true,
      data: {
        id: verificationCode.id,
        code: verificationCode.code,
        qrCode: verificationCode.qrCodeData,
        washType: verificationCode.washType,
        expiresAt: verificationCode.expiresAt,
        inAndOutRemaining,
        outsideOnlyRemaining,
        subscription: subscriptionData,
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching current code:', error);
    res.status(500).json({ error: 'Failed to fetch current code' });
  }
});

// GET /api/verification/status/:code - Get status of a specific verification code
router.get('/status/:code', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { code } = req.params;
    const userId = req.user!.id;

    const verificationCode = await prisma.verificationCode.findUnique({
      where: { code },
      include: {
        subscription: {
          include: {
            plan: true,
            user: true,
          },
        },
        oneTimePurchase: {
          include: {
            service: true,
            user: true,
          },
        },
      },
    });

    if (!verificationCode) {
      return res.status(404).json({
        success: false,
        error: 'Verification code not found',
      });
    }

    // Verify this code belongs to the user
    const ownerId = verificationCode.subscription?.userId || verificationCode.oneTimePurchase?.userId;
    if (ownerId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized access',
      });
    }

    // Get partner name if the code was used
    let partnerName = undefined;
    if (verificationCode.usedBy) {
      const partner = await prisma.partner.findUnique({
        where: { id: verificationCode.usedBy },
        select: { name: true },
      });
      partnerName = partner?.name;
    }

    res.json({
      success: true,
      data: {
        verificationId: verificationCode.id,
        code: verificationCode.code,
        status: verificationCode.status,
        startedAt: verificationCode.startedAt,
        completedAt: verificationCode.completedAt,
        partnerName,
        subscription: verificationCode.subscription ? {
          used: verificationCode.subscription.inAndOutWashesUsed + verificationCode.subscription.outsideOnlyWashesUsed,
          remaining: (verificationCode.subscription.plan.inAndOutQuota || 0) + (verificationCode.subscription.plan.outsideOnlyQuota || 0) - (verificationCode.subscription.inAndOutWashesUsed + verificationCode.subscription.outsideOnlyWashesUsed)
        } : null,
      },
    });

  } catch (error: unknown) {
    console.error('Error fetching verification status:', error);
    res.status(500).json({ error: 'Failed to fetch verification status' });
  }
});
export default router;
