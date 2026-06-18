/**
 * @module state
 * @description Centralised mutable application state.
 * All modules import from here rather than using global variables.
 */

/** @type {Array<Object>} Loaded document objects */
export const docs = [];

/** @type {Array<Object>} Chat message history */
export const messages = [];

/** @type {{ lastDocument: Object|null, lastSentContext: Object|null }} */
export const debugState = {
  lastDocument: null,
  lastSentContext: null,
};

/** @type {Object|null} Tracks API call counts per chat request */
let _chatRequestMetrics = null;

/** Whether a chat request is in-flight */
export let streaming = false;
export function setStreaming(val) { streaming = val; }

/** Current response style: 'normal' | 'short' | 'detailed' | 'bullets' */
export let responseStyle = 'normal';
export function setResponseStyle(val) { responseStyle = val; }

/** Favourited AI responses */
export let favs = JSON.parse(localStorage.getItem('ragFavs') || '[]');
export function setFavs(arr) { favs = arr; }

/** Voice recognition state */
export let recognition = null;
export let isListening = false;
export function setRecognition(r) { recognition = r; }
export function setIsListening(v) { isListening = v; }

// ── Chat Request Metrics ──

/**
 * Starts a new request metrics tracker.
 * @param {string} requestId
 * @param {string} mode - 'rag' | 'full-context' | 'minimal-test'
 */
export function startChatRequestMetrics(requestId, mode) {
  _chatRequestMetrics = { requestId, mode, total: 0, chat: 0, embed: 0, ocr: 0 };
}

/**
 * Records an API call of a given type.
 * @param {'chat'|'embed'|'ocr'} kind
 */
export function recordApiCall(kind) {
  if (!_chatRequestMetrics) return;
  _chatRequestMetrics.total += 1;
  if (kind === 'chat') _chatRequestMetrics.chat += 1;
  else if (kind === 'embed') _chatRequestMetrics.embed += 1;
  else if (kind === 'ocr') _chatRequestMetrics.ocr += 1;
}

/**
 * Finalises metrics and returns a snapshot.
 * @returns {Object|null}
 */
export function finishChatRequestMetrics() {
  if (!_chatRequestMetrics) return null;
  const snapshot = { ..._chatRequestMetrics };
  debugState.lastSentContext = { ...(debugState.lastSentContext || {}), requestMetrics: snapshot };
  _chatRequestMetrics = null;
  return snapshot;
}
