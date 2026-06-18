require('dotenv').config();
const { handler } = require('../backend/documents');

async function test() {
  // We need to pass a mock auth header. Let's sign a jwt token.
  const jwt = require('jsonwebtoken');
  const SECRET = process.env.JWT_SECRET || 'ragpdfchat_fallback_secret';
  // Let's find a valid userId. Let's inspect the documents in DB to get a userId.
  const { getDb } = require('../backend/db');
  const db = await getDb();
  const doc = await db.collection('documents').findOne({});
  const userId = doc ? doc.userId : 'test_user';
  
  const token = jwt.sign({ userId }, SECRET);
  
  const event = {
    httpMethod: 'GET',
    queryStringParameters: { action: 'list' },
    headers: {
      Authorization: `Bearer ${token}`
    }
  };
  
  const res = await handler(event);
  console.log('Result status:', res.statusCode);
  const body = JSON.parse(res.body);
  console.log('Number of docs returned:', body.length);
  for (const d of body) {
    console.log(`Document: "${d.name}"`);
    console.log(`- fileBase64 present:`, !!d.fileBase64);
    console.log(`- vectorIndex present:`, !!d.vectorIndex);
    if (d.vectorIndex) {
      console.log(`- vectorIndex length:`, d.vectorIndex.length);
    }
  }
}

test().then(() => process.exit(0));
