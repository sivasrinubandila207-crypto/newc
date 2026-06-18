/**
 * @module geminiKeyManager
 * @description Manages a pool of Gemini API keys with automatic rotation and cooldowns.
 *
 * Configuration:
 *   Set GEMINI_API_KEYS in .env as a comma-separated list:
 *     GEMINI_API_KEYS=key1,key2,key3
 *
 *   Falls back to GEMINI_API_KEY (single key) if GEMINI_API_KEYS is not set.
 *
 * Rotation trigger errors (any key that returns one of these is placed on cooldown):
 *   • HTTP 429 (Too Many Requests)
 *   • "quota exceeded" / "RESOURCE_EXHAUSTED"
 *   • "rate limit" / "rateLimitExceeded"
 */

/** @type {string[]} Ordered pool of API keys */
let _keys = [];

/** @type {Map<number, number>} Map of key index -> cooldown expiration timestamp */
const _cooldowns = new Map();

/** @type {number} Index of the currently active key */
let _currentIndex = 0;

/** Initialised flag — prevents re-parsing env on every call */
let _initialised = false;

/**
 * Parses the key pool from environment variables.
 * Call once at startup, or lazily on first use.
 */
function _init() {
  if (_initialised) return;
  _initialised = true;

  const multi = process.env.GEMINI_API_KEYS || '';
  const single = process.env.GEMINI_API_KEY || '';

  if (multi) {
    // Parse comma-separated list, strip whitespace, drop empty entries
    _keys = multi.split(',').map(k => k.trim()).filter(Boolean);
  } else if (single) {
    _keys = [single];
  } else {
    _keys = [];
  }

  console.log(`[KeyManager] Loaded ${_keys.length} Gemini key(s) from environment`);
}

/**
 * Returns true if the key at the given index is currently on cooldown.
 * If the cooldown has expired, it is removed from the map.
 * @param {number} index
 * @returns {boolean}
 */
function isKeyOnCooldown(index) {
  if (!_cooldowns.has(index)) return false;
  const expiry = _cooldowns.get(index);
  if (Date.now() > expiry) {
    _cooldowns.delete(index);
    return false;
  }
  return true;
}

/**
 * Returns true if this error should trigger a key rotation.
 * @param {Error|string} err
 * @returns {boolean}
 */
function isRotatableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('resourceexhausted') ||
    msg.includes('rate limit') ||
    msg.includes('ratelimitexceeded') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('quota_exceeded') ||
    msg.includes('invalid') ||
    msg.includes('key not valid') ||
    msg.includes('api_key_invalid') ||
    msg.includes('expired') ||
    (msg.includes('blocked') && !msg.includes('safety')) ||
    msg.includes('403') ||
    msg.includes('400') ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('deadline') ||
    msg.includes('fetch failed')
  );
}

/**
 * Returns the currently active API key.
 * @returns {string|null} The key string, or null if no keys are configured.
 */
function getCurrentKey() {
  _init();
  if (!_keys.length) return null;
  return _keys[_currentIndex] || null;
}

/**
 * Returns the key that would be used after the current one (without rotating).
 * Returns null if all remaining keys are exhausted/on cooldown.
 * @returns {string|null}
 */
function getNextKey() {
  _init();
  for (let i = 1; i <= _keys.length; i++) {
    const idx = (_currentIndex + i) % _keys.length;
    if (!isKeyOnCooldown(idx)) return _keys[idx];
  }
  return null; // all keys exhausted
}

/**
 * Returns how many healthy (non-cooldown) keys remain.
 * @returns {number}
 */
function healthyKeyCount() {
  _init();
  return _keys.filter((_, i) => !isKeyOnCooldown(i)).length;
}

/**
 * Marks the given key as failed and places it on a temporary cooldown (default 30 mins).
 * Rotates to the next available key if one is free.
 *
 * @param {string} failedKey - The key that failed (used to identify the index)
 * @param {string} reason - Short reason string for logging (e.g. '429', 'quota')
 * @param {string} [requestId] - Optional request ID for log tracing
 * @returns {{ rotated: boolean, newKey: string|null, allExhausted: boolean }}
 */
function markKeyFailed(failedKey, reason, requestId = '-') {
  _init();

  const cooldownMinutes = parseFloat(process.env.GEMINI_KEY_COOLDOWN_MINUTES) || 30;
  const cooldownDurationMs = cooldownMinutes * 60 * 1000;

  // Find the index of the failed key
  const failedIdx = _keys.indexOf(failedKey);
  if (failedIdx !== -1) {
    const expiry = Date.now() + cooldownDurationMs;
    _cooldowns.set(failedIdx, expiry);
    console.warn(
      `[KeyManager][${requestId}] key[${failedIdx}] placed on cooldown for ${cooldownMinutes} minutes (reason=${reason}) — ` +
      `${healthyKeyCount()}/${_keys.length} key(s) remaining`
    );
  }

  // Rotate to next healthy key
  for (let i = 1; i <= _keys.length; i++) {
    const candidate = (_currentIndex + i) % _keys.length;
    if (!isKeyOnCooldown(candidate)) {
      const oldIndex = _currentIndex;
      _currentIndex = candidate;
      console.log(
        `[KeyManager][${requestId}] rotated key[${oldIndex}] → key[${_currentIndex}]`
      );
      return { rotated: true, newKey: _keys[_currentIndex], allExhausted: false };
    }
  }

  // All keys exhausted
  console.error(`[KeyManager][${requestId}] ALL ${_keys.length} key(s) exhausted/on cooldown`);
  return { rotated: false, newKey: null, allExhausted: true };
}

/**
 * Returns the max retries limit for a request, capped by the number of configured keys.
 * @returns {number}
 */
function getMaxRetries() {
  _init();
  const envVal = process.env.GEMINI_MAX_RETRIES;
  if (envVal !== undefined) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed)) {
      return Math.min(parsed, _keys.length);
    }
  }
  return _keys.length; // Default to trying all available keys
}

/**
 * Resets all cooldowns and returns to the first key.
 */
function reset() {
  _cooldowns.clear();
  _currentIndex = 0;
  _initialised = false;
  console.log('[KeyManager] All keys reset — cooldowns cleared and configuration reloaded');
}

/**
 * Returns a summary of key pool state for logging/diagnostics.
 * Does NOT expose key values — only indices.
 * @returns {{ total: number, healthy: number, failed: number[], currentIndex: number }}
 */
function getStatus() {
  _init();
  // Clear any expired cooldowns on status check
  for (const idx of _cooldowns.keys()) {
    isKeyOnCooldown(idx);
  }
  return {
    total: _keys.length,
    healthy: healthyKeyCount(),
    failed: [..._cooldowns.keys()],
    currentIndex: _currentIndex,
  };
}

module.exports = {
  getCurrentKey,
  getNextKey,
  markKeyFailed,
  isRotatableError,
  healthyKeyCount,
  getMaxRetries,
  reset,
  getStatus,
};
