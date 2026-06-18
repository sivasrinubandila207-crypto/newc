/**
 * @module logger
 * @description Environment-aware logger. Verbose in development, silent in production.
 * Replaces scattered console.log calls with categorised, filterable output.
 */

const IS_DEV = !window.location.hostname.includes('netlify.app')
  && !window.location.hostname.includes('insightdocs')
  && window.location.hostname !== '';

/**
 * Logs an informational message with a category prefix.
 * @param {string} category - Module/area label e.g. 'OCR', 'RAG', 'Embed'
 * @param {string} message
 * @param {...*} args - Additional values to log
 */
export function log(category, message, ...args) {
  if (IS_DEV) console.log(`[${category}] ${message}`, ...args);
}

/**
 * Logs a warning.
 * @param {string} category
 * @param {string} message
 * @param {...*} args
 */
export function warn(category, message, ...args) {
  console.warn(`[${category}] ${message}`, ...args);
}

/**
 * Logs an error. Always shown (even in production).
 * @param {string} category
 * @param {string} message
 * @param {...*} args
 */
export function error(category, message, ...args) {
  console.error(`[${category}] ${message}`, ...args);
}

/**
 * Logs a diagnostic message (OCR/Retrieval details).
 * Shown only in dev mode.
 * @param {string} message
 * @param {...*} args
 */
export function diagnostic(message, ...args) {
  if (IS_DEV) console.log(`[Diagnostic] ${message}`, ...args);
}
