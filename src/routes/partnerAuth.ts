import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { getPartnerPayouts, getPartnerPayoutStats } from '../services/payoutService';

import crypto from 'crypto';
import { sendPartnerPasswordResetEmail } from '../services/emailService';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const partnerLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

// POST /api/partner-auth/login - Partner login
router.post('/login', async (req, res) => {
  try {
    // Validate request body
    const { error } = partnerLoginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message,
      });
    }

    const { email, password } = req.body;

    // Find partner by email
    const partner = await prisma.partner.findUnique({
      where: { email },
    });

    if (!partner) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password',
      });
    }

    // Check partner status
    if (partner.status === 'PENDING') {
      return res.status(403).json({
        success: false,
        error: 'Your application is under review.',
      });
    }

    if (partner.status === 'REJECTED') {
      return res.status(403).json({
        success: false,
        error: 'Your application has been rejected. Please contact support.',
      });
    }

    if (partner.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        error: 'Partner account is inactive. Please contact support.',
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, partner.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password',
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: partner.id,
        email: partner.email,
        role: 'PARTNER',
        type: 'partner', // Additional type to distinguish from user tokens
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      partner: {
        id: partner.id,
        name: partner.name,
        email: partner.email,
        phone: partner.phone,
        status: partner.status,
      },
    });
  } catch (error) {
    console.error('Partner login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to login',
    });
  }
});

// GET /api/partner-auth/me - Get current partner profile
router.get('/me', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

    if (decoded.role !== 'PARTNER' && decoded.type !== 'partner') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Partner credentials required.',
      });
    }

    const partner = await prisma.partner.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
      },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    if (partner.status !== 'ACTIVE') {
      return res.status(401).json({
        success: false,
        error: 'Partner account is inactive.',
      });
    }

    res.json({
      success: true,
      partner,
    });
  } catch (error) {
    console.error('Get partner profile error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid token',
    });
  }
});

// Middleware to verify partner token
const verifyPartnerToken = async (req: any, res: any, next: any) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

    if (decoded.role !== 'PARTNER' && decoded.type !== 'partner') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Partner credentials required.',
      });
    }

    // Check if partner exists and is active
    const partner = await prisma.partner.findUnique({
      where: { id: decoded.id },
      select: { status: true }
    });

    if (!partner) {
      return res.status(401).json({
        success: false,
        error: 'Partner not found',
      });
    }

    if (partner.status !== 'ACTIVE') {
      return res.status(401).json({
        success: false,
        error: 'Partner account is inactive.',
      });
    }

    req.partnerId = decoded.id;
    req.partnerEmail = decoded.email;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
    });
  }
};

// GET /api/partner-auth/stats - Get partner dashboard stats
router.get('/stats', verifyPartnerToken, async (req: any, res) => {
  try {
    const partnerId = req.partnerId;

    // Get date ranges
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get all verifications for this partner
    const allVerifications = await prisma.verification.findMany({
      where: { partnerId },
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
    });

    // Today's verifications
    const todayVerifications = allVerifications.filter(
      v => new Date(v.verifiedAt) >= startOfToday
    );

    // This month's verifications
    const thisMonthVerifications = allVerifications.filter(
      v => new Date(v.verifiedAt) >= startOfMonth
    );

    // Last month's verifications
    const lastMonthVerifications = allVerifications.filter(
      v => new Date(v.verifiedAt) >= startOfLastMonth && new Date(v.verifiedAt) < startOfMonth
    );

    // Calculate earnings (using payoutAmount if available, or legacy calculation)
    const calculateEarnings = (verifications: any[]) => {
      return verifications.reduce((total, v) => {
        // Use the recorded payout amount if available (preferred)
        if (v.payoutAmount !== null && v.payoutAmount !== undefined) {
          return total + v.payoutAmount;
        }

        // Fallback for older records or if payoutAmount missing
        if (v.subscription) {
          const planName = v.subscription.plan.name.toLowerCase();
          if (planName.includes('basic')) return total + 2;
          if (planName.includes('premium') || planName.includes('deluxe')) return total + 3;
          return total + 2; // default to basic
        }

        // Should not happen for one-time purchases as they should have payoutAmount
        return total;
      }, 0);
    };

    const thisMonthEarnings = calculateEarnings(thisMonthVerifications);
    const lastMonthEarnings = calculateEarnings(lastMonthVerifications);
    const totalEarnings = calculateEarnings(allVerifications);

    // Get real payout stats from database
    const payoutStats = await getPartnerPayoutStats(partnerId);

    // Calculate percentage change
    const earningsChange = lastMonthEarnings === 0
      ? 100
      : ((thisMonthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100;

    // Get active subscriptions (unique users who have verified in last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const activeSubscriptions = new Set(
      allVerifications
        .filter(v => new Date(v.verifiedAt) >= thirtyDaysAgo)
        .map(v => v.userId) // Use userId to count active users
    ).size;

    // Calculate average per visit
    const averagePerVisit = thisMonthVerifications.length > 0
      ? thisMonthEarnings / thisMonthVerifications.length
      : 0;

    // Calculate retention rate (users who came back this month)
    const lastMonthUsers = new Set(lastMonthVerifications.map(v => v.userId));
    const thisMonthUsers = new Set(thisMonthVerifications.map(v => v.userId));
    const returningUsers = [...thisMonthUsers].filter(u => lastMonthUsers.has(u)).length;
    const retentionRate = lastMonthUsers.size > 0
      ? (returningUsers / lastMonthUsers.size) * 100
      : 0;

    // Calculate average rating (mock for now - would come from reviews)
    const customerRating = 4.8;

    // Monthly breakdown
    const premiumCount = thisMonthVerifications.filter(
      v => v.subscription && v.subscription.plan.name.toLowerCase().includes('premium')
    ).length;

    const basicCount = thisMonthVerifications.filter(
      v => v.subscription && v.subscription.plan.name.toLowerCase().includes('basic')
    ).length;

    // Count extra services/one-time purchases
    const extraServicesCount = thisMonthVerifications.filter(
      v => !!v.oneTimePurchase
    ).length;

    // We can just sum up earnings for the breakdown
    // Note: The original code multiplied counts by fixed rates, which might be inaccurate if rates changed.
    // For now, let's keep the logic consistent but safer.

    let premiumEarnings = 0;
    let basicEarnings = 0;
    let extraServicesEarnings = 0;

    thisMonthVerifications.forEach(v => {
      let amount = 0;
      if (v.payoutAmount !== null && v.payoutAmount !== undefined) {
        amount = v.payoutAmount;
      } else if (v.subscription) {
        const planName = v.subscription.plan.name.toLowerCase();
        if (planName.includes('basic')) amount = 2;
        else if (planName.includes('premium') || planName.includes('deluxe')) amount = 3;
        else amount = 2;
      }

      if (v.oneTimePurchase) {
        extraServicesEarnings += amount;
      } else if (v.subscription) {
        if (v.subscription.plan.name.toLowerCase().includes('premium')) {
          premiumEarnings += amount;
        } else {
          basicEarnings += amount; // basic or others
        }
      }
    });

    const processingFees = 0; // No processing fees deducted from partner payouts
    const netPayout = thisMonthEarnings - processingFees;

    // Pending payout (15th of next month)
    const nextPayoutDate = new Date(now.getFullYear(), now.getMonth() + 1, 15);

    res.json({
      success: true,
      data: {
        totalEarnings: payoutStats.totalEarned.toFixed(2),
        thisMonthEarnings: thisMonthEarnings.toFixed(2),
        earningsChange: earningsChange.toFixed(1),
        pendingPayout: payoutStats.pendingAmount.toFixed(2),
        nextPayoutDate: nextPayoutDate.toISOString(),
        activeSubscriptions,
        payoutStats: {
          totalPaid: payoutStats.totalEarned.toFixed(2),
          pending: payoutStats.pendingAmount.toFixed(2),
          failed: payoutStats.failedAmount.toFixed(2),
          totalPayouts: payoutStats.totalPayouts,
          paidPayouts: payoutStats.paidPayouts,
          pendingPayouts: payoutStats.pendingPayouts,
        },
        performance: {
          totalVisits: thisMonthVerifications.length,
          todayVisits: todayVerifications.length,
          averagePerVisit: averagePerVisit.toFixed(2),
          retentionRate: retentionRate.toFixed(0),
          customerRating: customerRating.toFixed(1),
        },
        monthlyBreakdown: [
          {
            type: 'Premium Subscriptions',
            count: premiumCount,
            amount: premiumEarnings.toFixed(2),
          },
          {
            type: 'Basic Subscriptions',
            count: basicCount,
            amount: basicEarnings.toFixed(2),
          },
          {
            type: 'Extra Services',
            count: extraServicesCount,
            amount: extraServicesEarnings.toFixed(2),
          },
          {
            type: 'Processing Fees',
            count: 0,
            amount: '0.00',
          },
          {
            type: 'Net Payout',
            count: thisMonthVerifications.length,
            amount: netPayout.toFixed(2),
          },
        ],
      },
    });
  } catch (error) {
    console.error('Get partner stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats',
    });
  }
});

// GET /api/partner-auth/recent-visits - Get recent verifications
router.get('/recent-visits', verifyPartnerToken, async (req: any, res) => {
  try {
    const partnerId = req.partnerId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const [verifications, total] = await Promise.all([
      prisma.verification.findMany({
        where: { partnerId },
        include: {
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
              service: true,
            },
          },
          location: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { verifiedAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.verification.count({
        where: { partnerId },
      }),
    ]);

    // Format the data
    const visits = verifications.map(v => ({
      id: v.id,
      customer: {
        name: v.user.name,
        verificationCode: `V-${v.id.toString().padStart(4, '0')}`,
      },
      subscriptionId: v.subscriptionId
        ? `S-${v.subscriptionId.toString().padStart(4, '0')}`
        : `OTP-${v.oneTimePurchaseId?.toString().padStart(4, '0')}`,
      dateTime: v.verifiedAt.toISOString(),
      service: v.subscription
        ? v.subscription.plan.name
        : (v.oneTimePurchase ? `Extra: ${v.oneTimePurchase.service.name}` : 'Unknown Service'),
      status: 'completed', // All verifications in DB are completed
      location: v.location?.name || 'Unknown',
    }));

    // Count today's visits
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayCount = await prisma.verification.count({
      where: {
        partnerId,
        verifiedAt: {
          gte: startOfToday,
        },
      },
    });

    res.json({
      success: true,
      data: {
        visits,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        todayCount,
      },
    });
  } catch (error) {
    console.error('Get recent visits error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent visits',
    });
  }
});

// PUT /api/partner-auth/profile - Update partner profile
router.put('/profile', verifyPartnerToken, async (req: any, res) => {
  try {
    const partnerId = req.partnerId;
    const { name, phone, email } = req.body;

    // Check if email is being changed and if it's already taken
    if (email) {
      const existingPartner = await prisma.partner.findUnique({
        where: { email },
      });

      if (existingPartner && existingPartner.id !== partnerId) {
        return res.status(400).json({
          success: false,
          error: 'Email already in use',
        });
      }
    }

    const updatedPartner = await prisma.partner.update({
      where: { id: partnerId },
      data: {
        ...(name && { name }),
        ...(phone && { phone }),
        ...(email && { email }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
      },
    });

    res.json({
      success: true,
      data: updatedPartner,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
    });
  }
});

// PUT /api/partner-auth/change-password - Change password
router.put('/change-password', verifyPartnerToken, async (req: any, res) => {
  try {
    const partnerId = req.partnerId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required',
      });
    }

    // Validate new password
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters',
      });
    }

    // Get current partner
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, partner.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.partner.update({
      where: { id: partnerId },
      data: { password: hashedPassword },
    });

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password',
    });
  }
});

// POST /api/partner-auth/support-ticket - Submit support ticket
router.post('/support-ticket', verifyPartnerToken, async (req: any, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required',
      });
    }

    // For now, just log the support ticket
    // In production, this would create a ticket in a support system or send an email
    console.log('Support Ticket Received:', {
      partnerId: req.partnerId,
      name,
      email,
      subject,
      message,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: 'Support ticket submitted successfully',
    });
  } catch (error) {
    console.error('Submit support ticket error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit support ticket',
    });
  }
});

// GET /api/partner-auth/payouts - Get partner's payout history
router.get('/payouts', verifyPartnerToken, async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const result = await getPartnerPayouts(req.partnerId, limit, offset);

    res.json({
      success: true,
      data: {
        payouts: result.payouts,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Get payouts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payouts',
    });
  }
});

// GET /api/partner-auth/payout-stats - Get partner's payout statistics
router.get('/payout-stats', verifyPartnerToken, async (req: any, res) => {
  try {
    const stats = await getPartnerPayoutStats(req.partnerId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get payout stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payout statistics',
    });
  }
});

// POST /api/partner-auth/forgot-password - Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
      });
    }

    const partner = await prisma.partner.findUnique({
      where: { email },
    });

    if (!partner) {
      // Don't reveal if user exists
      return res.json({
        success: true,
        message: 'If an account with that email exists, we have sent a password reset link.',
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetPasswordExpires = new Date(Date.now() + 1800000); // 30 minutes

    // Save token to database
    await prisma.partner.update({
      where: { id: partner.id },
      data: {
        resetPasswordToken: resetToken,
        resetPasswordExpires,
      },
    });

    // Send email
    try {
      await sendPartnerPasswordResetEmail(partner.email, resetToken, partner.name);
    } catch (emailError) {
      console.error('Failed to send partner password reset email:', emailError);
      return res.status(500).json({
        success: false,
        error: 'Failed to send password reset email',
      });
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, we have sent a password reset link.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/partner-auth/reset-password - Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: 'Token and password are required',
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long',
      });
    }

    const partner = await prisma.partner.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });

    if (!partner) {
      return res.status(400).json({
        success: false,
        error: 'Password reset token is invalid or has expired',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear reset token
    await prisma.partner.update({
      where: { id: partner.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    res.json({
      success: true,
      message: 'Password has been reset successfully',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
