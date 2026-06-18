/**
 * @module storage
 * @description API helpers for documents, sessions, and favourites.
 * Uses MongoDB via Netlify Functions, with localStorage as a session fallback.
 *
 * All fetch calls use the shared apiFetch() wrapper from utils/api.js which
 * auto-injects auth headers and attaches .status to thrown errors.
 */
import { apiFetch } from './api.js';

// ── DOCUMENT API ──
// NOTE: MongoDB document limit = 16 MB. Base64 adds ~33% overhead.
// A 10 MB PDF → ~13.3 MB Base64 → safely under 16 MB.
// For production, use GridFS for large binary files.

export const docApi = {
  /** Lists all documents for the authenticated user. */
  async listDocs() {
    return apiFetch('/api/documents?action=list');
  },

  /** Fetches fileBase64 bytes for a single document. */
  async getFile(docId) {
    return apiFetch('/api/documents?action=get-file', {
      method: 'POST',
      body: JSON.stringify({ docId }),
    });
  },

  /** Saves (upserts) a document record. */
  async saveDoc(record) {
    return apiFetch('/api/documents?action=save', {
      method: 'POST',
      body: JSON.stringify(record),
    });
  },

  /** Deletes a single document by its DB id. */
  async deleteDoc(docId) {
    return apiFetch('/api/documents?action=delete', {
      method: 'DELETE',
      body: JSON.stringify({ docId }),
    });
  },

  /** Deletes every document for the authenticated user. */
  async deleteAllDocs() {
    return apiFetch('/api/documents?action=deleteAll', { method: 'DELETE' });
  },
};

// ── SESSION & FAVOURITES API ──
// Falls back to localStorage if the server is unreachable.

export const dbApi = {
  async getSessions() {
    try {
      return await apiFetch('/api/sessions');
    } catch {
      return JSON.parse(localStorage.getItem('ragSessions') || '[]');
    }
  },

  async saveSession(session) {
    try {
      await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(session),
      });
    } catch { /* localStorage handled by caller */ }
  },

  async deleteSession(id) {
    try {
      await apiFetch('/api/sessions', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
    } catch { /* localStorage handled by caller */ }
  },

  async getFavs() {
    try {
      return await apiFetch('/api/favs');
    } catch {
      return JSON.parse(localStorage.getItem('ragFavs') || '[]');
    }
  },

  async addFav(content) {
    try {
      await apiFetch('/api/favs', {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
    } catch { /* localStorage handled by caller */ }
  },

  async removeFav(content) {
    try {
      await apiFetch('/api/favs', {
        method: 'DELETE',
        body: JSON.stringify({ content }),
      });
    } catch { /* localStorage handled by caller */ }
  },
};

/**
 * Saves a document record, falling back to a slim record if the payload is too large.
 * @param {Object} record
 * @returns {Promise<Object>}
 */
export async function saveDocumentRecord(record) {
  try {
    return await docApi.saveDoc(record);
  } catch (err) {
    const isSizeIssue =
      err.status === 413 ||
      err.status === 500 ||
      /16 MB|BSON|payload|too large|large|size|413|500|fetch|network/i.test(err.message || '');
    if (!isSizeIssue) throw err;

    // 1st Fallback: Keep vectorIndex, delete only the heavy fileBase64
    if (record.fileBase64) {
      try {
        console.warn(`[Persist] Payload too large. Retrying without fileBase64 for "${record.name}"`);
        const slimRecord = { ...record };
        delete slimRecord.fileBase64;
        return await docApi.saveDoc(slimRecord);
      } catch (err2) {
        if (!/16 MB|BSON|payload|too large|large|size|413|500|fetch|network/i.test(err2.message || '')) {
          throw err2;
        }
      }
    }

    // 2nd Fallback: Delete both fileBase64 and vectorIndex as last resort
    console.warn(`[Persist] Still too large. Retrying without fileBase64 and vectorIndex for "${record.name}"`);
    const ultraSlimRecord = { ...record };
    delete ultraSlimRecord.fileBase64;
    ultraSlimRecord.vectorIndex = [];
    return await docApi.saveDoc(ultraSlimRecord);
  }
}
