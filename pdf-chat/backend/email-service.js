/**
 * backend/email-service.js
 * Handles email delivery using nodemailer with custom HTML templates.
 */

const nodemailer = require('nodemailer');

function cleanEnvVar(val) {
  if (!val) return '';
  let clean = String(val).trim();
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.slice(1, -1).trim();
  }
  if (clean.startsWith("'") && clean.endsWith("'")) {
    clean = clean.slice(1, -1).trim();
  }
  return clean;
}

// Create a transporter using SMTP settings from the environment
function getTransporter() {
  const host = cleanEnvVar(process.env.SMTP_HOST || 'smtp.gmail.com');
  const port = parseInt(cleanEnvVar(process.env.SMTP_PORT || '465'), 10);
  const user = cleanEnvVar(process.env.SMTP_USER || process.env.EMAIL_USER || '');
  const rawPass = cleanEnvVar(process.env.SMTP_PASS || process.env.EMAIL_PASS || '');
  // Clean spaces from Gmail app password if present (e.g. "yipk anrg vdxa zuhj" -> "yipkanrgvdxazuhj")
  const pass = rawPass.replace(/\s+/g, '');

  if (!user || !pass) {
    console.warn('[EmailService] SMTP credentials are not fully configured in environment variables.');
  }

  // For Gmail, use an explicit transport configuration on port 587 with family: 4.
  // This bypasses IPv6 connection timeout issues (very common on Render/cloud hosting)
  // and works reliably with TLS STARTTLS on port 587.
  if (host === 'smtp.gmail.com') {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // false for 587
      auth: {
        user,
        pass,
      },
      family: 4, // Force IPv4 to prevent IPv6 routing timeout issues on Render
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    });
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for others (like 587 with STARTTLS)
    auth: {
      user,
      pass,
    },
    family: 4, // Force IPv4 to avoid IPv6 timeout issues for other custom SMTP hosts on Render
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}



/**
 * Sends an email with verification OTP.
 * @param {string} to - Destination email.
 * @param {string} name - User's name.
 * @param {string} otp - 6-digit OTP code.
 * @param {string} action - 'register' or 'reset'
 */
async function sendOTPEmail(to, name, otp, action = 'register') {
  const isReset = action === 'reset';
  const subject = isReset ? 'Reset Your Password — InsightDocs AI' : 'Verify Your Email — InsightDocs AI';
  const titleText = isReset ? 'Password Reset Request' : 'Verify Your Account';
  const descriptionText = isReset
    ? 'We received a request to reset your password. Use the following One-Time Password (OTP) to complete the reset. This code will expire in 10 minutes.'
    : 'Welcome to InsightDocs AI! To activate your account and start chatting with your documents, please verify your email address using the One-Time Password (OTP) below. This code will expire in 10 minutes.';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
      <style>
        body { font-family: 'Inter', -apple-system, sans-serif; background-color: #080b14; color: #f1f5ff; margin: 0; padding: 0; }
        .wrapper { width: 100%; table-layout: fixed; background-color: #080b14; padding: 40px 0; }
        .container { max-width: 600px; margin: 0 auto; background-color: #0d1120; border: 1px solid rgba(99, 120, 180, 0.2); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .header { background: linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899); padding: 30px; text-align: center; }
        .logo { font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; }
        .content { padding: 40px 30px; line-height: 1.6; }
        h1 { font-size: 22px; font-weight: 700; color: #ffffff; margin-top: 0; margin-bottom: 20px; text-align: center; }
        p { color: #94a3b8; font-size: 15px; margin-bottom: 30px; }
        .otp-container { background: rgba(99, 102, 241, 0.08); border: 1.5px dashed rgba(99, 102, 241, 0.4); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 30px; }
        .otp-code { font-size: 32px; font-weight: 800; color: #818cf8; letter-spacing: 6px; font-family: monospace; }
        .footer { padding: 20px 30px; text-align: center; font-size: 12px; color: #475569; border-top: 1px solid rgba(99, 120, 180, 0.1); }
        .footer a { color: #818cf8; text-decoration: none; }
      </style>
    </head>
    <body>
      <table class="wrapper" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div class="container">
              <div class="header">
                <div class="logo">✦ InsightDocs AI</div>
              </div>
              <div class="content">
                <h1>Hi ${name || 'there'},</h1>
                <p>${descriptionText}</p>
                <div class="otp-container">
                  <div class="otp-code">${otp}</div>
                </div>
                <p style="margin-bottom: 0; font-size: 13px;">If you did not request this, you can safely ignore this email.</p>
              </div>
              <div class="footer">
                <p>&copy; 2026 InsightDocs AI. All rights reserved.<br>
                RAG-Powered Multi-Document Knowledge Assistant.</p>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const textContent = `Hi ${name || 'there'},\n\n${descriptionText}\n\nYour OTP Code: ${otp}\n\nIf you did not request this, you can safely ignore this email.\n\n© 2026 InsightDocs AI.`;

  const RESEND_API_KEY = cleanEnvVar(process.env.RESEND_API_KEY);
  if (RESEND_API_KEY) {
    const fetch = require('node-fetch');
    const rawFrom = process.env.SMTP_FROM || process.env.EMAIL_FROM || 'onboarding@resend.dev';
    const from = cleanEnvVar(rawFrom);

    try {
      console.log(`[EmailService] Sending via Resend API to ${to}...`);
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          html: htmlContent,
          text: textContent
        })
      });

      const resBody = await response.text();
      let resData = {};
      try {
        resData = JSON.parse(resBody);
      } catch (e) {
        resData = { raw: resBody };
      }

      if (!response.ok) {
        throw new Error(resData?.message || resBody || 'Failed to send email via Resend API');
      }

      console.log(`[EmailService] Email sent successfully to ${to} via Resend. Message ID: ${resData.id}`);
      return { success: true, messageId: resData.id };
    } catch (err) {
      console.error(`[EmailService] Failed to send email via Resend API to ${to}:`, err);
      throw err;
    }
  }

  // Fallback to SMTP
  const transporter = getTransporter();
  const rawUser = process.env.SMTP_USER || process.env.EMAIL_USER || '';
  const user = cleanEnvVar(rawUser);
  const rawFrom = process.env.SMTP_FROM || process.env.EMAIL_FROM || '';
  const from = rawFrom ? cleanEnvVar(rawFrom) : `"InsightDocs AI" <${user}>`;

  const mailOptions = {
    from,
    to,
    subject,
    html: htmlContent,
    text: textContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailService] Email sent successfully to ${to}. Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EmailService] Failed to send email to ${to}:`, err);
    throw err;
  }
}

module.exports = {
  sendOTPEmail,
};
