const { getDb } = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateOTP } = require('./utils');
const { sendOTPEmail } = require('./email-service');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SECRET = process.env.JWT_SECRET || 'ragpdfchat_fallback_secret';

function makeToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), name: user.name, email: user.email },
    SECRET,
    { expiresIn: '7d' }
  );
}

async function sendOtpForUser(usersCollection, user, otpAction) {
  const otp = generateOTP();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
  await usersCollection.updateOne(
    { _id: user._id },
    { $set: { otp, otpExpiresAt, otpAction } }
  );
  await sendOTPEmail(user.email, user.name, otp, otpAction);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const action = (event.queryStringParameters || {}).action || '';

  try {
    const db = await getDb();
    const users = db.collection('users');
    const body = JSON.parse(event.body || '{}');

    // ── REGISTER ──
    if (action === 'register') {
      const { name, email, password } = body;
      if (!name || !email || !password)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'All fields are required.' }) };
      if (password.length < 6)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Password must be at least 6 characters.' }) };

      const existing = await users.findOne({ email: email.toLowerCase().trim() });
      if (existing) {
        if (!existing.isVerified) {
          await sendOtpForUser(users, existing, 'register');
          return { statusCode: 409, headers: CORS, body: JSON.stringify({ needsVerification: true, email: existing.email }) };
        }
        return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: 'This email is already registered.' }) };
      }

      const hash = await bcrypt.hash(password, 12);
      const newUser = {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hash,
        isVerified: false,
        createdAt: new Date(),
      };
      const result = await users.insertOne(newUser);
      newUser._id = result.insertedId;

      await sendOtpForUser(users, newUser, 'register');
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUser.email }),
      };
    }

    // ── LOGIN ──
    if (action === 'login') {
      const { email, password } = body;
      if (!email || !password)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Email and password are required.' }) };

      const user = await users.findOne({ email: email.toLowerCase().trim() });
      if (!user)
        return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid email or password.' }) };

      const valid = await bcrypt.compare(password, user.password);
      if (!valid)
        return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid email or password.' }) };

      if (!user.isVerified) {
        await sendOtpForUser(users, user, 'register');
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ needsVerification: true, email: user.email }) };
      }

      const token = makeToken(user);
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, user: { name: user.name, email: user.email } }),
      };
    }

    // ── VERIFY (check token validity) ──
    if (action === 'verify') {
      const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
      const token = authHeader.replace('Bearer ', '').trim();
      if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'No token' }) };
      try {
        const decoded = jwt.verify(token, SECRET);
        return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ valid: true, user: decoded }) };
      } catch {
        return { statusCode: 401, headers: CORS, body: JSON.stringify({ valid: false, error: 'Token expired or invalid' }) };
      }
    }

    // ── VERIFY-OTP ──
    if (action === 'verify-otp') {
      const { email, otp, otpAction, newPassword } = body;
      if (!email || !otp || !otpAction)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required parameters.' }) };

      const user = await users.findOne({ email: email.toLowerCase().trim() });
      if (!user)
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'User not found.' }) };

      const isValid = user.otp === otp && user.otpAction === otpAction && user.otpExpiresAt && new Date(user.otpExpiresAt) > new Date();
      if (!isValid)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid or expired OTP.' }) };

      if (otpAction === 'register') {
        await users.updateOne(
          { _id: user._id },
          { $set: { isVerified: true }, $unset: { otp: 1, otpExpiresAt: 1, otpAction: 1 } }
        );
        const token = makeToken(user);
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, token, user: { name: user.name, email: user.email } }),
        };
      } else if (otpAction === 'reset') {
        if (!newPassword) {
          return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
        }
        if (newPassword.length < 6)
          return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Password must be at least 6 characters.' }) };

        const hash = await bcrypt.hash(newPassword, 12);
        await users.updateOne(
          { _id: user._id },
          { $set: { password: hash }, $unset: { otp: 1, otpExpiresAt: 1, otpAction: 1 } }
        );
        return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, message: 'Password reset successful.' }) };
      }
    }

    // ── CHECK-OTP ──
    if (action === 'check-otp') {
      const { email, otp, otpAction } = body;
      if (!email || !otp || !otpAction)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required parameters.' }) };

      const user = await users.findOne({ email: email.toLowerCase().trim() });
      if (!user)
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'User not found.' }) };

      const isValid = user.otp === otp && user.otpAction === otpAction && user.otpExpiresAt && new Date(user.otpExpiresAt) > new Date();
      if (!isValid)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid or expired OTP.', valid: false }) };

      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ valid: true }) };
    }

    // ── RESEND-OTP ──
    if (action === 'resend-otp') {
      const { email, otpAction } = body;
      if (!email || !otpAction)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required parameters.' }) };

      const user = await users.findOne({ email: email.toLowerCase().trim() });
      if (!user)
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'User not found.' }) };

      await sendOtpForUser(users, user, otpAction);
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'OTP resent successfully.' }) };
    }

    // ── FORGOT-PASSWORD ──
    if (action === 'forgot-password') {
      const { email } = body;
      if (!email)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Email is required.' }) };

      const user = await users.findOne({ email: email.toLowerCase().trim() });
      if (!user)
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'No user registered with this email address.' }) };

      await sendOtpForUser(users, user, 'reset');
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Reset code sent.' }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action.' }) };
  } catch (err) {
    console.error('auth error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
