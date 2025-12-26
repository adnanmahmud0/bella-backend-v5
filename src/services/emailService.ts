import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';

// Email transporter using Nodemailer (SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Initialize SendGrid (Legacy/Fallback)
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send email using SendGrid as primary, with no fallback to SMTP for now.
 * We prioritize SendGrid because the user specifically requested it.
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  // Use SendGrid as primary service
  try {
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error('SendGrid API key not configured');
    }

    const msg = {
      to: options.to,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'info@bellacarwash.co.uk',
        name: 'Bella Car Wash',
      },
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    await sgMail.send(msg);
    console.log('✅ Email sent successfully via SendGrid to:', options.to);
    return;
  } catch (error: any) {
    console.error('❌ Failed to send email via SendGrid:', error.response?.body || error.message);
    
    // Optional: Fallback to SMTP if SendGrid fails
    console.log('🔄 Attempting fallback to SMTP...');
    try {
      const info = await transporter.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'Bella Car Wash'}" <${process.env.SMTP_USER || process.env.EMAIL_FROM}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      console.log('✅ Email sent successfully via SMTP (fallback):', info.messageId);
    } catch (smtpError: any) {
      console.error('❌ Failed to send email (both SendGrid and SMTP failed):', smtpError.message);
      throw new Error('Failed to send email');
    }
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  userName: string = 'User'
): Promise<void> {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  const subject = 'Reset Your Password - Bella Car Wash';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { 
          display: inline-block; 
          padding: 10px 20px; 
          background-color: #ea580c; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px; 
          margin: 20px 0;
        }
        .footer { font-size: 12px; color: #666; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Hello ${userName},</h2>
        <p>We received a request to reset your password for your Bella Car Wash account.</p>
        <p>Click the button below to reset your password:</p>
        
        <a href="${resetUrl}" class="button">Reset Password</a>
        
        <p>If you didn't request this, you can safely ignore this email. The link will expire in 30 minutes.</p>
        
        <p>Best regards,<br>The Bella Car Wash Team</p>
        
        <div class="footer">
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p>${resetUrl}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
    Hello ${userName},
    
    We received a request to reset your password for your Bella Car Wash account.
    
    Please use the following link to reset your password:
    ${resetUrl}
    
    If you didn't request this, you can safely ignore this email. The link will expire in 30 minutes.
    
    Best regards,
    The Bella Car Wash Team
  `;

  await sendEmail({ to: email, subject, html, text });
}

/**
 * Send partner password reset email
 */
export async function sendPartnerPasswordResetEmail(
  email: string,
  resetToken: string,
  partnerName: string = 'Partner'
): Promise<void> {
  const resetUrl = `${process.env.FRONTEND_URL}/partner-reset-password?token=${resetToken}`;
  const subject = 'Reset Your Partner Password - Bella Car Wash';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { 
          display: inline-block; 
          padding: 10px 20px; 
          background-color: #ea580c; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px; 
          margin: 20px 0;
        }
        .footer { font-size: 12px; color: #666; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Hello ${partnerName},</h2>
        <p>We received a request to reset your password for your Bella Car Wash Partner account.</p>
        <p>Click the button below to reset your password:</p>
        
        <a href="${resetUrl}" class="button">Reset Password</a>
        
        <p>If you didn't request this, you can safely ignore this email. The link will expire in 30 minutes.</p>
        
        <p>Best regards,<br>The Bella Car Wash Team</p>
        
        <div class="footer">
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p>${resetUrl}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
    Hello ${partnerName},
    
    We received a request to reset your password for your Bella Car Wash Partner account.
    
    Please use the following link to reset your password:
    ${resetUrl}
    
    If you didn't request this, you can safely ignore this email. The link will expire in 30 minutes.
    
    Best regards,
    The Bella Car Wash Team
  `;

  await sendEmail({ to: email, subject, html, text });
}

/**
 * Send partner approval email
 */
export async function sendPartnerApprovalEmail(
  partnerEmail: string,
  partnerName: string,
  locationsCount: number
): Promise<void> {
  const subject = '🎉 Your Bella Car Wash Partner Application Has Been Approved!';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Partner Application Approved</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background-color: #ffffff;
          border-radius: 8px;
          padding: 30px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .logo {
          max-width: 150px;
          height: auto;
          margin-bottom: 10px;
        }
        .title {
          color: #10b981;
          font-size: 24px;
          margin-bottom: 20px;
        }
        .content {
          margin-bottom: 25px;
        }
        .highlight {
          background-color: #f0f9ff;
          border-left: 4px solid #3b82f6;
          padding: 15px;
          margin: 20px 0;
          border-radius: 4px;
        }
        .button {
          display: inline-block;
          background-color: #3b82f6;
          color: #ffffff;
          text-decoration: none;
          padding: 12px 30px;
          border-radius: 6px;
          font-weight: 600;
          margin: 20px 0;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          font-size: 14px;
          color: #6b7280;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="${process.env.FRONTEND_URL}/BellaLogo.png" alt="Bella Car Wash" class="logo" />
        </div>
        
        <h1 class="title">Congratulations ${partnerName}!</h1>
        
        <div class="content">
          <p>We're excited to inform you that your partner application has been <strong>approved</strong>! Welcome to the Bella Car Wash partner network.</p>
          
          <div class="highlight">
            <p><strong>Your account is now active:</strong></p>
            <ul>
              <li>✅ Partner account: <strong>ACTIVE</strong></li>
              <li>📍 Active locations: <strong>${locationsCount}</strong></li>
              <li>🔐 Partner portal: Ready to use</li>
            </ul>
          </div>
          
          <p><strong>What's next?</strong></p>
          <ul>
            <li>Log in to your partner dashboard</li>
            <li>Review your location details</li>
            <li>Start accepting customer washes</li>
            <li>Track your earnings and analytics</li>
          </ul>
          
          <div style="text-align: center;">
            <a href="${process.env.FRONTEND_URL}/partner-login" class="button">
              Access Partner Dashboard
            </a>
          </div>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          
          <p>Thank you for partnering with us!</p>
          
          <p style="margin-top: 20px;">
            <strong>Best regards,</strong><br>
            The Bella Car Wash Team
          </p>
        </div>
        
        <div class="footer">
          <p>This is an automated message from Bella Car Wash.<br>
          Please do not reply to this email.</p>
          <p style="margin-top: 10px;">
            Need help? Contact us at <a href="mailto:info@bellacarwash.co.uk">info@bellacarwash.co.uk</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Congratulations ${partnerName}!

We're excited to inform you that your partner application has been approved! Welcome to the Bella Car Wash partner network.

Your account is now active:
- Partner account: ACTIVE
- Active locations: ${locationsCount}
- Partner portal: Ready to use

What's next?
- Log in to your partner dashboard
- Review your location details
- Start accepting customer washes
- Track your earnings and analytics

Access your partner dashboard at: ${process.env.FRONTEND_URL}/partner/login

If you have any questions or need assistance, please don't hesitate to contact our support team.

Thank you for partnering with us!

Best regards,
The Bella Car Wash Team
  `;

  await sendEmail({ to: partnerEmail, subject, html, text });
}

/**
 * Send partner rejection email
 */
export async function sendPartnerRejectionEmail(
  partnerEmail: string,
  partnerName: string,
  reason?: string
): Promise<void> {
  const subject = 'Update on Your Bella Car Wash Partner Application';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Partner Application Update</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background-color: #ffffff;
          border-radius: 8px;
          padding: 30px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .logo {
          max-width: 150px;
          height: auto;
          margin-bottom: 10px;
        }
        .title {
          color: #ef4444;
          font-size: 24px;
          margin-bottom: 20px;
        }
        .content {
          margin-bottom: 25px;
        }
        .highlight {
          background-color: #fef2f2;
          border-left: 4px solid #ef4444;
          padding: 15px;
          margin: 20px 0;
          border-radius: 4px;
        }
        .button {
          display: inline-block;
          background-color: #3b82f6;
          color: #ffffff;
          text-decoration: none;
          padding: 12px 30px;
          border-radius: 6px;
          font-weight: 600;
          margin: 20px 0;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          font-size: 14px;
          color: #6b7280;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="${process.env.FRONTEND_URL}/BellaLogo.png" alt="Bella Car Wash" class="logo" />
        </div>
        
        <h1 class="title">Update on Your Application</h1>
        
        <div class="content">
          <p>Dear ${partnerName},</p>
          
          <p>Thank you for your interest in becoming a partner with Bella Car Wash. After careful review, we regret to inform you that we are unable to approve your partner application at this time.</p>
          
          ${reason ? `
          <div class="highlight">
            <p><strong>Reason:</strong></p>
            <p>${reason}</p>
          </div>
          ` : ''}
          
          <p><strong>What you can do:</strong></p>
          <ul>
            <li>Review your application details for accuracy</li>
            <li>Ensure all required information is complete</li>
            <li>Contact our support team for clarification</li>
            <li>You're welcome to reapply in the future</li>
          </ul>
          
          <p>We appreciate your understanding and interest in Bella Car Wash. If you believe this decision was made in error or if you have any questions, please don't hesitate to reach out to our support team.</p>
          
          <p style="margin-top: 20px;">
            <strong>Best regards,</strong><br>
            The Bella Car Wash Team
          </p>
        </div>
        
        <div class="footer">
          <p>This is an automated message from Bella Car Wash.<br>
          Please do not reply to this email.</p>
          <p style="margin-top: 10px;">
            Need help? Contact us at <a href="mailto:info@bellacarwash.co.uk">info@bellacarwash.co.uk</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Dear ${partnerName},

Thank you for your interest in becoming a partner with Bella Car Wash. After careful review, we regret to inform you that we are unable to approve your partner application at this time.

${reason ? `Reason: ${reason}` : ''}

What you can do:
- Review your application details for accuracy
- Ensure all required information is complete
- Contact our support team for clarification
- You're welcome to reapply in the future

We appreciate your understanding and interest in Bella Car Wash. If you believe this decision was made in error or if you have any questions, please don't hesitate to reach out to our support team.

Best regards,
The Bella Car Wash Team
  `;

  await sendEmail({ to: partnerEmail, subject, html, text });
}
