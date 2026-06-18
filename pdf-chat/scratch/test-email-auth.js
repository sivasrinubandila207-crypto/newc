/**
 * scratch/test-email-auth.js
 * Test loader to verify backend utilities and services imports.
 */

try {
  console.log('--- Testing Backend Auth Imports ---');
  
  // 1. Test utilities
  const utils = require('../backend/utils');
  console.log('✅ Loaded backend/utils.js successfully');
  const otp = utils.generateOTP();
  console.log(`   - Generated test OTP: ${otp} (length: ${otp.length})`);
  if (otp.length !== 6 || isNaN(Number(otp))) {
    throw new Error('OTP generated is not a 6-digit number!');
  }
  
  // 2. Test email service
  const emailService = require('../backend/email-service');
  console.log('✅ Loaded backend/email-service.js successfully');
  
  // 3. Test db
  const db = require('../backend/db');
  console.log('✅ Loaded backend/db.js successfully');

  // 4. Test auth handler
  const authHandler = require('../backend/auth');
  console.log('✅ Loaded backend/auth.js successfully');
  
  console.log('\n🎉 All backend dependencies and file references are syntactically valid and import correctly.');
} catch (err) {
  console.error('\n❌ Import validation failed:', err);
  process.exit(1);
}
