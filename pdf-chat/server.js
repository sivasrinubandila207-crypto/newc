const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Health Check Route
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Import Netlify serverless function handlers
const authHandler = require('./backend/auth').handler;
const chatHandler = require('./backend/chat').handler;
const favsHandler = require('./backend/favs').handler;
const sessionsHandler = require('./backend/sessions').handler;
const embedHandler = require('./backend/embed').handler;
const visionOcrHandler = require('./backend/vision-ocr').handler;
const documentsHandler = require('./backend/documents').handler;

// Adapter to transform Express req/res to Netlify event/response format
async function handleRequest(handler, req, res) {
  // Construct a Netlify-compatible event object
  const event = {
    httpMethod: req.method,
    headers: req.headers,
    queryStringParameters: req.query || {},
    body: req.method !== 'GET' && req.method !== 'DELETE' ? JSON.stringify(req.body) : (req.body ? JSON.stringify(req.body) : null),
    path: req.path,
  };

  try {
    const result = await handler(event);

    // Set headers returned by the handler
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value);
      }
    }

    // Send response
    res.status(result.statusCode || 200).send(result.body);
  } catch (error) {
    console.error(`Error handling ${req.method} ${req.path}:`, error);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.status(500).json({ error: 'Internal Server Error: ' + error.message });
  }
}

// API Routes — registered BEFORE static middleware so /api/* is never intercepted
const routes = [
  { path: '/api/auth', handler: authHandler },
  { path: '/api/chat', handler: chatHandler },
  { path: '/api/chat-test', handler: chatHandler },
  { path: '/api/favs', handler: favsHandler },
  { path: '/api/sessions', handler: sessionsHandler },
  { path: '/api/embed', handler: embedHandler },
  { path: '/api/vision-ocr', handler: visionOcrHandler },
  { path: '/api/documents', handler: documentsHandler },
  // Duplicate for Netlify serverless path calls just in case
  { path: '/.netlify/functions/auth', handler: authHandler },
  { path: '/.netlify/functions/chat', handler: chatHandler },
  { path: '/.netlify/functions/chat-test', handler: chatHandler },
  { path: '/.netlify/functions/favs', handler: favsHandler },
  { path: '/.netlify/functions/sessions', handler: sessionsHandler },
  { path: '/.netlify/functions/embed', handler: embedHandler },
  { path: '/.netlify/functions/vision-ocr', handler: visionOcrHandler },
  { path: '/.netlify/functions/documents', handler: documentsHandler },
];

routes.forEach(route => {
  app.all(route.path, (req, res) => handleRequest(route.handler, req, res));
});

// Landing page — served at root before static files
app.get('/', (req, res) => res.sendFile(__dirname + '/frontend/landing.html'));

// Serve static frontend files AFTER API routes
app.use(express.static('frontend'));

// SPA fallback — any unknown route serves index.html (the chat app)
app.use((req, res) => {
  res.sendFile(__dirname + '/frontend/index.html');
});

const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` InsightDocs AI stand-alone server starting up...`);
  console.log(` Running on: http://localhost:${PORT}`);
  console.log(` Serve static assets from: ./frontend`);
  console.log(`==================================================`);
});
