const { MongoClient } = require('mongodb');

let cachedClient = null;

async function getDb() {
  if (cachedClient) return cachedClient.db('pdf-chat');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI environment variable not set');
  const client = new MongoClient(uri, {
    tls: true,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
  });
  await client.connect();
  cachedClient = client;
  
  const db = client.db('pdf-chat');
  // Create indexes asynchronously to avoid blocking the initial connection
  db.collection('documents').createIndex({ userId: 1, name: 1 }).catch(err => console.error('[DB] Failed to create documents index:', err));
  db.collection('sessions').createIndex({ userId: 1, id: 1 }).catch(err => console.error('[DB] Failed to create sessions index:', err));
  db.collection('favorites').createIndex({ userId: 1, content: 1 }).catch(err => console.error('[DB] Failed to create favorites index:', err));
  db.collection('otp_requests').createIndex({ email: 1, requestedAt: 1 }).catch(err => console.error('[DB] Failed to create otp_requests index:', err));
  db.collection('otp_requests').createIndex({ requestedAt: 1 }, { expireAfterSeconds: 600 }).catch(err => console.error('[DB] Failed to create otp_requests TTL index:', err));
  
  return db;
}

module.exports = { getDb };
