const dotenv = require('dotenv');
dotenv.config();

const { sendOTPEmail } = require('../backend/email-service');

async function run() {
  console.log('Testing email service with current environment variables...');
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  console.log('EMAIL_PASS length:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 0);
  console.log('SMTP_HOST:', process.env.SMTP_HOST);
  console.log('SMTP_PORT:', process.env.SMTP_PORT);

  try {
    const res = await sendOTPEmail('sivasrinubandila207@gmail.com', 'Siva Test', '123456', 'register');
    console.log('✅ Email sent successfully:', res);
  } catch (err) {
    console.error('❌ Failed to send email:', err);
  }
}

run();
