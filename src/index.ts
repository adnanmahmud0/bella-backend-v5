import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

// Import routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import planRoutes from './routes/plans';
import subscriptionRoutes from './routes/subscriptions';
import partnerRoutes from './routes/partners';
import locationRoutes from './routes/locations';
import verificationRoutes from './routes/verifications';
import verificationCodeRoutes from './routes/verification';
import qrCodeRoutes from './routes/qrCodes';
import paymentRoutes from './routes/payments';
import paymentMethodRoutes from './routes/paymentMethods';
import billingRoutes from './routes/billing';
import supportRoutes from './routes/support';
import webhookRoutes from './routes/webhooks';
import partnerAuthRoutes from './routes/partnerAuth';
import adminRoutes from './routes/admin';
import postcodeRoutes from './routes/postcodes';
import extraServicesRoutes from './routes/extraServices';
import stripeConnectRoutes from './routes/stripeConnect';
import notificationRoutes from './routes/notifications';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Prisma Client
export const prisma = new PrismaClient();

// Rate limiting (relaxed for development)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
});

// Global middleware
app.use(helmet());
app.use(compression());
app.use(limiter);
app.use(morgan('combined'));

// ✅ GLOBAL CORS (allow all origins)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing middleware
app.use('/api/webhooks', express.raw({ type: 'application/json' })); // Stripe webhooks
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/partner-auth', partnerAuthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/partners', partnerRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/verifications', verificationRoutes);
app.use('/api/verification', verificationCodeRoutes);
app.use('/api/qr-codes', qrCodeRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/postcodes', postcodeRoutes);
app.use('/api/extra-services', extraServicesRoutes);
app.use('/api/stripe-connect', stripeConnectRoutes);
app.use('/api/notifications', notificationRoutes);

// Serve static files
app.use('/uploads', express.static('uploads'));

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚗 Bella Car Wash API is running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
