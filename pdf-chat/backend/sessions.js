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
  // Fall back to a shared "guest" scope if no token (graceful degradation)
  const scope = userId || 'guest';

  try {
    const db = await getDb();
    const col = db.collection('sessions');

    // GET — list sessions for this user
    if (event.httpMethod === 'GET') {
      const sessions = await col.find({ userId: scope }).sort({ updatedAt: -1 }).limit(30).toArray();
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(sessions) };
    }

    // POST — save or update a session
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { id, title, messages } = body;
      if (!id || !messages) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id and messages required' }) };

      await col.updateOne(
        { id, userId: scope },
        { $set: { id, userId: scope, title: title || 'Untitled', messages, updatedAt: new Date() } },
        { upsert: true }
      );
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    // DELETE — remove a session by id (only if owned by this user)
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}');
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id required' }) };
      await col.deleteOne({ id, userId: scope });
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('sessions error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
