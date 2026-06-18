const dotenv = require('dotenv');
dotenv.config();

const { sendOTPEmail } = require('../backend/services/email-service');

async function run() {
  console.log('Testing email service with current environment variables...');
  console.log('BREVO_USER:', process.env.BREVO_USER);
  console.log('BREVO_PASS length:', process.env.BREVO_PASS ? process.env.BREVO_PASS.length : 0);
  console.log('BREVO_SMTP_HOST:', process.env.BREVO_SMTP_HOST);
  console.log('BREVO_SMTP_PORT:', process.env.BREVO_SMTP_PORT);

  try {
    const res = await sendOTPEmail('sivasrinubandila207@gmail.com', '123456');
    console.log('✅ Email sent successfully:', res);
  } catch (err) {
    console.error('❌ Failed to send email:', err);
  }
}

run();
