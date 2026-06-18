const dotenv = require('dotenv');
dotenv.config();

const authHandler = require('../backend/auth').handler;

async function runTest() {
  const mockEvent = {
    httpMethod: 'POST',
    queryStringParameters: { action: 'forgot-password' },
    body: JSON.stringify({ email: 'sivasrinubandila207@gmail.com' }),
    headers: {}
  };

  console.log('--- Testing Forgot Password Handler ---');
  console.time('handlerExecution');
  try {
    const result = await authHandler(mockEvent);
    console.timeEnd('handlerExecution');
    console.log('Result Status:', result.statusCode);
    console.log('Result Body:', result.body);
  } catch (err) {
    console.timeEnd('handlerExecution');
    console.error('Handler crashed:', err);
  }
}

runTest();
