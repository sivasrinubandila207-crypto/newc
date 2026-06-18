/**
 * backend/helpers.js — Shared micro-utilities for all backend handlers.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

/**
 * Build a standard JSON Netlify/Express response object.
 * @param {number} status  HTTP status code
 * @param {object} data    Payload to JSON-stringify
 * @param {object} [extraHeaders]  Any additional headers
 */
function respond(status, data, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(data),
  };
}

/** CORS pre-flight response */
const corsOk = { statusCode: 200, headers: CORS, body: '' };

/**
 * Extract and verify JWT from the Authorization header.
 * Returns decoded payload or null.
 */
function verifyToken(event, secret) {
  const jwt = require('jsonwebtoken');
  const raw = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = raw.replace('Bearer ', '').trim();
  if (!token) return null;
  try { return jwt.verify(token, secret); } catch { return null; }
}

module.exports = { CORS, respond, corsOk, verifyToken };
