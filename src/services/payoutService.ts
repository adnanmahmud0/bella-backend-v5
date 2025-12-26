import Stripe from 'stripe';
import { PrismaClient, Plan, WashType } from '@prisma/client';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

export interface PayoutConfig {
  basicWashAmount: number;    // Amount for basic wash (e.g., 2.00)
  premiumWashAmount: number;  // Amount for premium/deluxe wash (e.g., 3.00)
  currency: string;           // Currency (default: 'gbp')
}

// Default payout configuration
export const defaultPayoutConfig: PayoutConfig = {
  basicWashAmount: 2.00,      // £2 per basic wash
  premiumWashAmount: 3.00,    // £3 per premium/deluxe wash
  currency: 'gbp',
};

/**
 * Calculate payout amount based on plan type
 */
export function calculatePayoutAmount(plan: Plan, washType: WashType, config: PayoutConfig = defaultPayoutConfig): number {
  if (washType === 'IN_AND_OUT') {
    if (plan.inAndOutPayout !== null && plan.inAndOutPayout !== undefined) {
      return plan.inAndOutPayout;
    }
  } else if (washType === 'OUTSIDE_ONLY') {
    if (plan.outsideOnlyPayout !== null && plan.outsideOnlyPayout !== undefined) {
      return plan.outsideOnlyPayout;
    }
  }

  // Fallback to name-based calculation if database fields are missing
  const lowerPlanName = plan.name.toLowerCase();

  if (lowerPlanName.includes('premium') || lowerPlanName.includes('deluxe')) {
    return config.premiumWashAmount;
  }

  return config.basicWashAmount;
}

/**
 * Create a payout record in database
 */
export async function createPayoutRecord(
  partnerId: number,
  verificationId: number,
  amount: number,
  description?: string
) {
  return await prisma.payout.create({
    data: {
      partnerId,
      verificationId,
      amount,
      currency: defaultPayoutConfig.currency,
      status: 'PENDING',
      description: description || `Payout for wash service`,
      scheduledFor: new Date(), // Process immediately
    },
    include: {
      partner: {
        select: {
          id: true,
          name: true,
          email: true,
          stripeAccountId: true,
        },
      },
    },
  });
}

/**
 * Process a payout using Stripe Connect Transfer
 * This requires the partner to have a connected Stripe account
 */
export async function processPayoutToStripe(payoutId: number): Promise<boolean> {
  try {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            stripeAccountId: true,
          },
        },
      },
    });

    if (!payout) {
      console.error(`Payout ${payoutId} not found`);
      return false;
    }

    if (payout.status !== 'PENDING' && payout.status !== 'FAILED') {
      console.log(`Payout ${payoutId} is not pending (status: ${payout.status})`);
      return false;
    }

    // Check if partner has Stripe account
    if (!payout.partner.stripeAccountId) {
      console.error(`Partner ${payout.partner.id} does not have a Stripe account`);
      return false;
    }

    // Update status to processing
    await prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'PROCESSING' },
    });

    // Create Stripe transfer
    // Convert amount to cents (Stripe uses smallest currency unit)
    const amountInCents = Math.round(payout.amount * 100);

    const transfer = await stripe.transfers.create({
      amount: amountInCents,
      currency: payout.currency,
      destination: payout.partner.stripeAccountId,
      description: payout.description || `Payout for wash service`,
      metadata: {
        payoutId: payout.id.toString(),
        partnerId: payout.partner.id.toString(),
        verificationId: payout.verificationId?.toString() || '',
      },
    });

    // Update payout record with success
    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: 'PAID',
        stripeTransferId: transfer.id,
        processedAt: new Date(),
        metadata: {
          transferDetails: {
            id: transfer.id,
            amount: transfer.amount,
            created: transfer.created,
            destination: typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id || null,
          },
        } as any,
      },
    });

    console.log(`✅ Payout ${payoutId} processed successfully. Transfer ID: ${transfer.id}`);
    return true;

  } catch (error: any) {
    console.error(`❌ Error processing payout ${payoutId}:`, error);

    // Update payout with failure
    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: 'FAILED',
        failureReason: error.message || 'Unknown error occurred',
        metadata: {
          error: {
            message: error.message,
            type: error.type,
            code: error.code,
          },
        },
      },
    });

    return false;
  }
}

/**
 * Process payout without Stripe (for testing or manual processing)
 * This just marks the payout as pending and logs it
 */
export async function processPayoutManual(payoutId: number): Promise<boolean> {
  try {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!payout) {
      console.error(`Payout ${payoutId} not found`);
      return false;
    }

    console.log(`📋 Manual Payout Record Created:
      Partner: ${payout.partner.name} (${payout.partner.email})
      Amount: $${payout.amount.toFixed(2)}
      Description: ${payout.description}
      Status: Pending manual processing
    `);

    // In a real system, this would be processed by accounting/finance team
    // For now, we just log it and keep it as PENDING

    return true;
  } catch (error) {
    console.error(`Error processing manual payout ${payoutId}:`, error);
    return false;
  }
}

/**
 * Create and process payout for a verification
 * This is the main function called when a wash is completed
 */
export async function createAndProcessPayout(
  partnerId: number,
  verificationId: number,
  plan: Plan,
  washType: WashType,
  useStripe: boolean = false
): Promise<{ success: boolean; payoutId?: number; error?: string }> {
  try {
    // Calculate payout amount based on plan
    const amount = calculatePayoutAmount(plan, washType);

    // Create payout record
    const payout = await createPayoutRecord(
      partnerId,
      verificationId,
      amount,
      `Payout for ${plan.name} wash service`
    );

    console.log(`💰 Payout created: $${amount.toFixed(2)} for partner ${partnerId}`);

    // Process payout
    let success: boolean;
    if (useStripe && payout.partner.stripeAccountId) {
      success = await processPayoutToStripe(payout.id);
    } else {
      success = await processPayoutManual(payout.id);
    }

    return {
      success,
      payoutId: payout.id,
    };

  } catch (error: any) {
    console.error('Error creating and processing payout:', error);
    return {
      success: false,
      error: error.message || 'Failed to create payout',
    };
  }
}

/**
 * Get partner's payout history
 */
export async function getPartnerPayouts(
  partnerId: number,
  limit: number = 50,
  offset: number = 0
) {
  const payouts = await prisma.payout.findMany({
    where: { partnerId },
    include: {
      verification: {
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
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const total = await prisma.payout.count({
    where: { partnerId },
  });

  return {
    payouts,
    total,
    limit,
    offset,
  };
}

/**
 * Get payout statistics for a partner
 */
export async function getPartnerPayoutStats(partnerId: number) {
  const payouts = await prisma.payout.findMany({
    where: { partnerId },
  });

  const totalEarned = payouts
    .filter(p => p.status === 'PAID')
    .reduce((sum, p) => sum + p.amount, 0);

  const pendingAmount = payouts
    .filter(p => p.status === 'PENDING' || p.status === 'PROCESSING')
    .reduce((sum, p) => sum + p.amount, 0);

  const failedAmount = payouts
    .filter(p => p.status === 'FAILED')
    .reduce((sum, p) => sum + p.amount, 0);

  return {
    totalEarned,
    pendingAmount,
    failedAmount,
    totalPayouts: payouts.length,
    paidPayouts: payouts.filter(p => p.status === 'PAID').length,
    pendingPayouts: payouts.filter(p => p.status === 'PENDING' || p.status === 'PROCESSING').length,
    failedPayouts: payouts.filter(p => p.status === 'FAILED').length,
  };
}
