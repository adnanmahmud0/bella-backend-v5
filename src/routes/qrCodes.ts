import { Router, Request, Response, NextFunction } from 'express';
import QRCode from 'qrcode';
import { prisma } from '../index';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { createAndProcessPayout } from '../services/payoutService';
import { NotificationService } from '../services/notificationService';

const router = Router();

// Generate QR code for user's active subscription
router.get('/generate', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId: req.user!.id,
        status: 'ACTIVE',
        endDate: {
          gte: new Date(),
        },
      },
      include: {
        plan: true,
      },
    });

    if (!activeSubscription) {
      return res.status(404).json({
        success: false,
        error: 'No active subscription found',
      });
    }

    // Check if user has remaining washes (either type)
    const inAndOutRemaining = (activeSubscription.plan.inAndOutQuota || 0) - activeSubscription.inAndOutWashesUsed;
    const outsideOnlyRemaining = (activeSubscription.plan.outsideOnlyQuota || 0) - activeSubscription.outsideOnlyWashesUsed;

    if (inAndOutRemaining <= 0 && outsideOnlyRemaining <= 0) {
      return res.status(400).json({
        success: false,
        error: 'No remaining washes available',
      });
    }

    // Check if there's already an active QR code for this subscription
    const existingQRCode = await prisma.qRCode.findFirst({
      where: {
        subscriptionId: activeSubscription.id,
        active: true,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    let qrCode;

    if (existingQRCode) {
      // Return existing QR code
      qrCode = existingQRCode;
    } else {
      // Create new QR code
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15); // QR code expires in 15 minutes

      qrCode = await prisma.qRCode.create({
        data: {
          subscriptionId: activeSubscription.id,
          code: `bella_${activeSubscription.id}_${Date.now()}`,
          active: true,
          expiresAt,
        },
      });
    }

    // Generate QR code image data URL
    const qrCodeData = {
      subscriptionId: qrCode.subscriptionId,
      code: qrCode.code,
      userId: req.user!.id,
      timestamp: qrCode.createdAt.toISOString(),
    };

    const qrCodeImageURL = await QRCode.toDataURL(JSON.stringify(qrCodeData));

    res.json({
      success: true,
      data: {
        qrCode: {
          ...qrCode,
          imageURL: qrCodeImageURL,
        },
        subscription: {
          planName: activeSubscription.plan.name,
          inAndOutRemaining: (activeSubscription.plan.inAndOutQuota || 0) - activeSubscription.inAndOutWashesUsed,
          outsideOnlyRemaining: (activeSubscription.plan.outsideOnlyQuota || 0) - activeSubscription.outsideOnlyWashesUsed,
          expiresAt: activeSubscription.endDate,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get user's QR codes
router.get('/user', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const qrCodes = await prisma.qRCode.findMany({
      where: {
        subscription: {
          userId: req.user!.id,
        },
      },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: qrCodes,
    });
  } catch (error) {
    next(error);
  }
});

// Verify QR code (used by partners)
router.post('/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, partnerId, locationId, washType } = req.body;

    if (!code || !partnerId || !locationId || !washType) {
      return res.status(400).json({
        success: false,
        error: 'QR code, partner ID, location ID, and wash type are required',
      });
    }

    const partnerIdInt = parseInt(partnerId);
    const locationIdInt = parseInt(locationId);

    if (isNaN(partnerIdInt) || isNaN(locationIdInt)) {
      return res.status(400).json({
        success: false,
        error: 'Partner ID and Location ID must be valid numbers',
      });
    }

    if (!['IN_AND_OUT', 'OUTSIDE_ONLY'].includes(washType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wash type',
      });
    }

    // Find the QR code
    const qrCode = await prisma.qRCode.findFirst({
      where: { code },
      include: {
        subscription: {
          include: {
            plan: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                status: true,
              },
            },
          },
        },
        oneTimePurchase: {
          include: {
            service: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!qrCode) {
      return res.status(404).json({
        success: false,
        error: 'Invalid QR code',
      });
    }

    // Check if user is suspended or inactive
    const userStatus = qrCode.subscription?.user.status || qrCode.oneTimePurchase?.user.status;
    if (userStatus === 'SUSPENDED' || userStatus === 'INACTIVE') {
      return res.status(403).json({
        success: false,
        error: 'User account is suspended or inactive',
      });
    }

    // Check if QR code has expired
    if (qrCode.expiresAt && qrCode.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'QR code has expired',
      });
    }

    // Check if QR code is active
    if (!qrCode.active) {
      return res.status(400).json({
        success: false,
        error: 'QR code is not active',
      });
    }

    let userId: number;
    let planName: string;

    // Handle One-Time Purchase
    if (qrCode.oneTimePurchase) {
      const { oneTimePurchase } = qrCode;
      userId = oneTimePurchase.userId;
      planName = `Extra: ${oneTimePurchase.service.name}`;

      if (oneTimePurchase.status !== 'COMPLETED') {
        return res.status(400).json({
          success: false,
          error: 'One-time purchase is not completed',
        });
      }

      if (oneTimePurchase.used) {
        return res.status(400).json({
          success: false,
          error: 'One-time purchase has already been used',
        });
      }

      if (oneTimePurchase.service.type !== washType) {
        return res.status(400).json({
          success: false,
          error: `Invalid wash type. This code is for ${oneTimePurchase.service.type.replace('_', ' ').toLowerCase()}`,
        });
      }
    }
    // Handle Subscription
    else if (qrCode.subscription) {
      const { subscription } = qrCode;
      userId = subscription.userId;
      planName = subscription.plan.name;

      // Check if subscription is active
      if (subscription.status !== 'ACTIVE') {
        return res.status(400).json({
          success: false,
          error: 'Subscription is not active',
        });
      }

      // Check if user has remaining washes for the specific wash type
      let hasRemaining = false;

      if (washType === 'IN_AND_OUT') {
        const remaining = (subscription.plan.inAndOutQuota || 0) - subscription.inAndOutWashesUsed;
        if (remaining > 0) hasRemaining = true;
      } else if (washType === 'OUTSIDE_ONLY') {
        const remaining = (subscription.plan.outsideOnlyQuota || 0) - subscription.outsideOnlyWashesUsed;
        if (remaining > 0) hasRemaining = true;
      }

      if (!hasRemaining) {
        return res.status(400).json({
          success: false,
          error: `No remaining ${washType.replace('_', ' ').toLowerCase()} washes available`,
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid QR code data',
      });
    }

    // Check if QR code has already been used by checking for existing verifications
    // (Though active flag check should cover this, double check)
    // For one-time purchase, we check oneTimePurchase.used above.
    // For subscription, we check if this specific QR code was used?
    // Actually, `active` flag on QRCode handles reuse prevention for both.
    // But let's keep existingVerification logic just in case, adapted for both.

    // Skip this check if active is false (already handled)

    // Verify partner and location exist
    const partner = await prisma.partner.findUnique({
      where: { id: partnerIdInt },
    });

    const location = await prisma.location.findFirst({
      where: {
        id: locationIdInt,
        partnerId: partnerIdInt,
        active: true,
      },
    });

    if (!partner || !location) {
      return res.status(404).json({
        success: false,
        error: 'Invalid partner or location',
      });
    }

    if (partner.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        error: 'Partner account is not active',
      });
    }

    // Create verification record and update subscription/purchase
    const verification = await prisma.$transaction(async (tx) => {
      // Create verification
      const verification = await tx.verification.create({
        data: {
          subscriptionId: qrCode.subscriptionId,
          oneTimePurchaseId: qrCode.oneTimePurchaseId,
          partnerId: partnerIdInt,
          locationId: locationIdInt,
          userId: userId,
          washType: washType as any,
        },
        include: {
          partner: true,
          location: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          subscription: {
            include: {
              plan: true,
            },
          },
          oneTimePurchase: {
            include: {
              service: true
            }
          }
        },
      });

      // Update usage
      if (qrCode.subscriptionId) {
        const updateData: any = {};
        if (washType === 'IN_AND_OUT') {
          updateData.inAndOutWashesUsed = { increment: 1 };
        } else {
          updateData.outsideOnlyWashesUsed = { increment: 1 };
        }

        await tx.subscription.update({
          where: { id: qrCode.subscriptionId },
          data: updateData,
        });
      } else if (qrCode.oneTimePurchaseId) {
        await tx.oneTimePurchase.update({
          where: { id: qrCode.oneTimePurchaseId },
          data: {
            used: true,
            usedAt: new Date(),
            status: 'COMPLETED'
          }
        });
      }

      // Mark QR code as inactive
      await tx.qRCode.update({
        where: { id: qrCode.id },
        data: {
          active: false,
        },
      });

      return verification;
    });

    // Notify user
    await NotificationService.sendToUser(
      userId,
      'Wash Verified',
      `Your ${washType.replace(/_/g, ' ').toLowerCase()} wash at ${partner.name} has been verified.`
    );

    // Create and process payout for the partner
    // Set useStripe to true if you want to use Stripe Connect transfers
    // For now, it's set to false for manual processing/logging

    // For one-time purchase, we might want to pass service price or similar?
    // createAndProcessPayout takes `plan` object.
    // We need to mock plan object for one-time purchase or update createAndProcessPayout.
    // Let's look at createAndProcessPayout signature.
    // It takes `plan: any`.

    let planForPayout: any;
    if (verification.subscription) {
      planForPayout = verification.subscription.plan;
    } else if (verification.oneTimePurchase) {
      // Mock plan object using service details
      const servicePrice = verification.oneTimePurchase.service.price;

      // Fetch platform commission from settings (default 20%)
      const commissionSetting = await prisma.systemSetting.findUnique({
        where: { key: 'commission_percentage' }
      });
      const commissionRate = commissionSetting ? Number(commissionSetting.value) / 100 : 0.20;

      // Calculate partner share based on commission
      const partnerShare = Number((servicePrice * (1 - commissionRate)).toFixed(2));

      planForPayout = {
        name: verification.oneTimePurchase.service.name,
        price: servicePrice,
        inAndOutPayout: partnerShare,
        outsideOnlyPayout: partnerShare,
      };
    }

    const payoutResult = await createAndProcessPayout(
      partnerIdInt,
      verification.id,
      planForPayout,
      washType as any,
      true // Enable Stripe Connect payouts
    );

    if (!payoutResult.success) {
      console.error('Failed to create payout:', payoutResult.error);
      // Note: We don't fail the verification if payout fails
      // The verification is still recorded, payout can be retried later
    } else {
      // Notify Partner about Payout (if processed immediately)
      // Usually `createAndProcessPayout` might handle this, but let's see.
      // It returns payoutId.

      // Let's assume createAndProcessPayout just creates the payout record and attempts transfer.
      // If it's successful, we can notify the partner.
      // But the previous notification in admin.ts was for manual approval.

      // If auto-payout is enabled, partner receives funds instantly?
      // Let's send a notification to Partner about the completed service.
      await NotificationService.sendToPartner(
        partnerIdInt,
        'Service Verified',
        `You successfully verified a ${washType.replace(/_/g, ' ').toLowerCase()} wash.`
      );
    }

    res.json({
      success: true,
      data: {
        ...verification,
        payout: payoutResult.success ? {
          id: payoutResult.payoutId,
          status: 'created',
        } : null,
      },
      message: 'QR code verified successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Get QR code verification history (admin/partner)
router.get('/verifications', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let whereClause = {};

    // If user is a partner, only show their verifications
    if (req.user!.role === 'PARTNER') {
      const partner = await prisma.partner.findFirst({
        where: { email: req.user!.email },
      });

      if (!partner) {
        return res.status(404).json({
          success: false,
          error: 'Partner profile not found',
        });
      }

      whereClause = { partnerId: partner.id };
    } else if (req.user!.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const verifications = await prisma.verification.findMany({
      where: whereClause,
      include: {
        partner: true,
        location: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        subscription: {
          include: {
            plan: true,
          },
        },

      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: verifications,
    });
  } catch (error) {
    next(error);
  }
});

export default router;