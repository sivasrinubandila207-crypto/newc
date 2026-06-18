const dotenv = require('dotenv');
const path = require('path');

// Load .env from root directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const { sendOTPEmail } = require('../backend/email-service');

async function test() {
  console.log('Testing Email Service...');
  console.log('EMAIL_USER:', process.env.EMAIL_USER);

  try {
    const testRecipient = process.env.EMAIL_USER || 'sivasrinubandila207@gmail.com';
    console.log(`Sending test email to: ${testRecipient}`);
    const result = await sendOTPEmail(testRecipient, 'Test User', '123456', 'register');
    console.log('Result:', result);
    console.log('Test PASSED!');
  } catch (err) {
    console.error('Test FAILED:', err);
    process.exit(1);
  }
}

test();
