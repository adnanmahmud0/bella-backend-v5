
import Stripe from 'stripe';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.join(__dirname, '../../.env') });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

async function checkBalance() {
  try {
    const balance = await stripe.balance.retrieve();
    console.log('--- Stripe Balance (Test Mode) ---');
    console.log('Available (Ready to pay out/transfer):');
    balance.available.forEach(b => {
      console.log(`  ${b.currency.toUpperCase()}: ${b.amount / 100}`);
    });
    
    console.log('\nPending (Future available):');
    balance.pending.forEach(b => {
      console.log(`  ${b.currency.toUpperCase()}: ${b.amount / 100}`);
    });

  } catch (error) {
    console.error('Error fetching balance:', error);
  }
}

checkBalance();
