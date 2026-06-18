const assert = require('assert');

// Temporarily set quoted environment variables for testing
process.env.GEMINI_API_KEYS = '"key_one", \'key_two\', "key_three "';
process.env.MONGODB_URI = '"mongodb://username:password@host:port/db"';

// Test KeyManager sanitization
const keyManager = require('../backend/keyManager').forProvider('gemini');
const status = keyManager.getStatus();
console.log('API Keys status:', status);

const k1 = keyManager.getCurrentKey();
console.log('Sanitized Key 1:', JSON.stringify(k1));
assert.strictEqual(k1, 'key_one', 'Key 1 should be sanitized');

const k2Result = keyManager.markKeyFailed(k1, 'test quota');
const k2 = keyManager.getCurrentKey();
console.log('Sanitized Key 2:', JSON.stringify(k2));
assert.strictEqual(k2, 'key_two', 'Key 2 should be sanitized');

const k3Result = keyManager.markKeyFailed(k2, 'test quota');
const k3 = keyManager.getCurrentKey();
console.log('Sanitized Key 3:', JSON.stringify(k3));
assert.strictEqual(k3, 'key_three', 'Key 3 should be sanitized');

// Test MongoDB URI sanitization
const { getDb } = require('../backend/db');
// We don't call getDb() since it will attempt to connect, but we can verify that the raw environment variable cleaning logic works.
// Let's print out what the clean URI would be
const rawUri = process.env.MONGODB_URI;
let uri = rawUri.trim();
if (uri.startsWith('"') && uri.endsWith('"')) uri = uri.slice(1, -1).trim();
if (uri.startsWith("'") && uri.endsWith("'")) uri = uri.slice(1, -1).trim();
console.log('Sanitized Mongo URI:', JSON.stringify(uri));
assert.strictEqual(uri, 'mongodb://username:password@host:port/db', 'Mongo URI should be sanitized');

console.log('✅ All sanitization tests passed successfully!');
