const dotenv = require('dotenv');
dotenv.config();

const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

async function testMongo() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  console.log('\n--- Testing MongoDB Connection ---');
  console.log('URI:', uri ? uri.substring(0, 30) + '...' : 'undefined');
  if (!uri) {
    console.error('❌ MONGODB_URI or MONGO_URI is not set.');
    return;
  }
  try {
    const client = new MongoClient(uri, { tls: true, connectTimeoutMS: 5000 });
    await client.connect();
    console.log('✅ MongoDB connection successful!');
    await client.close();
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
  }
}

async function testGroq() {
  const key = process.env.GROQ_API_KEY;
  console.log('\n--- Testing Groq API Key ---');
  console.log('Key:', key ? key.substring(0, 10) + '...' : 'undefined');
  if (!key) {
    console.error('❌ GROQ_API_KEY is not set.');
    return;
  }
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5
      })
    });
    const text = await res.text();
    console.log('Response status:', res.status);
    console.log('Response body:', text);
    if (res.status === 200) {
      console.log('✅ Groq API key is VALID!');
    } else {
      console.error('❌ Groq API key is INVALID or rate-limited.');
    }
  } catch (err) {
    console.error('❌ Groq API test failed:', err.message);
  }
}

async function testGemini() {
  const key = process.env.GEMINI_API_KEY;
  console.log('\n--- Testing Gemini API Key ---');
  console.log('Key:', key ? key.substring(0, 10) + '...' : 'undefined');
  if (!key) {
    console.error('❌ GEMINI_API_KEY is not set.');
    return;
  }
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent('Hi');
    console.log('Response text:', result.response.text());
    console.log('✅ Gemini API key is VALID!');
  } catch (err) {
    console.error('❌ Gemini API key is INVALID or rate-limited:', err.message);
  }
}

async function runAll() {
  await testMongo();
  await testGroq();
  await testGemini();
}

runAll();
