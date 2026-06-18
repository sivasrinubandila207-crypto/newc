require('dotenv').config();
const { MongoClient } = require('mongodb');

async function test() {
  const uri = process.env.MONGO_URI;
  console.log("URI present:", !!uri);
  console.log("URI starts with:", uri ? uri.substring(0, 20) : "N/A");
  
  const client = new MongoClient(uri, {
    tls: true,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
  });
  
  try {
    console.log("Connecting to MongoDB...");
    await client.connect();
    console.log("Connected successfully!");
    const db = client.db('pdf-chat');
    console.log("Listing collections...");
    const collections = await db.listCollections().toArray();
    console.log("Collections:", collections.map(c => c.name));
  } catch (err) {
    console.error("Connection failed with error:");
    console.error(err);
  } finally {
    await client.close();
  }
}

test();
