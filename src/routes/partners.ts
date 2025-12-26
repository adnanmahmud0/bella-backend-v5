import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../index';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const router = Router();

// Get all active partners
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const partners = await prisma.partner.findMany({
      where: { status: 'ACTIVE' },
      include: {
        locations: {
          where: { active: true },
        },
        _count: {
          select: {
            locations: true,
            verifications: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      data: partners,
    });
  } catch (error) {
    next(error);
  }
});

// Get all partners (admin only)
router.get('/all', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Check if user is admin
    if (req.user!.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
      });
    }

    const partners = await prisma.partner.findMany({
      include: {
        locations: true,
        verifications: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            location: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            locations: true,
            verifications: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      data: partners,
    });
  } catch (error) {
    next(error);
  }
});

// Get partner by ID
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const partner = await prisma.partner.findUnique({
      where: { id },
      include: {
        locations: {
          where: { active: true },
        },
        verifications: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            location: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        _count: {
          select: {
            locations: true,
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

    res.json({
      success: true,
      data: partner,
    });
  } catch (error) {
    next(error);
  }
});

// Create partner (admin only)
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Check if user is admin
    if (req.user!.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
      });
    }

    const { name, email, phone, password } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, phone, and password are required',
      });
    }

    // Check if partner already exists
    const existingPartner = await prisma.partner.findUnique({
      where: { email },
    });

    if (existingPartner) {
      return res.status(400).json({
        success: false,
        error: 'Partner already exists with this email',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const partner = await prisma.partner.create({
      data: {
        name,
        password: hashedPassword,
        email,
        phone,
        status: 'ACTIVE',
      },
    });

    res.status(201).json({
      success: true,
      data: partner,
    });
  } catch (error) {
    next(error);
  }
});

// Public partner application (anybody can apply)
router.post('/apply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name,
      tradingName,
      companyRegistrationNumber,
      contactPersonName,
      email,
      phone,
      openingHours,
      servicesOffered,
      password,
      // Location data
      location
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email and password are required' });
    }

    // Validate location data if provided
    if (location) {
      if (!location.postcode || !location.addressLine1 || !location.city) {
        return res.status(400).json({
          success: false,
          error: 'Postcode, address line 1, and city are required for location'
        });
      }
      if (!location.latitude || !location.longitude) {
        return res.status(400).json({
          success: false,
          error: 'Valid coordinates are required. Please ensure postcode is validated.'
        });
      }
    }

    // Check if partner already exists (by email)
    const existing = await prisma.partner.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'An application or partner with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Create partner with location in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create partner
      const partner = await tx.partner.create({
        data: {
          name,
          tradingName: tradingName || null,
          companyRegistrationNumber: companyRegistrationNumber || null,
          contactPersonName: contactPersonName || null,
          email,
          phone: phone || null,
          openingHours: openingHours || null,
          servicesOffered: servicesOffered || null,
          password: hashedPassword,
          status: 'PENDING', // mark application as pending for admin approval
        },
      });

      // Create primary location if location data provided
      let primaryLocation = null;
      if (location) {
        primaryLocation = await tx.location.create({
          data: {
            partnerId: partner.id,
            name: location.name || `${name} - Main Location`,
            postcode: location.postcode,
            addressLine1: location.addressLine1,
            addressLine2: location.addressLine2 || null,
            city: location.city,
            county: location.county || null,
            country: location.country || 'United Kingdom',
            latitude: location.latitude,
            longitude: location.longitude,
            phone: phone || null, // Use partner phone as default
            hours: openingHours || null, // Use partner hours as default
            isPrimary: true,
            active: false, // Will be activated when partner is approved
          },
        });
      }

      return { partner, primaryLocation };
    });

    // TODO: send notification/email to admins

    res.status(201).json({
      success: true,
      message: 'Application submitted. Your application is under review.',
      partner: {
        id: result.partner.id,
        name: result.partner.name,
        tradingName: result.partner.tradingName,
        email: result.partner.email,
        phone: result.partner.phone,
        contactPersonName: result.partner.contactPersonName,
        status: result.partner.status,
        createdAt: result.partner.createdAt,
        hasLocation: !!result.primaryLocation
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update partner
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }
    const { name, email, phone, status } = req.body;

    const existingPartner = await prisma.partner.findUnique({
      where: { id },
    });

    if (!existingPartner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    // Verify user has permission
    if (req.user!.role !== 'ADMIN') {
      // Check if user is the partner themselves
      if (req.user!.email !== existingPartner.email) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      // Partners can't change their own status
      if (status && status !== existingPartner.status) {
        return res.status(403).json({
          success: false,
          error: 'Cannot change partner status',
        });
      }
    }

    // Check if new email already exists (if changing email)
    if (email && email !== existingPartner.email) {
      const emailExists = await prisma.partner.findUnique({
        where: { email },
      });

      if (emailExists) {
        return res.status(400).json({
          success: false,
          error: 'Email already exists',
        });
      }
    }

    const partner = await prisma.partner.update({
      where: { id },
      data: {
        name: name || existingPartner.name,
        email: email || existingPartner.email,
        phone: phone || existingPartner.phone,
        status: status || existingPartner.status,
      },
      include: {
        locations: {
          where: { active: true },
        },
        _count: {
          select: {
            locations: true,
            verifications: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: partner,
    });
  } catch (error) {
    next(error);
  }
});

// Delete partner (admin only) - soft delete by setting status to INACTIVE
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Check if user is admin
    if (req.user!.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
      });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const existingPartner = await prisma.partner.findUnique({
      where: { id },
      include: {
        locations: {
          where: { active: true },
        },
      },
    });

    if (!existingPartner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    // Deactivate all partner locations as well
    await prisma.location.updateMany({
      where: { partnerId: id },
      data: { active: false },
    });

    const partner = await prisma.partner.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });

    res.json({
      success: true,
      data: partner,
      message: 'Partner and associated locations deactivated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Get partner dashboard data (partner only)
router.get('/dashboard/stats', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Find partner by email
    const partner = await prisma.partner.findFirst({
      where: { email: req.user!.email },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner profile not found',
      });
    }

    // Get dashboard statistics
    const [totalLocations, activeLocations, totalVerifications, recentVerifications] = await Promise.all([
      // Total locations
      prisma.location.count({
        where: { partnerId: partner.id },
      }),
      // Active locations
      prisma.location.count({
        where: { partnerId: partner.id, active: true },
      }),
      // Total verifications
      prisma.verification.count({
        where: { partnerId: partner.id },
      }),
      // Recent verifications (last 30 days)
      prisma.verification.count({
        where: {
          partnerId: partner.id,
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        partner,
        statistics: {
          totalLocations,
          activeLocations,
          totalVerifications,
          recentVerifications,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;