const dotenv = require('dotenv');
dotenv.config();

const { sendOTPEmail } = require('../backend/email-service');

async function testEmail() {
  console.log('Testing email sending...');
  try {
    const res = await sendOTPEmail(
      'sivasrinubandila207@gmail.com', // sending to self
      'Test User',
      '123456',
      'register'
    );
    console.log('Email sent successfully!', res);
  } catch (err) {
    console.error('Failed to send email:', err);
  }
}

testEmail();
