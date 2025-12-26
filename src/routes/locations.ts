import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../index';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Get all active locations
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locations = await prisma.location.findMany({
      where: { 
        active: true,
        partner: {
          status: 'ACTIVE'
        }
      },
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      data: locations,
    });
  } catch (error) {
    next(error);
  }
});

// Get nearby locations
router.get('/nearby', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lat, lng, radius = 10 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: 'Latitude and longitude are required',
      });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);
    const searchRadius = parseFloat(radius as string);

    // Get all active locations with active partners
    const allLocations = await prisma.location.findMany({
      where: {
        active: true,
        partner: {
          status: 'ACTIVE'
        }
      },
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    // Calculate distance for each location using Haversine formula
    const locationsWithDistance = allLocations.map((location) => {
      const lat1 = latitude;
      const lon1 = longitude;
      const lat2 = location.latitude;
      const lon2 = location.longitude;

      // Haversine formula
      const R = 6371; // Radius of the Earth in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c; // Distance in km

      return {
        ...location,
        distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
      };
    });

    // Filter by radius and sort by distance
    const nearbyLocations = locationsWithDistance
      .filter((loc) => loc.distance <= searchRadius)
      .sort((a, b) => a.distance - b.distance);

    res.json({
      success: true,
      data: nearbyLocations,
    });
  } catch (error) {
    next(error);
  }
});

// Get location by ID
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const location = await prisma.location.findUnique({
      where: { id },
      include: {
        partner: true,
        verifications: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10, // Last 10 verifications
        },
        _count: {
          select: {
            verifications: true,
          },
        },
      },
    });

    if (!location) {
      return res.status(404).json({
        success: false,
        error: 'Location not found',
      });
    }

    res.json({
      success: true,
      data: location,
    });
  } catch (error) {
    next(error);
  }
});

// Create location (partner/admin only)
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { 
      partnerId, 
      name, 
      postcode,
      addressLine1,
      addressLine2,
      city,
      county,
      country,
      latitude, 
      longitude, 
      phone, 
      hours,
      isPrimary
    } = req.body;

    // Verify user has permission
    if (req.user!.role !== 'ADMIN') {
      // Check if user is partner and creating location for themselves
      const partner = await prisma.partner.findFirst({
        where: { email: req.user!.email },
      });

      if (!partner || partner.id !== partnerId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }
    }

    // Validate required fields
    if (!partnerId || !name || !postcode || !addressLine1 || !city || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: 'Partner ID, name, postcode, address line 1, city, latitude, and longitude are required',
      });
    }

    // Verify partner exists
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    const location = await prisma.location.create({
      data: {
        partnerId,
        name,
        postcode,
        addressLine1,
        addressLine2: addressLine2 || null,
        city,
        county: county || null,
        country: country || 'United Kingdom',
        latitude,
        longitude,
        phone: phone || null,
        hours: hours || null,
        isPrimary: isPrimary || false,
        active: true,
      },
      include: {
        partner: true,
      },
    });

    res.status(201).json({
      success: true,
      data: location,
    });
  } catch (error) {
    next(error);
  }
});

// Update location
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }
    const { 
      name, 
      postcode,
      addressLine1,
      addressLine2,
      city,
      county,
      country,
      latitude, 
      longitude, 
      phone, 
      hours, 
      active,
      isPrimary
    } = req.body;

    const existingLocation = await prisma.location.findUnique({
      where: { id },
      include: { partner: true },
    });

    if (!existingLocation) {
      return res.status(404).json({
        success: false,
        error: 'Location not found',
      });
    }

    // Verify user has permission
    if (req.user!.role !== 'ADMIN') {
      const partner = await prisma.partner.findFirst({
        where: { email: req.user!.email },
      });

      if (!partner || partner.id !== existingLocation.partnerId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }
    }

    const location = await prisma.location.update({
      where: { id },
      data: {
        name: name || existingLocation.name,
        postcode: postcode || existingLocation.postcode,
        addressLine1: addressLine1 || existingLocation.addressLine1,
        addressLine2: addressLine2 !== undefined ? addressLine2 : existingLocation.addressLine2,
        city: city || existingLocation.city,
        county: county !== undefined ? county : existingLocation.county,
        country: country || existingLocation.country,
        latitude: latitude || existingLocation.latitude,
        longitude: longitude || existingLocation.longitude,
        phone: phone !== undefined ? phone : existingLocation.phone,
        hours: hours !== undefined ? hours : existingLocation.hours,
        active: active !== undefined ? active : existingLocation.active,
        isPrimary: isPrimary !== undefined ? isPrimary : existingLocation.isPrimary,
      },
      include: {
        partner: true,
      },
    });

    res.json({
      success: true,
      data: location,
    });
  } catch (error) {
    next(error);
  }
});

// Delete location (soft delete by setting active to false)
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const existingLocation = await prisma.location.findUnique({
      where: { id },
    });

    if (!existingLocation) {
      return res.status(404).json({
        success: false,
        error: 'Location not found',
      });
    }

    // Verify user has permission
    if (req.user!.role !== 'ADMIN') {
      const partner = await prisma.partner.findFirst({
        where: { email: req.user!.email },
      });

      if (!partner || partner.id !== existingLocation.partnerId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }
    }

    const location = await prisma.location.update({
      where: { id },
      data: { active: false },
    });

    res.json({
      success: true,
      data: location,
      message: 'Location deactivated successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;