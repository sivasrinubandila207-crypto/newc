const dotenv = require('dotenv');
dotenv.config();

// Enable bypass for testing
process.env.BYPASS_OTP = 'true';

const { handler } = require('../backend/auth');
const { getDb } = require('../backend/db');

async function runTests() {
  console.log('--- Running Local OTP Bypass & Logging Tests ---');

  let db, users;
  try {
    db = await getDb();
    users = db.collection('users');
    
    // Insert mock user
    await users.deleteOne({ email: 'sivatest@example.com' });
    await users.insertOne({
      name: 'Siva Test',
      email: 'sivatest@example.com',
      password: 'mockpasswordhash',
      isVerified: false,
      createdAt: new Date()
    });
    console.log('Inserted mock user sivatest@example.com');
  } catch (err) {
    console.warn('⚠️ Could not connect to database or prepare mock user:', err.message);
  }

  // Test 1: Check OTP Live API Handler with bypass code
  console.log('\n[Test 1] Testing live OTP check (check-otp) with bypass code "123456"...');
  const checkEvent = {
    httpMethod: 'POST',
    queryStringParameters: { action: 'check-otp' },
    body: JSON.stringify({
      email: 'sivatest@example.com',
      otp: '123456',
      otpAction: 'register'
    })
  };

  try {
    const res = await handler(checkEvent);
    console.log('Response Status:', res.statusCode);
    console.log('Response Body:', res.body);
    const body = JSON.parse(res.body);
    if (res.statusCode === 200 && body.valid === true) {
      console.log('✅ Test 1 Passed!');
    } else {
      console.error('❌ Test 1 Failed:', res);
    }
  } catch (err) {
    console.error('❌ Test 1 Error:', err);
  }

  // Test 2: Verify OTP API Handler (verify-otp) with bypass code
  console.log('\n[Test 2] Testing OTP verification (verify-otp) with bypass code "123456"...');
  const verifyEvent = {
    httpMethod: 'POST',
    queryStringParameters: { action: 'verify-otp' },
    body: JSON.stringify({
      email: 'sivatest@example.com',
      otp: '123456',
      otpAction: 'register'
    })
  };

  try {
    const res = await handler(verifyEvent);
    console.log('Response Status:', res.statusCode);
    console.log('Response Body:', res.body);
    const body = JSON.parse(res.body);
    if (res.statusCode === 200 && body.success === true) {
      console.log('✅ Test 2 Passed!');
    } else {
      console.error('❌ Test 2 Failed:', res);
    }
  } catch (err) {
    console.error('❌ Test 2 Error:', err);
  }

  // Clean up
  if (users) {
    await users.deleteOne({ email: 'sivatest@example.com' });
    console.log('\nCleaned up mock user.');
  }
}

runTests().then(() => {
  process.exit(0);
});
