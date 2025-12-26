import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import Stripe from 'stripe';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { NotificationService } from '../services/notificationService';

const router = Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

// GET /api/extra-services - List all available extra services
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const services = await prisma.extraService.findMany({
      where: { active: true, deleted: false },
      orderBy: { price: 'asc' },
    });
    res.json(services);
  } catch (error) {
    console.error('Error fetching extra services:', error);
    res.status(500).json({ message: 'Failed to fetch services' });
  }
});

// POST /api/extra-services/create-payment-intent - Create Stripe Payment Intent
router.post('/create-payment-intent', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { serviceId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const service = await prisma.extraService.findUnique({
      where: { id: serviceId },
    });

    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Create a pending purchase record
    const purchase = await prisma.oneTimePurchase.create({
      data: {
        userId,
        serviceId,
        status: 'PENDING',
      },
    });

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(service.price * 100), // Convert to pence
      currency: 'gbp',
      metadata: {
        purchaseId: purchase.id.toString(),
        userId: userId.toString(),
        serviceId: serviceId.toString(),
        type: 'extra_service',
      },
    });

    // Update purchase with payment intent ID
    await prisma.oneTimePurchase.update({
      where: { id: purchase.id },
      data: { stripePaymentIntentId: paymentIntent.id },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      purchaseId: purchase.id,
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ message: 'Failed to create payment intent' });
  }
});

// POST /api/extra-services/confirm-payment - Confirm payment and generate QR code
router.post('/confirm-payment', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { paymentIntentId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ message: 'Payment not successful' });
    }

    const purchaseId = parseInt(paymentIntent.metadata.purchaseId);

    // Update purchase status
    const purchase = await prisma.oneTimePurchase.update({
      where: { id: purchaseId },
      data: { status: 'COMPLETED' },
      include: { service: true },
    });

    // Generate Confirmation Code (Verification Code style)
    const generateShortCode = (): string => {
      return crypto.randomBytes(4).toString('hex').toUpperCase();
    };

    let code: string = '';
    let isUnique = false;
    while (!isUnique) {
      code = generateShortCode();
      const existing = await prisma.verificationCode.findUnique({
        where: { code },
      });
      if (!existing) isUnique = true;
    }

    // Create Verification Code record (valid for 30 minutes or until used)
    const verificationCode = await prisma.verificationCode.create({
      data: {
        oneTimePurchaseId: purchase.id,
        code: code,
        qrCodeData: '', // Will update after generating
        washType: purchase.service.type,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes validity
      },
    });

    // Generate QR Code image with same structure as verification.ts
    const qrData = JSON.stringify({
      code: code,
      oneTimePurchaseId: purchase.id,
      userId,
      washType: purchase.service.type,
      timestamp: Date.now(),
    });

    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    // Update with QR data
    await prisma.verificationCode.update({
      where: { id: verificationCode.id },
      data: { qrCodeData: qrCodeDataUrl },
    });

    // Notify user
    await NotificationService.sendToUser(
      userId,
      'Extra Service Confirmed',
      `Your purchase of ${purchase.service.name} was successful.`
    );

    res.json({
      success: true,
      purchase,
      verificationCode: {
        id: verificationCode.id,
        code: code,
        qrCode: qrCodeDataUrl,
        expiresAt: verificationCode.expiresAt,
        washType: verificationCode.washType,
      },
    });

  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({ message: 'Failed to confirm payment' });
  }
});

// GET /api/extra-services/purchases - List user's past purchases
router.get('/purchases', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const purchases = await prisma.oneTimePurchase.findMany({
      where: {
        userId,
        status: 'COMPLETED'
      },
      include: {
        service: true,
        qrCode: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(purchases);
  } catch (error) {
    console.error('Error fetching purchases:', error);
    res.status(500).json({ message: 'Failed to fetch purchases' });
  }
});

// Create new extra service (Admin only)
router.post('/', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description, price, type, active } = req.body;

    if (!name || !price || !type) {
      return res.status(400).json({ success: false, error: 'Name, price and type are required' });
    }

    const service = await prisma.extraService.create({
      data: {
        name,
        description,
        price: parseFloat(price),
        type,
        active: active !== undefined ? active : true
      }
    });

    res.status(201).json({ success: true, service });
  } catch (error) {
    console.error('Create extra service error:', error);
    res.status(500).json({ success: false, error: 'Failed to create extra service' });
  }
});

// Update extra service (Admin only)
router.put('/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    const { name, description, price, type, active } = req.body;

    const service = await prisma.extraService.update({
      where: { id },
      data: {
        name,
        description,
        price: price ? parseFloat(price) : undefined,
        type,
        active
      }
    });

    res.json({ success: true, service });
  } catch (error) {
    console.error('Update extra service error:', error);
    res.status(500).json({ success: false, error: 'Failed to update extra service' });
  }
});

// Delete extra service (Admin only)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

    // Soft delete
    await prisma.extraService.update({
      where: { id },
      data: {
        deleted: true,
        active: false
      }
    });

    res.json({ success: true, message: 'Extra service deleted successfully' });
  } catch (error) {
    console.error('Delete extra service error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete extra service' });
  }
});

export default router;
