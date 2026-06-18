require('dotenv').config();
const { handler } = require('../backend/documents');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'ragpdfchat_fallback_secret';

async function runTest() {
  // Generate a valid mock JWT
  const token = jwt.sign({ userId: '65f1a23b4c5d6e7f8a9b0c1d' }, SECRET, { expiresIn: '1h' });
  
  const mockEvent = {
    httpMethod: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    queryStringParameters: {
      action: 'list'
    }
  };
  
  console.log("Invoking documents handler with mock request...");
  try {
    const result = await handler(mockEvent);
    console.log("Handler status code:", result.statusCode);
    console.log("Handler response body:", result.body);
  } catch (err) {
    console.error("Handler crashed with exception:");
    console.error(err);
  }
}

runTest();
