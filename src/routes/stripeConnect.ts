import { Router } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { partnerAuthenticate } from '../middleware/auth';
import { Request, Response, NextFunction } from 'express';

const router = Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

// GET /api/stripe-connect/status - Check Stripe account status
router.get('/status', partnerAuthenticate, async (req: any, res) => {
  try {
    const partnerId = req.partner!.id;
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { stripeAccountId: true }
    });

    if (!partner?.stripeAccountId) {
      return res.json({
        success: true,
        status: {
          connected: false,
          detailsSubmitted: false,
          payoutsEnabled: false
        }
      });
    }

    const account = await stripe.accounts.retrieve(partner.stripeAccountId);

    res.json({
      success: true,
      status: {
        connected: true,
        accountId: account.id,
        detailsSubmitted: account.details_submitted,
        payoutsEnabled: account.payouts_enabled,
        chargesEnabled: account.charges_enabled,
      }
    });
  } catch (error) {
    console.error('Error fetching Stripe account status:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch account status' });
  }
});

// POST /api/stripe-connect/onboard - Create account and get onboarding link
router.post('/onboard', partnerAuthenticate, async (req: any, res) => {
  try {
    const partnerId = req.partner!.id;
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId }
    });

    if (!partner) {
      return res.status(404).json({ success: false, error: 'Partner not found' });
    }

    let accountId = partner.stripeAccountId;

    // Create Stripe Connect account if doesn't exist
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB', // Default to UK
        email: partner.email,
        business_type: 'individual', // Can be updated during onboarding
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true }, // Required for GB accounts
        },
        metadata: {
          partnerId: partner.id.toString(),
        },
      });

      accountId = account.id;

      // Save to DB
      await prisma.partner.update({
        where: { id: partnerId },
        data: { stripeAccountId: accountId }
      });
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/partner/settings?refresh=true`,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/partner/settings?success=true`,
      type: 'account_onboarding',
    });

    res.json({
      success: true,
      url: accountLink.url,
      accountId: accountId
    });
  } catch (error: any) {
    console.error('Error creating onboarding link:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create onboarding link',
      details: error
    });
  }
});

// POST /api/stripe-connect/login-link - Get dashboard login link
router.post('/login-link', partnerAuthenticate, async (req: any, res) => {
  try {
    const partnerId = req.partner!.id;
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { stripeAccountId: true }
    });

    if (!partner?.stripeAccountId) {
      return res.status(400).json({ success: false, error: 'No Stripe account connected' });
    }

    const loginLink = await stripe.accounts.createLoginLink(partner.stripeAccountId);

    res.json({
      success: true,
      url: loginLink.url
    });
  } catch (error) {
    console.error('Error creating login link:', error);
    res.status(500).json({ success: false, error: 'Failed to create login link' });
  }
});

export default router;
