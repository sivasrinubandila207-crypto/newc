/**
 * documents.js — Document Persistence Handler
 *
 * Stores and retrieves user-uploaded PDF documents in MongoDB.
 * Each document record includes: userId, metadata, OCR text, page text,
 * embeddings (vectorIndex), and the Base64-encoded PDF bytes.
 *
 * ⚠️  STORAGE NOTE:
 *   MongoDB has a hard document size limit of 16 MB per document.
 *   Base64 encoding increases file size by ~33%, so a 10 MB PDF becomes ~13 MB.
 *   This approach works for typical academic/personal PDFs in this internship version.
 *   For production-scale deployments, replace fileBase64 storage with MongoDB GridFS,
 *   which handles large binary files without the 16 MB document limit.
 *
 * Supported actions (via query param ?action=<action>):
 *   GET  ?action=list       — Fetch all documents belonging to the logged-in user
 *   POST ?action=save       — Save a new document record (upsert by name)
 *   DELETE ?action=delete   — Delete a single document by docId
 *   DELETE ?action=deleteAll — Delete all documents for the logged-in user
 *   POST ?action=reprocess  — Return stored text/pages for re-embedding (no OCR)
 */

const { getDb } = require('./db');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const SECRET = process.env.JWT_SECRET || 'ragpdfchat_fallback_secret';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

// ── JWT Auth Helper ──
function verifyToken(event) {
  const authHeader =
    event.headers['authorization'] ||
    event.headers['Authorization'] ||
    '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // Authenticate every request
  const decoded = verifyToken(event);
  if (!decoded) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized. Please log in again.' }),
    };
  }

  const userId = decoded.userId;
  const action = (event.queryStringParameters || {}).action || '';

  try {
    const db = await getDb();
    const col = db.collection('documents');

    // ── LIST — fetch all docs for this user ──
    if (event.httpMethod === 'GET' && action === 'list') {
      // Exclude heavy fields (fileBase64) from the list for speed.
      const docs = await col
        .find(
          { userId },
          {
            projection: {
              fileBase64: 0,
            },
          }
        )
        .sort({ uploadedAt: -1 })
        .toArray();

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify(docs),
      };
    }

    // ── GET-FILE — fetch fileBase64 for a single document ──
    if (event.httpMethod === 'POST' && action === 'get-file') {
      const body = JSON.parse(event.body || '{}');
      const { docId } = body;

      if (!docId) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'docId is required.' }),
        };
      }

      let filter;
      try {
        filter = { _id: new ObjectId(docId), userId };
      } catch {
        filter = { _id: docId, userId };
      }

      const doc = await col.findOne(filter, {
        projection: { fileBase64: 1 },
      });

      if (!doc || !doc.fileBase64) {
        return {
          statusCode: 404,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'File data not found.' }),
        };
      }

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: doc.fileBase64 }),
      };
    }

    // ── SAVE — insert or update a document record ──
    if (event.httpMethod === 'POST' && action === 'save') {
      const body = JSON.parse(event.body || '{}');

      const {
        name,
        pageCount,
        ocrExtracted,
        text,
        pages,
        pageConfidences,
        vectorIndex,
        fileBase64,
        nativeRollsCount,
        processedRollsCount,
      } = body;

      if (!name) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'name is required.' }),
        };
      }

      const record = {
        userId,
        name,
        uploadedAt: new Date(),
        pageCount: pageCount || 0,
        ocrExtracted: !!ocrExtracted,
        text: text || '',
        pages: pages || [],
        pageConfidences: pageConfidences || {},
        vectorIndex: Array.isArray(vectorIndex) ? vectorIndex : [],
        nativeRollsCount: nativeRollsCount || 0,
        processedRollsCount: processedRollsCount || 0,
      };

      if (fileBase64) {
        record.fileBase64 = fileBase64;
      }

      // Upsert: if the same user uploads the same filename, overwrite it.
      const result = await col.updateOne(
        { userId, name },
        {
          $set: record,
        },
        { upsert: true }
      );

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          upserted: result.upsertedCount > 0,
        }),
      };
    }

    // ── DELETE — remove a single document by _id ──
    if (event.httpMethod === 'DELETE' && action === 'delete') {
      const body = JSON.parse(event.body || '{}');
      const { docId } = body;

      if (!docId) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'docId is required.' }),
        };
      }

      let filter;
      try {
        // _id is ObjectId when stored via MongoDB driver
        filter = { _id: new ObjectId(docId), userId };
      } catch {
        // Fallback: treat as string id (upserted docs may have string _id)
        filter = { _id: docId, userId };
      }

      await col.deleteOne(filter);

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      };
    }

    // ── DELETE ALL — remove every document for this user ──
    if (event.httpMethod === 'DELETE' && action === 'deleteAll') {
      const result = await col.deleteMany({ userId });

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, deleted: result.deletedCount }),
      };
    }

    // ── REPROCESS — return stored text/pages so frontend can re-embed ──
    if (event.httpMethod === 'POST' && action === 'reprocess') {
      const body = JSON.parse(event.body || '{}');
      const { docId } = body;

      if (!docId) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'docId is required.' }),
        };
      }

      let filter;
      try {
        filter = { _id: new ObjectId(docId), userId };
      } catch {
        filter = { _id: docId, userId };
      }

      const doc = await col.findOne(filter, {
        projection: { text: 1, pages: 1, name: 1 },
      });

      if (!doc) {
        return {
          statusCode: 404,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Document not found.' }),
        };
      }

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: doc.text, pages: doc.pages, name: doc.name }),
      };
    }

    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unknown action or method.' }),
    };
  } catch (err) {
    console.error('[Documents] Handler error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server error: ' + err.message }),
    };
  }
};
