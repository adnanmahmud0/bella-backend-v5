import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, partnerAuthenticate, AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// Register FCM Token for User
router.post('/register-token', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { token } = req.body;
    const userId = req.user?.id;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token }
    });

    res.json({ success: true, message: 'Token registered successfully' });
  } catch (error) {
    console.error('Error registering token:', error);
    res.status(500).json({ success: false, error: 'Failed to register token' });
  }
});

// Register FCM Token for Partner
router.post('/partner/register-token', partnerAuthenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { token } = req.body;
    const partnerId = req.partner?.id;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    await prisma.partner.update({
      where: { id: partnerId },
      data: { fcmToken: token }
    });

    res.json({ success: true, message: 'Partner token registered successfully' });
  } catch (error) {
    console.error('Error registering partner token:', error);
    res.status(500).json({ success: false, error: 'Failed to register token' });
  }
});

import { NotificationService } from '../services/notificationService';

// Test Notification Endpoint (Admin only ideally, but keeping simple for now)
router.post('/test', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const success = await NotificationService.sendToUser(
      userId,
      'Test Notification',
      'This is a test notification from the Admin Dashboard! 🚀'
    );

    if (success) {
      res.json({ success: true, message: 'Notification sent successfully' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to send notification. Check server logs.' });
    }
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
