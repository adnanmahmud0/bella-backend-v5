import { messaging } from '../config/firebase';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class NotificationService {
  /**
   * Send a push notification to a specific device
   */
  static async sendToDevice(token: string, title: string, body: string, data?: Record<string, any>) {
    if (!messaging) {
      console.warn('NotificationService: Firebase not initialized, skipping notification');
      return false;
    }

    // Firebase data values must be strings
    const stringifiedData: Record<string, string> = {};
    if (data) {
      Object.keys(data).forEach(key => {
        stringifiedData[key] = String(data[key]);
      });
    }

    try {
      await messaging.send({
        token,
        notification: {
          title,
          body,
        },
        data: stringifiedData,
      });
      return true;
    } catch (error) {
      console.error('Error sending notification:', error);
      // If token is invalid, we should probably remove it from DB, but for now just log
      return false;
    }
  }

  /**
   * Send notification to a User by ID
   */
  static async sendToUser(userId: number, title: string, body: string, data?: Record<string, any>) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { fcmToken: true },
      });

      if (user?.fcmToken) {
        return await this.sendToDevice(user.fcmToken, title, body, data);
      }
      return false;
    } catch (error) {
      console.error(`Error sending notification to user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Send notification to a Partner by ID
   */
  static async sendToPartner(partnerId: number, title: string, body: string, data?: Record<string, any>) {
    try {
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
        select: { fcmToken: true },
      });

      if (partner?.fcmToken) {
        return await this.sendToDevice(partner.fcmToken, title, body, data);
      }
      return false;
    } catch (error) {
      console.error(`Error sending notification to partner ${partnerId}:`, error);
      return false;
    }
  }

  /**
   * Send notification to all Admins
   */
  static async sendToAdmins(title: string, body: string, data?: Record<string, any>) {
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN', fcmToken: { not: null } },
        select: { fcmToken: true },
      });

      const tokens = admins.map(a => a.fcmToken).filter(t => t !== null) as string[];

      if (tokens.length === 0) return false;

      // Firebase data values must be strings
      const stringifiedData: Record<string, string> = {};
      if (data) {
        Object.keys(data).forEach(key => {
          stringifiedData[key] = String(data[key]);
        });
      }

      // Send multicast
      if (messaging) {
        const response = await messaging.sendEachForMulticast({
          tokens,
          notification: { title, body },
          data: stringifiedData
        });
        return response.successCount > 0;
      }
      return false;
    } catch (error) {
      console.error('Error sending notification to admins:', error);
      return false;
    }
  }
}
