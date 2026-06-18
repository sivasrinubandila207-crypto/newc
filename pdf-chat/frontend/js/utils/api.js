/**
 * @module api
 * @description Shared authenticated fetch wrapper used across all modules.
 *
 * Benefits over raw fetch():
 *  - Auto-injects Content-Type and Authorization headers
 *  - Throws typed errors with .status attached (enables fallback logic in callers)
 *  - Single place to change auth strategy or base URL
 */
import { getAuthHeaders } from '../auth/auth.js';

/**
 * Performs an authenticated JSON fetch and returns the parsed response.
 *
 * @param {string} url - Endpoint path (e.g. '/api/documents?action=list')
 * @param {RequestInit} [options={}] - Fetch options (method, body, extra headers…)
 * @returns {Promise<any>} Parsed JSON body on success
 * @throws {Error} With `.status` set to the HTTP status code on failure
 *
 * @example
 * const data = await apiFetch('/api/documents?action=list');
 * const result = await apiFetch('/api/embed', { method: 'POST', body: JSON.stringify({ texts }) });
 */
export async function apiFetch(url, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const res = await fetch(url, {
    ...rest,
    headers: {
      ...getAuthHeaders(),
      ...(extraHeaders || {}),
    },
  });

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) errMsg = body.error;
    } catch { /* non-JSON error body — keep HTTP status message */ }
    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }

  return res.json();
}
