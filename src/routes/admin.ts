import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import Joi from 'joi';
import Stripe from 'stripe';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { processPayoutToStripe } from '../services/payoutService';
import { sendPartnerApprovalEmail, sendPartnerRejectionEmail } from '../services/emailService';
import { NotificationService } from '../services/notificationService';

const router = Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

// Validation schemas
const createAdminSchema = Joi.object({
  name: Joi.string().required().min(2).max(100),
  email: Joi.string().email().required(),
  password: Joi.string().required().min(8),
  phone: Joi.string().optional().allow(null, ''),
});

// GET /api/admin/users/admins - Get all admin users
router.get('/users/admins', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      admins
    });
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch admins' });
  }
});

// POST /api/admin/users/admins - Create new admin
router.post('/users/admins', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const { error, value } = createAdminSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { name, email, password, phone } = value;

    // Check existing
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'User with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone: phone || null,
        role: 'ADMIN',
        status: 'ACTIVE'
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      admin
    });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ success: false, error: 'Failed to create admin' });
  }
});

// DELETE /api/admin/users/admins/:id - Delete admin
router.delete('/users/admins/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    // Prevent deleting self
    if (id === req.user!.id) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }

    // Check if exists
    const admin = await prisma.user.findUnique({ where: { id } });
    if (!admin) return res.status(404).json({ success: false, error: 'Admin not found' });
    if (admin.role !== 'ADMIN') return res.status(400).json({ success: false, error: 'User is not an admin' });

    await prisma.user.delete({ where: { id } });

    res.json({ success: true, message: 'Admin deleted successfully' });
  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete admin' });
  }
});

const createPartnerSchema = Joi.object({
  name: Joi.string().required().min(2).max(100),
  email: Joi.string().email().required(),
  password: Joi.string().required().min(8),
  phone: Joi.string().optional().allow(null, ''),
  status: Joi.string().valid('PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED').default('ACTIVE'),
});

const updatePartnerSchema = Joi.object({
  name: Joi.string().optional().min(2).max(100),
  email: Joi.string().email().optional(),
  password: Joi.string().optional().min(8),
  phone: Joi.string().optional().allow(null, ''),
  status: Joi.string().valid('PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED').optional(),
});

// POST /api/admin/partners - Create new partner (Admin only)
router.post('/partners', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    // Validate request body
    const { error, value } = createPartnerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message,
      });
    }

    const { name, email, password, phone, status } = value;

    // Check if partner with email already exists
    const existingPartner = await prisma.partner.findUnique({
      where: { email },
    });

    if (existingPartner) {
      return res.status(409).json({
        success: false,
        error: 'Partner with this email already exists',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create partner
    const partner = await prisma.partner.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone: phone || null,
        status: status || 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Partner created successfully',
      partner,
      credentials: {
        email,
        temporaryPassword: password, // Return for admin to share with partner
      },
    });
  } catch (error) {
    console.error('Create partner error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create partner',
    });
  }
});

// GET /api/admin/partners - Get all partners (Admin only)
router.get('/partners', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const { status, search, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (status && (['PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED'] as string[]).includes(status as string)) {
      where.status = status as string;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [partners, total] = await Promise.all([
      prisma.partner.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              locations: true,
              verifications: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.partner.count({ where }),
    ]);

    res.json({
      success: true,
      partners,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('Get partners error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partners',
    });
  }
});

// GET /api/admin/partners/:id - Get partner by ID (Admin only)
router.get('/partners/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid partner ID',
      });
    }

    const partner = await prisma.partner.findUnique({
      where: { id },
      include: {
        locations: true,
        _count: {
          select: {
            verifications: true,
          },
        },
      },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    // Remove password from response
    const { password, ...partnerWithoutPassword } = partner;

    res.json({
      success: true,
      partner: partnerWithoutPassword,
    });
  } catch (error) {
    console.error('Get partner error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partner',
    });
  }
});

// PUT /api/admin/partners/:id - Update partner (Admin only)
router.put('/partners/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    // Validate request body
    const { error, value } = updatePartnerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message,
      });
    }

    // Check if partner exists
    const existingPartner = await prisma.partner.findUnique({
      where: { id },
    });

    if (!existingPartner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    // If email is being changed, check if new email is already in use
    if (value.email && value.email !== existingPartner.email) {
      const emailInUse = await prisma.partner.findUnique({
        where: { email: value.email },
      });

      if (emailInUse) {
        return res.status(409).json({
          success: false,
          error: 'Email already in use',
        });
      }
    }

    // Prepare update data
    const updateData: any = {};
    if (value.name) updateData.name = value.name;
    if (value.email) updateData.email = value.email;
    if (value.phone !== undefined) updateData.phone = value.phone || null;
    if (value.status) updateData.status = value.status;

    // Hash new password if provided
    if (value.password) {
      updateData.password = await bcrypt.hash(value.password, 10);
    }

    // Update partner
    const partner = await prisma.partner.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({
      success: true,
      message: 'Partner updated successfully',
      partner,
    });
  } catch (error) {
    console.error('Update partner error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update partner',
    });
  }
});

// Approve partner application
router.put('/partners/:id/approve', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    const partner = await prisma.partner.findUnique({
      where: { id },
      include: { locations: true }
    });
    if (!partner) return res.status(404).json({ success: false, error: 'Partner not found' });

    // Approve partner and activate all their locations in a transaction
    await prisma.$transaction(async (tx) => {
      // Update partner status to ACTIVE
      await tx.partner.update({
        where: { id },
        data: { status: 'ACTIVE' }
      });

      // Activate all partner locations
      if (partner.locations.length > 0) {
        await tx.location.updateMany({
          where: { partnerId: id },
          data: { active: true }
        });
      }
    });

    // Send approval email to partner
    try {
      await sendPartnerApprovalEmail(
        partner.email,
        partner.name,
        partner.locations.length
      );
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
      // Don't fail the entire request if email fails
    }

    res.json({
      success: true,
      message: `Partner application approved. ${partner.locations.length} location(s) activated.`
    });
  } catch (error) {
    console.error('Approve partner error:', error);
    res.status(500).json({ success: false, error: 'Failed to approve partner' });
  }
});

// Reject partner application
router.put('/partners/:id/reject', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    const { reason } = req.body; // Optional rejection reason from admin

    const partner = await prisma.partner.findUnique({ where: { id } });
    if (!partner) return res.status(404).json({ success: false, error: 'Partner not found' });

    await prisma.partner.update({ where: { id }, data: { status: 'REJECTED' } });

    // Send rejection email to partner
    try {
      await sendPartnerRejectionEmail(partner.email, partner.name, reason);
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
      // Don't fail the entire request if email fails
    }

    res.json({ success: true, message: 'Partner application rejected' });
  } catch (error) {
    console.error('Reject partner error:', error);
    res.status(500).json({ success: false, error: 'Failed to reject partner' });
  }
});

// Update partner status (Active/Inactive/etc)
router.put('/partners/:id/status', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    const { status } = req.body;
    if (!['PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const partner = await prisma.partner.findUnique({
      where: { id },
      include: { locations: true }
    });

    if (!partner) return res.status(404).json({ success: false, error: 'Partner not found' });

    // Update partner status and handle side effects
    await prisma.$transaction(async (tx) => {
      await tx.partner.update({
        where: { id },
        data: { status }
      });

      // Handle location status based on partner status
      if (status === 'ACTIVE') {
        // Activate all locations
        await tx.location.updateMany({
          where: { partnerId: id },
          data: { active: true }
        });
      } else if (status === 'INACTIVE' || status === 'REJECTED') {
        // Deactivate all locations
        await tx.location.updateMany({
          where: { partnerId: id },
          data: { active: false }
        });
      }
    });

    // Notify Partner about status change
    if (status === 'ACTIVE') {
      await NotificationService.sendToPartner(
        id,
        'Account Activated',
        'Your partner account has been activated. You can now accept customers.'
      );
    } else if (status === 'REJECTED') {
      // Assuming rejection email is handled by caller or elsewhere, but notification is good too if they have token.
      // But they might not be able to login if rejected?
      // PENDING -> REJECTED usually means they can't login or limited.
      // Let's notify anyway if token exists.
      await NotificationService.sendToPartner(
        id,
        'Account Rejected',
        'Your partner application was not approved. Please contact support.'
      );
    } else if (status === 'INACTIVE') {
      await NotificationService.sendToPartner(
        id,
        'Account Deactivated',
        'Your partner account has been deactivated.'
      );
    }

    res.json({
      success: true,
      message: `Partner status updated to ${status}`
    });
  } catch (error) {
    console.error('Update partner status error:', error);
    res.status(500).json({ success: false, error: 'Failed to update partner status' });
  }
});

// DELETE /api/admin/partners/:id - Delete partner (Admin only)
router.delete('/partners/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    // Check if partner exists
    const partner = await prisma.partner.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            locations: true,
            verifications: true,
            payouts: true,
          },
        },
      },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    // Check if partner has associated data
    if (partner._count.locations > 0 || partner._count.verifications > 0 || partner._count.payouts > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete partner with associated locations, verifications, or payouts. Set status to INACTIVE instead.',
      });
    }

    // Delete partner
    await prisma.partner.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Partner deleted successfully',
    });
  } catch (error) {
    console.error('Delete partner error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete partner',
    });
  }
});

// GET /api/admin/settings/auto-payout
router.get('/settings/auto-payout', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'AUTO_PAYOUT_ENABLED' }
    });

    res.json({
      success: true,
      enabled: setting?.value === 'true'
    });
  } catch (error) {
    console.error('Get auto-payout setting error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch setting' });
  }
});

// POST /api/admin/settings/auto-payout
router.post('/settings/auto-payout', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const { enabled } = req.body;

    const setting = await prisma.systemSetting.upsert({
      where: { key: 'AUTO_PAYOUT_ENABLED' },
      update: { value: String(enabled) },
      create: {
        key: 'AUTO_PAYOUT_ENABLED',
        value: String(enabled),
        description: 'Automatically approve and process payouts when verification is completed'
      }
    });

    res.json({
      success: true,
      enabled: setting.value === 'true',
      message: `Auto payout ${enabled ? 'enabled' : 'disabled'}`
    });
  } catch (error) {
    console.error('Update auto-payout setting error:', error);
    res.status(500).json({ success: false, error: 'Failed to update setting' });
  }
});

// POST /api/admin/payouts/test-topup - Add test funds to balance
router.post('/payouts/test-topup', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    // Create a charge to add funds to the platform balance
    // Using tok_bypassPending to ensure funds are available immediately
    const charge = await stripe.charges.create({
      amount: 100000, // £1000
      currency: 'gbp',
      source: 'tok_bypassPending',
      description: 'Test Mode Balance Top-up',
    });

    res.json({
      success: true,
      message: 'Successfully added £1000 to test balance. You can now approve payouts.',
      chargeId: charge.id
    });
  } catch (error: any) {
    console.error('Top-up error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to add test funds' });
  }
});

// GET /api/admin/payouts - Get all payouts
router.get('/payouts', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const { status, partnerId, page = '1', limit = '10' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (status) where.status = status as string;
    if (partnerId) where.partnerId = parseInt(partnerId as string);

    const [payouts, total] = await Promise.all([
      prisma.payout.findMany({
        where,
        include: {
          partner: {
            select: {
              name: true,
              email: true,
              stripeAccountId: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.payout.count({ where })
    ]);

    res.json({
      success: true,
      payouts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Get payouts error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payouts' });
  }
});

// PUT /api/admin/payouts/:id/approve - Approve payout
router.put('/payouts/:id/approve', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    // Check if partner has Stripe account connected
    const payoutCheck = await prisma.payout.findUnique({
      where: { id },
      include: {
        partner: {
          select: { stripeAccountId: true }
        }
      }
    });

    if (!payoutCheck) {
      return res.status(404).json({ success: false, error: 'Payout not found' });
    }

    if (!payoutCheck.partner.stripeAccountId) {
      return res.status(400).json({
        success: false,
        error: 'Partner does not have a connected Stripe account. Cannot process auto-payout.'
      });
    }

    // Process via Stripe
    const success = await processPayoutToStripe(id);

    if (success) {
      const payout = await prisma.payout.findUnique({ where: { id } });

      if (payout) {
        await NotificationService.sendToPartner(
          payout.partnerId,
          'Payout Approved',
          `Your payout of £${payout.amount.toFixed(2)} has been approved and processed.`
        );
      }

      return res.json({ success: true, message: 'Payout approved and processed via Stripe', payout });
    }

    // If failed, check reason
    const currentPayout = await prisma.payout.findUnique({ where: { id } });

    if (currentPayout?.status === 'FAILED') {
      return res.status(400).json({ success: false, error: currentPayout.failureReason || 'Stripe transfer failed' });
    }

    return res.status(500).json({ success: false, error: 'Failed to process Stripe payout' });
  } catch (error) {
    console.error('Approve payout error:', error);
    res.status(500).json({ success: false, error: 'Failed to approve payout' });
  }
});

// PUT /api/admin/payouts/:id/mark-paid - Mark payout as paid (Manual)
router.put('/payouts/:id/mark-paid', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    const payout = await prisma.payout.update({
      where: { id },
      data: {
        status: 'PAID',
        processedAt: new Date(),
        metadata: {
          manual: true,
          markedBy: req.user?.id,
          note: 'Marked as paid manually by admin'
        } as any
      }
    });

    res.json({ success: true, message: 'Payout marked as paid manually', payout });
  } catch (error) {
    console.error('Mark paid error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark payout as paid' });
  }
});

// PUT /api/admin/payouts/:id/reject - Reject payout
router.put('/payouts/:id/reject', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });
    const { reason } = req.body;

    const payout = await prisma.payout.update({
      where: { id },
      data: {
        status: 'FAILED',
        failureReason: reason || 'Rejected by admin'
      }
    });

    res.json({ success: true, message: 'Payout rejected', payout });
  } catch (error) {
    console.error('Reject payout error:', error);
    res.status(500).json({ success: false, error: 'Failed to reject payout' });
  }
});

// DELETE /api/admin/payouts/:id - Delete payout
router.delete('/payouts/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    await prisma.payout.delete({ where: { id } });

    res.json({ success: true, message: 'Payout deleted successfully' });
  } catch (error) {
    console.error('Delete payout error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete payout' });
  }
});

// POST /api/admin/partners/:id/reset-password - Reset partner password (Admin only)
router.post('/partners/:id/reset-password', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long',
      });
    }

    // Check if partner exists
    const partner = await prisma.partner.findUnique({
      where: { id },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password
    await prisma.partner.update({
      where: { id },
      data: { password: hashedPassword },
    });

    res.json({
      success: true,
      message: 'Partner password reset successfully',
      credentials: {
        email: partner.email,
        newPassword: password, // Return for admin to share with partner
      },
    });
  } catch (error) {
    console.error('Reset partner password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password',
    });
  }
});

// GET /api/admin/dashboard/stats - Get dashboard statistics (Admin only)
router.get('/dashboard/stats', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Get basic counts
    const [totalCustomers, totalPartners, activeSubscriptions, washesThisMonth] = await Promise.all([
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.partner.count({ where: { status: 'ACTIVE' } }),
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      prisma.verification.count({ where: { createdAt: { gte: startOfMonth } } }),
    ]);

    // Get revenue data by month for the current year
    const revenueData = await prisma.$queryRaw<Array<{ month: string; revenue: number }>>`
      SELECT 
        TO_CHAR("createdAt", 'Mon') as month,
        SUM(amount) as revenue
      FROM "invoices"
      WHERE EXTRACT(YEAR FROM "createdAt") = EXTRACT(YEAR FROM CURRENT_DATE)
      GROUP BY TO_CHAR("createdAt", 'Mon'), EXTRACT(MONTH FROM "createdAt")
      ORDER BY EXTRACT(MONTH FROM "createdAt")
    `;

    // Get wash activity by day for the last 7 days
    const washActivity = await prisma.$queryRaw<Array<{ day: string; washes: number }>>`
      SELECT 
        TO_CHAR("createdAt", 'Day') as day,
        COUNT(*) as washes
      FROM "verifications"
      WHERE "createdAt" >= NOW() - INTERVAL '7 days'
      GROUP BY TO_CHAR("createdAt", 'Day'), EXTRACT(DOW FROM "createdAt")
      ORDER BY EXTRACT(DOW FROM "createdAt")
    `;

    // Get subscription distribution
    const subscriptionDistribution = await prisma.subscription.groupBy({
      by: ['planId'],
      _count: true,
      where: { status: 'ACTIVE' },
    });

    // Get plans for subscription distribution
    const plans = await prisma.plan.findMany({
      select: { id: true, name: true },
    });

    const subscriptionDist = subscriptionDistribution.map((dist) => {
      const plan = plans.find((p) => p.id === dist.planId);
      return {
        name: plan?.name || 'Unknown',
        value: dist._count,
      };
    });

    // Calculate KPIs
    const totalRevenue = revenueData.reduce((sum, item) => sum + Number(item.revenue), 0);
    const avgRevenuePerUser = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;

    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [customersLastMonth, customersThisMonth] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: lastMonthStart, lt: lastMonthEnd } } }),
      prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
    ]);

    const monthlyGrowth = customersLastMonth > 0
      ? ((customersThisMonth - customersLastMonth) / customersLastMonth) * 100
      : 0;

    const [cancelledLastMonth, activeLastMonth] = await Promise.all([
      prisma.subscription.count({
        where: {
          status: 'CANCELLED',
          updatedAt: { gte: lastMonthStart, lt: lastMonthEnd },
        },
      }),
      prisma.subscription.count({
        where: {
          createdAt: { lt: lastMonthStart },
        },
      }),
    ]);

    const churnRate = activeLastMonth > 0 ? (cancelledLastMonth / activeLastMonth) * 100 : 0;

    res.json({
      success: true,
      stats: {
        totalCustomers,
        totalPartners,
        activeSubscriptions,
        washesThisMonth,
        revenue: revenueData.map((r) => ({ month: r.month, revenue: Number(r.revenue) })),
        washActivity: washActivity.map((w) => ({ day: w.day.trim(), washes: Number(w.washes) })),
        subscriptionDistribution: subscriptionDist,
        kpis: {
          avgRevenuePerUser: Math.round(avgRevenuePerUser * 100) / 100,
          customerRetention: Math.round((100 - churnRate) * 100) / 100,
          monthlyGrowth: Math.round(monthlyGrowth * 100) / 100,
          churnRate: Math.round(churnRate * 100) / 100,
        },
      },
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard statistics',
    });
  }
});

// GET /api/admin/revenue/history - Get all revenue history (Admin only)
router.get('/revenue/history', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    // 1. Fetch Paid Invoices (Subscriptions)
    const paidInvoices = await prisma.invoice.findMany({
      where: { status: 'PAID' },
      include: {
        subscription: {
          include: {
            user: {
              select: { id: true, name: true, email: true }
            },
            plan: {
              select: { name: true }
            }
          }
        }
      },
      orderBy: { paidAt: 'desc' }
    });

    // 2. Fetch Completed One-Time Purchases
    const completedPurchases = await prisma.oneTimePurchase.findMany({
      where: { status: 'COMPLETED' },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        },
        service: {
          select: { name: true, price: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // 3. Combine and Normalize Data
    const history = [
      ...paidInvoices.map(inv => ({
        id: `inv_${inv.id}`,
        type: 'SUBSCRIPTION',
        amount: inv.amount,
        status: inv.status,
        date: inv.paidAt || inv.createdAt,
        user: inv.subscription?.user,
        description: `Subscription - ${inv.subscription?.plan.name}`,
        reference: inv.stripeInvoiceId
      })),
      ...completedPurchases.map(p => ({
        id: `otp_${p.id}`,
        type: 'ONE_TIME',
        amount: p.service.price,
        status: p.status,
        date: p.createdAt, // One-time purchases are paid upon creation/completion
        user: p.user,
        description: `Extra Service - ${p.service.name}`,
        reference: p.stripePaymentIntentId
      }))
    ];

    // 4. Sort by Date Descending
    history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Get revenue history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch revenue history' });
  }
});

// GET /api/admin/revenue/settings - Get revenue settings
router.get('/revenue/settings', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const commissionSetting = await prisma.systemSetting.findUnique({
      where: { key: 'commission_percentage' }
    });

    res.json({
      success: true,
      settings: {
        commissionPercentage: commissionSetting ? Number(commissionSetting.value) : 20 // Default 20%
      }
    });
  } catch (error) {
    console.error('Get revenue settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch revenue settings' });
  }
});

// POST /api/admin/revenue/settings - Update revenue settings
router.post('/revenue/settings', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const { commissionPercentage } = req.body;

    if (typeof commissionPercentage !== 'number' || commissionPercentage < 0 || commissionPercentage > 100) {
      return res.status(400).json({ success: false, error: 'Invalid commission percentage' });
    }

    await prisma.systemSetting.upsert({
      where: { key: 'commission_percentage' },
      update: { value: commissionPercentage.toString() },
      create: {
        key: 'commission_percentage',
        value: commissionPercentage.toString(),
        description: 'Platform commission percentage taken from each transaction'
      }
    });

    res.json({
      success: true,
      message: 'Revenue settings updated successfully'
    });
  } catch (error) {
    console.error('Update revenue settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to update revenue settings' });
  }
});

// GET /api/admin/customers - Get all customers (Admin only)
router.get('/customers', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const { search, plan, status } = req.query;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (plan && plan !== 'all') {
      where.subscription = {
        some: {
          plan: {
            name: { equals: plan as string, mode: 'insensitive' },
          },
        },
      };
    }

    const customers = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        subscriptions: {
          select: {
            id: true,
            status: true,
            plan: {
              select: {
                id: true,
                name: true,
                inAndOutQuota: true,
                outsideOnlyQuota: true,
              },
            },
            inAndOutWashesUsed: true,
            outsideOnlyWashesUsed: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedCustomers = customers.map((customer) => {
      const subscription = customer.subscriptions[0];
      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        status: customer.status,
        createdAt: customer.createdAt,
        subscription: subscription
          ? {
            id: subscription.id,
            status: subscription.status,
            plan: subscription.plan.name,
            inAndOutWashesUsed: subscription.inAndOutWashesUsed,
            outsideOnlyWashesUsed: subscription.outsideOnlyWashesUsed,
            inAndOutQuota: subscription.plan.inAndOutQuota,
            outsideOnlyQuota: subscription.plan.outsideOnlyQuota,
          }
          : null,
      };
    });

    res.json({
      success: true,
      customers: formattedCustomers,
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customers',
    });
  }
});

// GET /api/admin/customers/:id - Get customer details (Admin only)
router.get('/customers/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    const customer = await prisma.user.findUnique({
      where: { id },
      include: {
        subscriptions: {
          include: {
            plan: true,
            invoices: {
              orderBy: { createdAt: 'desc' },
              take: 5
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        paymentMethods: true,
        verifications: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        supportTickets: {
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    // Format response
    const { password, ...customerData } = customer;

    // Format subscription for frontend consistency
    const latestSubscription = customer.subscriptions[0];
    const formattedSubscription = latestSubscription ? {
      id: latestSubscription.id,
      status: latestSubscription.status,
      plan: latestSubscription.plan.name,
      inAndOutWashesUsed: latestSubscription.inAndOutWashesUsed,
      outsideOnlyWashesUsed: latestSubscription.outsideOnlyWashesUsed,
      inAndOutQuota: latestSubscription.plan.inAndOutQuota,
      outsideOnlyQuota: latestSubscription.plan.outsideOnlyQuota,
      startDate: latestSubscription.startDate,
      endDate: latestSubscription.endDate,
    } : null;

    res.json({
      success: true,
      customer: {
        ...customerData,
        subscription: formattedSubscription,
      }
    });
  } catch (error) {
    console.error('Get customer details error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch customer details' });
  }
});

// PUT /api/admin/customers/:id - Update customer profile (Admin only)
router.put('/customers/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    const { name, email, phone } = req.body;

    // Check if customer exists
    const existingCustomer = await prisma.user.findUnique({ where: { id } });
    if (!existingCustomer) return res.status(404).json({ success: false, error: 'Customer not found' });

    // Check email uniqueness if changed
    if (email && email !== existingCustomer.email) {
      const emailExists = await prisma.user.findUnique({ where: { email } });
      if (emailExists) return res.status(409).json({ success: false, error: 'Email already in use' });
    }

    const updatedCustomer = await prisma.user.update({
      where: { id },
      data: {
        name,
        email,
        phone
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true
      }
    });

    res.json({
      success: true,
      message: 'Customer profile updated',
      customer: updatedCustomer
    });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ success: false, error: 'Failed to update customer' });
  }
});

// PUT /api/admin/customers/:id/status - Update customer status (Admin only)
router.put('/customers/:id/status', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    const { status } = req.body;
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const customer = await prisma.user.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

    const updatedCustomer = await prisma.user.update({
      where: { id },
      data: { status },
      select: { id: true, status: true }
    });

    res.json({
      success: true,
      message: `Customer status updated to ${status}`,
      customer: updatedCustomer
    });
  } catch (error) {
    console.error('Update customer status error:', error);
    res.status(500).json({ success: false, error: 'Failed to update customer status' });
  }
});

// DELETE /api/admin/customers/:id - Delete customer (Admin only)
router.delete('/customers/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    // Check relations before deleting? Or use cascade delete?
    // Prisma schema usually handles cascade if defined, but better to check.
    // Ideally we should soft delete by setting status to INACTIVE/SUSPENDED.
    // But if admin explicitly requests DELETE, we might want to allow it if no critical history.

    // For now, let's just delete. If it fails due to FK constraints, we'll know.
    // Or we can just set status to SUSPENDED/INACTIVE as "soft delete" logic in frontend.
    // But the route is DELETE. Let's try real delete.

    await prisma.user.delete({ where: { id } });

    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete customer' });
  }
});

// GET /api/admin/customers/export - Export customers to CSV (Admin only)
router.get('/customers/export', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const customers = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        subscriptions: {
          select: {
            status: true,
            plan: { select: { name: true } },
            inAndOutWashesUsed: true,
            outsideOnlyWashesUsed: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Generate CSV
    const csv = [
      'ID,Name,Email,Phone,Join Date,Plan,Status,In&Out Washes Used,Outside Only Washes Used',
      ...customers.map((c) => {
        const sub = c.subscriptions[0];
        return `${c.id},"${c.name}","${c.email}","${c.phone || ''}","${c.createdAt.toISOString().split('T')[0]}","${sub?.plan.name || 'None'}","${sub?.status || 'None'}","${sub?.inAndOutWashesUsed || 0}","${sub?.outsideOnlyWashesUsed || 0}"`;
      }),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
    res.send(csv);
  } catch (error) {
    console.error('Export customers error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export customers',
    });
  }
});

// GET /api/admin/invoices - Get all invoices (Admin only)
router.get('/invoices', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      select: {
        id: true,
        amount: true,
        status: true,
        stripeInvoiceId: true,
        createdAt: true,
        subscription: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({
      success: true,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        customer: inv.subscription?.user.name || 'Unknown',
        amount: inv.amount,
        gateway: 'Stripe',
        status: inv.status.toLowerCase(),
        date: inv.createdAt,
        transactionId: inv.stripeInvoiceId,
      })),
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch invoices',
    });
  }
});

// GET /api/admin/settings - Get admin settings (Admin only)
router.get('/settings', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    // Return mock settings for now - implement actual settings storage later
    res.json({
      success: true,
      settings: {
        payment: {
          stripeKey: process.env.STRIPE_SECRET_KEY || '',
          stripeWebhook: process.env.STRIPE_WEBHOOK_SECRET || '',
          paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
          paypalSecret: process.env.PAYPAL_SECRET || '',
          paypalMode: process.env.PAYPAL_MODE || 'sandbox',
        },
        notifications: {
          emailNotifications: true,
          smsNotifications: false,
          autoRenewalReminders: true,
          failedPaymentAlerts: true,
          partnerReports: true,
          smtpServer: process.env.SMTP_HOST || '',
          smtpUsername: process.env.SMTP_USER || '',
        },
      },
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settings',
    });
  }
});

// PUT /api/admin/settings/payment - Update payment settings (Admin only)
router.put('/settings/payment', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    // In a real application, you would update environment variables or a settings table
    // For now, just return success
    res.json({
      success: true,
      message: 'Payment settings updated successfully',
    });
  } catch (error) {
    console.error('Update payment settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update payment settings',
    });
  }
});

// PUT /api/admin/settings/notifications - Update notification settings (Admin only)
router.put('/settings/notifications', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    // In a real application, you would update environment variables or a settings table
    // For now, just return success
    res.json({
      success: true,
      message: 'Notification settings updated successfully',
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update notification settings',
    });
  }
});

// GET /api/admin/plans - Get all subscription plans (Admin only)
router.get('/plans', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const plans = await prisma.plan.findMany({
      where: { deleted: false },
      orderBy: { price: 'asc' },
    });

    res.json({
      success: true,
      plans,
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch plans',
    });
  }
});

// POST /api/admin/plans - Create new subscription plan (Admin only)
router.post('/plans', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const { name, description, price, duration, vehicleType, tier, inAndOutQuota, outsideOnlyQuota, inAndOutPayout, outsideOnlyPayout } = req.body;

    if (!name || !price || !duration || !vehicleType || !tier || !inAndOutQuota || !inAndOutPayout) {
      return res.status(400).json({
        success: false,
        error: 'Name, price, duration, vehicleType, tier, inAndOutQuota, and inAndOutPayout are required',
      });
    }

    const plan = await prisma.plan.create({
      data: {
        name,
        description: description || null,
        price: parseFloat(price),
        duration: parseInt(duration),
        vehicleType,
        tier,
        inAndOutQuota: parseInt(inAndOutQuota),
        outsideOnlyQuota: outsideOnlyQuota ? parseInt(outsideOnlyQuota) : 0,
        inAndOutPayout: parseFloat(inAndOutPayout),
        outsideOnlyPayout: outsideOnlyPayout ? parseFloat(outsideOnlyPayout) : null,
        active: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      plan,
    });
  } catch (error) {
    console.error('Create plan error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create plan',
    });
  }
});

// PUT /api/admin/plans/:id - Update subscription plan (Admin only)
router.put('/plans/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid plan ID' });
    }

    const { name, description, price, duration, vehicleType, tier, inAndOutQuota, outsideOnlyQuota, inAndOutPayout, outsideOnlyPayout, active } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description || null;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (duration !== undefined) updateData.duration = parseInt(duration);
    if (vehicleType !== undefined) updateData.vehicleType = vehicleType;
    if (tier !== undefined) updateData.tier = tier;
    if (inAndOutQuota !== undefined) updateData.inAndOutQuota = parseInt(inAndOutQuota);
    if (outsideOnlyQuota !== undefined) updateData.outsideOnlyQuota = parseInt(outsideOnlyQuota);
    if (inAndOutPayout !== undefined) updateData.inAndOutPayout = parseFloat(inAndOutPayout);
    if (outsideOnlyPayout !== undefined) updateData.outsideOnlyPayout = outsideOnlyPayout ? parseFloat(outsideOnlyPayout) : null;
    if (active !== undefined) updateData.active = active;

    const plan = await prisma.plan.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      message: 'Plan updated successfully',
      plan,
    });
  } catch (error) {
    console.error('Update plan error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update plan',
    });
  }
});

// DELETE /api/admin/plans/:id - Delete subscription plan (Admin only)
router.delete('/plans/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid plan ID' });
    }

    // Get the plan to check its status
    const existingPlan = await prisma.plan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        error: 'Plan not found',
      });
    }

    // Prevent deletion of active plans
    if (existingPlan.active) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete an active plan. Please make it inactive first.',
      });
    }

    // Soft delete (mark as deleted)
    // The plan must be inactive already (checked above)
    await prisma.plan.update({
      where: { id },
      data: {
        deleted: true
      },
    });

    res.json({
      success: true,
      message: 'Plan deleted successfully',
    });
  } catch (error) {
    console.error('Delete plan error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete plan',
    });
  }
});

// GET /api/admin/extra-services - Get all extra services (Admin only)
router.get('/extra-services', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const services = await prisma.extraService.findMany({
      where: { deleted: false },
      orderBy: { price: 'asc' },
    });

    res.json({
      success: true,
      services,
    });
  } catch (error) {
    console.error('Get extra services error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch extra services',
    });
  }
});

// POST /api/admin/extra-services - Create new extra service (Admin only)
router.post('/extra-services', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const { name, description, price, type, active } = req.body;

    if (!name || !price || !type) {
      return res.status(400).json({
        success: false,
        error: 'Name, price, and type are required',
      });
    }

    if (!['IN_AND_OUT', 'OUTSIDE_ONLY'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid type. Must be IN_AND_OUT or OUTSIDE_ONLY',
      });
    }

    const service = await prisma.extraService.create({
      data: {
        name,
        description: description || null,
        price: parseFloat(price),
        type,
        active: active !== undefined ? active : true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Extra service created successfully',
      service,
    });
  } catch (error) {
    console.error('Create extra service error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create extra service',
    });
  }
});

// PUT /api/admin/extra-services/:id - Update extra service (Admin only)
router.put('/extra-services/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid service ID' });
    }

    const { name, description, price, type, active } = req.body;

    const existingService = await prisma.extraService.findUnique({
      where: { id },
    });

    if (!existingService) {
      return res.status(404).json({
        success: false,
        error: 'Service not found',
      });
    }

    if (type && !['IN_AND_OUT', 'OUTSIDE_ONLY'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid type. Must be IN_AND_OUT or OUTSIDE_ONLY',
      });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description || null;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (type !== undefined) updateData.type = type;
    if (active !== undefined) updateData.active = active;

    const service = await prisma.extraService.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      message: 'Extra service updated successfully',
      service,
    });
  } catch (error) {
    console.error('Update extra service error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update extra service',
    });
  }
});

// DELETE /api/admin/extra-services/:id - Delete extra service (Admin only)
router.delete('/extra-services/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid service ID' });
    }

    // Check if service exists
    const existingService = await prisma.extraService.findUnique({
      where: { id },
    });

    if (!existingService) {
      return res.status(404).json({
        success: false,
        error: 'Service not found',
      });
    }

    // Prevent deletion of active services
    if (existingService.active) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete an active service. Please make it inactive first.',
      });
    }

    // Soft delete (mark as deleted)
    await prisma.extraService.update({
      where: { id },
      data: {
        deleted: true
      },
    });

    res.json({
      success: true,
      message: 'Extra service deleted successfully',
    });
  } catch (error) {
    console.error('Delete extra service error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete extra service',
    });
  }
});

export default router;