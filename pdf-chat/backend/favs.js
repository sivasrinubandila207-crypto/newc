const { getDb } = require('./db');
const jwt = require('jsonwebtoken');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const SECRET = process.env.JWT_SECRET || 'ragpdfchat_fallback_secret';

function getUserId(event) {
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;
  try { return jwt.verify(token, SECRET).userId; } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const userId = getUserId(event);
  const scope = userId || 'guest';

  try {
    const db = await getDb();
    const col = db.collection('favorites');

    // GET — list favorites for this user
    if (event.httpMethod === 'GET') {
      const favs = await col.find({ userId: scope }).sort({ savedAt: -1 }).toArray();
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(favs) };
    }

    // POST — add a favorite
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { content } = body;
      if (!content) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'content required' }) };

      // prevent duplicates per user
      const existing = await col.findOne({ content, userId: scope });
      if (existing) return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, duplicate: true }) };

      await col.insertOne({ content, userId: scope, savedAt: new Date(), date: new Date().toLocaleString() });
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    // DELETE — remove a favorite by content (only this user's)
    if (event.httpMethod === 'DELETE') {
      const { content } = JSON.parse(event.body || '{}');
      if (!content) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'content required' }) };
      await col.deleteOne({ content, userId: scope });
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('favs error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
