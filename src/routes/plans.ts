import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../index';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Get all active plans (public endpoint)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
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

    res.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    next(error);
  }
});

// Get all plans (admin only)
router.get('/all', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Check if user is admin
    if (req.user!.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
      });
    }

    const plans = await prisma.plan.findMany({
      where: { deleted: false },
      include: {
        subscriptions: {
          select: {
            id: true,
            status: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: {
            subscriptions: true,
          },
        },
      },
      orderBy: { price: 'asc' },
    });

    res.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    next(error);
  }
});

// Get plan by ID
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const plan = await prisma.plan.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            subscriptions: true,
          },
        },
      },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Plan not found',
      });
    }

    res.json({
      success: true,
      data: plan,
    });
  } catch (error) {
    next(error);
  }
});

// Create new plan (admin only)
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Check if user is admin
    if (req.user!.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
      });
    }

    const { name, description, price, duration } = req.body;

    // Validate required fields
    if (!name || !price || !duration) {
      return res.status(400).json({
        success: false,
        error: 'Name, price, and duration are required',
      });
    }

    const plan = await prisma.plan.create({
      data: {
        name,
        description,
        price,
        duration,
        active: true,
      },
    });

    res.status(201).json({
      success: true,
      data: plan,
    });
  } catch (error) {
    next(error);
  }
});

// Update plan (admin only)
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
    const { name, description, price, duration, active } = req.body;

    const existingPlan = await prisma.plan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        error: 'Plan not found',
      });
    }

    const plan = await prisma.plan.update({
      where: { id },
      data: {
        name: name || existingPlan.name,
        description: description !== undefined ? description : existingPlan.description,
        price: price || existingPlan.price,
        duration: duration || existingPlan.duration,
        active: active !== undefined ? active : existingPlan.active,
      },
    });
    res.json({
      success: true,
      data: plan,
    });
  } catch (error) {
    next(error);
  }
});

// Delete plan (admin only) - soft delete by setting active to false
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

    const existingPlan = await prisma.plan.findUnique({
      where: { id },
      include: {
        subscriptions: {
          where: {
            status: 'ACTIVE',
          },
        },
      },
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        error: 'Plan not found',
      });
    }

    // If there are active subscriptions, we soft delete (mark as deleted and inactive)
    // We allow this because the user explicitly wants to delete it.

    const plan = await prisma.plan.update({
      where: { id },
      data: {
        active: false,
        deleted: true
      },
    });

    res.json({
      success: true,
      data: plan,
      message: 'Plan deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;