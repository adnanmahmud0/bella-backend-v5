import { PrismaClient } from '@prisma/client';
import { NotificationService } from '../services/notificationService';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🧪 Starting Notification Test...');

  // 1. Find a user with an FCM token
  const user = await prisma.user.findFirst({
    where: {
      fcmToken: {
        not: null
      }
    }
  });

  if (!user) {
    console.error('❌ No user found with an FCM token.');
    console.log('👉 Please login to the frontend application first to register a token.');
    return;
  }

  console.log(`📱 Found user: ${user.name} (ID: ${user.id})`);
  console.log('📨 Sending test notification...');

  // 2. Send notification
  const success = await NotificationService.sendToUser(
    user.id,
    'Test Notification',
    'This is a test message from your backend! 🚀',
    { testId: '123', timestamp: Date.now() }
  );

  if (success) {
    console.log('✅ Notification sent successfully!');
    console.log('👀 Check your browser (or console if in foreground) for the notification.');
  } else {
    console.error('❌ Failed to send notification.');
    console.error('👉 Check your Firebase Admin credentials in .env and ensure the token is valid.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
