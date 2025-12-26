
import Stripe from 'stripe';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.join(__dirname, '../../.env') });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

async function addFunds() {
  try {
    console.log('Attempting to add £1000 GBP to balance...');
    const charge = await stripe.charges.create({
      amount: 100000, // £1000
      currency: 'gbp',
      source: 'tok_bypassPending', // Special test token for immediate availability
      description: 'Test Mode Balance Top-up (GBP)',
    });
    
    console.log('Charge created:', charge.id);
    console.log('Status:', charge.status);
    
    // Check balance immediately after
    const balance = await stripe.balance.retrieve();
    console.log('\n--- Updated Stripe Balance ---');
    balance.available.forEach(b => {
      console.log(`  ${b.currency.toUpperCase()}: ${b.amount / 100}`);
    });

  } catch (error: any) {
    console.error('Error adding funds:', error.message);
  }
}

addFunds();
