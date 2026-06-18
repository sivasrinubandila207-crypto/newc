/**
 * keyManager.js — Shared API key pool factory for Gemini & Groq.
 *
 * Usage:
 *   const km = require('./keyManager').forProvider('gemini');
 *   const km = require('./keyManager').forProvider('groq');
 *
 * .env keys:
 *   GEMINI_API_KEYS=k1,k2   (or GEMINI_API_KEY for single)
 *   GROQ_API_KEYS=k1,k2     (or GROQ_API_KEY   for single)
 *   GEMINI_KEY_COOLDOWN_MINUTES=30
 *   GROQ_KEY_COOLDOWN_MINUTES=30
 */

const pools = {};   // { provider: { keys, cooldowns, currentIndex } }

function _getPool(provider) {
  if (pools[provider]) return pools[provider];

  const prefix = provider.toUpperCase();
  const rawKeys = [];

  const addRawKeys = (str) => {
    if (!str) return;
    // Split by comma, semicolon, newline, carriage return
    const parts = str.split(/[\n\r,;]+/);
    parts.forEach(p => {
      const trimmed = p.trim();
      if (trimmed) rawKeys.push(trimmed);
    });
  };

  // 1. Check plural environment variable: e.g. GEMINI_API_KEYS
  addRawKeys(process.env[`${prefix}_API_KEYS`]);

  // 2. Check singular environment variable: e.g. GEMINI_API_KEY
  addRawKeys(process.env[`${prefix}_API_KEY`]);

  // 3. Scan all env variables for numbered or suffixed keys, e.g. GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
  for (const [key, value] of Object.entries(process.env)) {
    const isMatchingEnv = key.startsWith(`${prefix}_API_KEY_`) || key.startsWith(`${prefix}_API_KEYS_`);
    if (isMatchingEnv && value) {
      addRawKeys(value);
    }
  }

  // Clean keys (trim, remove enclosing quotes)
  const keys = rawKeys.map(k => {
    let clean = k.trim();
    if (clean.startsWith('"') && clean.endsWith('"')) {
      clean = clean.slice(1, -1).trim();
    }
    if (clean.startsWith("'") && clean.endsWith("'")) {
      clean = clean.slice(1, -1).trim();
    }
    return clean;
  }).filter(Boolean);

  // De-duplicate keys
  const uniqueKeys = [...new Set(keys)];

  console.log(`[KeyManager:${provider}] Loaded ${uniqueKeys.length} unique key(s)`);
  pools[provider] = { keys: uniqueKeys, cooldowns: new Map(), currentIndex: 0 };
  return pools[provider];
}

function _isOnCooldown(pool, idx) {
  if (!pool.cooldowns.has(idx)) return false;
  if (Date.now() > pool.cooldowns.get(idx)) { pool.cooldowns.delete(idx); return false; }
  return true;
}

function _healthy(pool) {
  return pool.keys.filter((_, i) => !_isOnCooldown(pool, i)).length;
}

function forProvider(provider) {
  return {
    getCurrentKey() {
      const p = _getPool(provider);
      return p.keys[p.currentIndex] || null;
    },

    isRotatableError(err) {
      const msg = String(err?.message || err || '').toLowerCase();
      return (
        msg.includes('429')  || msg.includes('quota')       || msg.includes('resource_exhausted') ||
        msg.includes('rate') || msg.includes('too many')    || msg.includes('invalid')             ||
        msg.includes('key not valid') || msg.includes('expired') || msg.includes('401')            ||
        msg.includes('403')  || msg.includes('fetch failed')|| msg.includes('timeout')             ||
        msg.includes('aborted') || msg.includes('abort')    ||
        (msg.includes('blocked') && !msg.includes('safety'))
      );
    },

    markKeyFailed(failedKey, reason, requestId = '-') {
      const p = _getPool(provider);
      const mins = parseFloat(process.env[`${provider.toUpperCase()}_KEY_COOLDOWN_MINUTES`]) || 30;
      const idx = p.keys.indexOf(failedKey);
      if (idx !== -1) p.cooldowns.set(idx, Date.now() + mins * 60 * 1000);

      console.warn(`[KeyManager:${provider}][${requestId}] key[${idx}] cooldown (${reason}) — ${_healthy(p)}/${p.keys.length} healthy`);

      for (let i = 1; i <= p.keys.length; i++) {
        const c = (p.currentIndex + i) % p.keys.length;
        if (!_isOnCooldown(p, c)) {
          p.currentIndex = c;
          return { rotated: true, newKey: p.keys[c], allExhausted: false };
        }
      }
      console.error(`[KeyManager:${provider}][${requestId}] ALL keys exhausted`);
      return { rotated: false, newKey: null, allExhausted: true };
    },

    getMaxRetries() { const p = _getPool(provider); return Math.min(p.keys.length, 4) || 1; },

    getStatus() {
      const p = _getPool(provider);
      return { total: p.keys.length, healthy: _healthy(p), currentIndex: p.currentIndex };
    },

    reset() {
      delete pools[provider];
      console.log(`[KeyManager:${provider}] Reset — pool cleared`);
    },
  };
}

module.exports = { forProvider };
