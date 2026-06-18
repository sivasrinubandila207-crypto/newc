const dotenv = require('dotenv');
dotenv.config();

const { sendOTPEmail } = require('../backend/services/email-service');

async function run() {
  console.log('Testing email service with current environment variables...');
  console.log('BREVO_API_KEY length:', process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.length : 0);
  console.log('EMAIL_FROM:', process.env.EMAIL_FROM);

  try {
    const res = await sendOTPEmail('sivasrinubandila207@gmail.com', '123456');
    console.log('✅ Email sent successfully:', res);
  } catch (err) {
    console.error('❌ Failed to send email:', err);
  }
}

run();
