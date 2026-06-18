require('dotenv').config();
const { handler } = require('../backend/embed');

async function test() {
  const event = {
    httpMethod: 'POST',
    body: JSON.stringify({ texts: ['hello world'] })
  };
  const res = await handler(event);
  console.log('Result:', res);
}

test();
