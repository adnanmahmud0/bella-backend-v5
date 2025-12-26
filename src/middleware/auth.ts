import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: string;
  };
  partner?: {
    id: number;
    email: string;
  };
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    console.log('Authorization Header:', req.header('Authorization'));
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    console.log('Decoded JWT:', decoded);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token.',
      });
    }

    if (user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
      return res.status(403).json({
        success: false,
        error: 'Account is suspended or inactive.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid token.',
    });
  }
};

export const partnerAuthenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    console.log('Authorization Header:', req.header('Authorization'));
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    console.log('Decoded JWT:', decoded);

    const partner = await prisma.partner.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, status: true },
    });

    if (!partner) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token.',
      });
    }

    if (partner.status !== 'ACTIVE') {
      return res.status(401).json({
        success: false,
        error: 'Partner account is inactive.',
      });
    }

    req.partner = { id: partner.id, email: partner.email };
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid token.',
    });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. User not authenticated.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Insufficient permissions.',
      });
    }

    next();
  };
};