const dotenv = require('dotenv');
dotenv.config();

const { handler } = require('../backend/auth');
const { getDb } = require('../backend/db');

async function runTests() {
  console.log('--- Running Local Real OTP Tests ---');

  let db, users;
  try {
    db = await getDb();
    users = db.collection('users');
    await users.deleteOne({ email: 'sivatest@example.com' });
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }

  // Test 1: Register unverified user
  console.log('\n[Test 1] Testing registration...');
  const regEvent = {
    httpMethod: 'POST',
    queryStringParameters: { action: 'register' },
    body: JSON.stringify({
      name: 'Siva Test',
      email: 'sivatest@example.com',
      password: 'password123'
    })
  };

  try {
    const res = await handler(regEvent);
    console.log('Reg Response Status:', res.statusCode);
    console.log('Reg Response Body:', res.body);
    const body = JSON.parse(res.body);
    if (res.statusCode !== 200) {
      throw new Error('Registration failed');
    }
  } catch (err) {
    console.error('❌ Test 1 Registration Failed:', err);
    process.exit(1);
  }

  // Fetch the real OTP from the database
  const user = await users.findOne({ email: 'sivatest@example.com' });
  if (!user || !user.otp) {
    console.error('❌ Failed to retrieve user or OTP from database!');
    process.exit(1);
  }
  const realOtp = user.otp;
  console.log(`Successfully retrieved real OTP from database: ${realOtp}`);

  // Test 2: Check OTP
  console.log('\n[Test 2] Testing check-otp with real OTP...');
  const checkEvent = {
    httpMethod: 'POST',
    queryStringParameters: { action: 'check-otp' },
    body: JSON.stringify({
      email: 'sivatest@example.com',
      otp: realOtp,
      otpAction: 'register'
    })
  };

  try {
    const res = await handler(checkEvent);
    console.log('Check Response Status:', res.statusCode);
    console.log('Check Response Body:', res.body);
    const body = JSON.parse(res.body);
    if (res.statusCode === 200 && body.valid === true) {
      console.log('✅ Test 2 Passed!');
    } else {
      console.error('❌ Test 2 Failed:', res);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test 2 Error:', err);
    process.exit(1);
  }

  // Test 3: Verify OTP
  console.log('\n[Test 3] Testing verify-otp with real OTP...');
  const verifyEvent = {
    httpMethod: 'POST',
    queryStringParameters: { action: 'verify-otp' },
    body: JSON.stringify({
      email: 'sivatest@example.com',
      otp: realOtp,
      otpAction: 'register'
    })
  };

  try {
    const res = await handler(verifyEvent);
    console.log('Verify Response Status:', res.statusCode);
    console.log('Verify Response Body:', res.body);
    const body = JSON.parse(res.body);
    if (res.statusCode === 200 && body.success === true && body.token) {
      console.log('✅ Test 3 Passed!');
    } else {
      console.error('❌ Test 3 Failed:', res);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test 3 Error:', err);
    process.exit(1);
  }

  // Clean up
  await users.deleteOne({ email: 'sivatest@example.com' });
  console.log('\nCleaned up mock user. All tests completed successfully!');
}

runTests().then(() => {
  process.exit(0);
});
