/**
 * backend/services/email-service.js
 * Handles email delivery using Brevo HTTP API with rate-limiting and custom HTML templates.
 */

const { getDb } = require('../db');

/**
 * Checks and logs OTP request to enforce rate limit (max 3 requests per email per 10 minutes)
 * @param {string} email 
 * @returns {Promise<{allowed: boolean, error?: string}>}
 */
async function checkRateLimit(email) {
  try {
    const db = await getDb();
    const otpRequests = db.collection('otp_requests');
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    // Count requests in last 10 minutes
    const count = await otpRequests.countDocuments({
      email: email.toLowerCase().trim(),
      requestedAt: { $gte: tenMinutesAgo }
    });
    
    if (count >= 3) {
      return { allowed: false, error: "Rate limit exceeded. Maximum 3 OTP requests per 10 minutes allowed." };
    }
    
    // Log new request
    await otpRequests.insertOne({
      email: email.toLowerCase().trim(),
      requestedAt: new Date()
    });
    
    return { allowed: true };
  } catch (err) {
    console.error("[EmailService] Rate limiting database check failed:", err);
    // Fail-safe: allow if database query fails to not block users entirely
    return { allowed: true };
  }
}

/**
 * Common HTML template builder
 */
function getHtmlContent(otp, title, description, warning) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>InsightDocs AI Verification Code</title>
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
        .warning { font-size: 13px; color: #64748b; margin-top: 20px; border-top: 1px solid rgba(99, 120, 180, 0.1); padding-top: 20px; }
        .footer { padding: 20px 30px; text-align: center; font-size: 12px; color: #475569; border-top: 1px solid rgba(99, 120, 180, 0.1); }
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
                <h1>${title}</h1>
                <p>${description}</p>
                <div class="otp-container">
                  <div class="otp-code">${otp}</div>
                </div>
                <p style="font-size: 14px; text-align: center; color: #6366f1; font-weight: 600; margin-top: -15px;">This verification code is valid for 10 minutes.</p>
                <div class="warning">
                  <strong>Security Warning:</strong> ${warning}
                </div>
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
}

/**
 * Sends an email using Brevo's REST API.
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {string} text
 * @returns {Promise<any>}
 */
async function sendBrevoEmail(to, subject, html, text) {
  const response = await fetch(
    'https://api.brevo.com/v3/smtp/email',
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: {
          name: 'InsightDocs AI',
          email: process.env.EMAIL_FROM
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

/**
 * Sends a registration/login verification OTP email.
 * @param {string} email
 * @param {string} otp
 * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
 */
async function sendOTPEmail(email, otp) {
  try {
    // Check rate limit
    const rateLimit = await checkRateLimit(email);
    if (!rateLimit.allowed) {
      return { success: false, error: rateLimit.error };
    }

    const title = 'Verify Your Account';
    const description = 'Welcome to InsightDocs AI! To activate your account and start chatting with your documents, please verify your email address using the One-Time Password (OTP) below.';
    const warning = 'If you did not request this verification code, please ignore this email. Do not share this OTP with anyone.';

    const html = getHtmlContent(otp, title, description, warning);
    const text = `Verify Your Account\n\nWelcome to InsightDocs AI! Please verify your email using this OTP: ${otp}. It is valid for 10 minutes. If you did not request this, please ignore this email.`;

    const result = await sendBrevoEmail(
      email,
      'InsightDocs AI Verification Code',
      html,
      text
    );

    return {
      success: true,
      messageId: result.messageId
    };
  } catch (error) {
    console.error('[EmailService] sendOTPEmail failed:', error);
    return { success: false, error: 'Email delivery failed' };
  }
}

/**
 * Sends a forgot password OTP email.
 * @param {string} email
 * @param {string} otp
 * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
 */
async function sendPasswordResetEmail(email, otp) {
  try {
    // Check rate limit
    const rateLimit = await checkRateLimit(email);
    if (!rateLimit.allowed) {
      return { success: false, error: rateLimit.error };
    }

    const title = 'Reset Your Password';
    const description = 'We received a request to reset your password. Use the following One-Time Password (OTP) to complete the reset.';
    const warning = 'If you did not request a password reset, please ignore this email and secure your account. Do not share this OTP with anyone.';

    const html = getHtmlContent(otp, title, description, warning);
    const text = `Reset Your Password\n\nWe received a request to reset your password. Use this OTP to reset it: ${otp}. It is valid for 10 minutes. If you did not request this, please ignore this email.`;

    const result = await sendBrevoEmail(
      email,
      'InsightDocs AI Verification Code',
      html,
      text
    );

    return {
      success: true,
      messageId: result.messageId
    };
  } catch (error) {
    console.error('[EmailService] sendPasswordResetEmail failed:', error);
    return { success: false, error: 'Email delivery failed' };
  }
}

module.exports = {
  sendOTPEmail,
  sendPasswordResetEmail
};
