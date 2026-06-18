const dotenv = require('dotenv');
const path = require('path');

// Load .env from root directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const { sendOTPEmail } = require('../backend/services/email-service');

async function test() {
  console.log('Testing Email Service...');
  console.log('BREVO_API_KEY:', process.env.BREVO_API_KEY ? 'Present (length ' + process.env.BREVO_API_KEY.length + ')' : 'Missing');
  console.log('EMAIL_FROM:', process.env.EMAIL_FROM);

  try {
    const testRecipient = process.env.EMAIL_FROM || 'sivasrinubandila207@gmail.com';
    console.log(`Sending test email to: ${testRecipient}`);
    const result = await sendOTPEmail(testRecipient, '123456');
    console.log('Result:', result);
    console.log('Test PASSED!');
  } catch (err) {
    console.error('Test FAILED:', err);
    process.exit(1);
  }
}

test();
