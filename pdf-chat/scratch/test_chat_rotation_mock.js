const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock the @google/generative-ai module
const mockedKeysTried = [];

Module.prototype.require = function (path) {
  if (path === '@google/generative-ai') {
    return {
      GoogleGenerativeAI: class {
        constructor(apiKey) {
          this.apiKey = apiKey;
          mockedKeysTried.push(apiKey);
        }
        getGenerativeModel(config) {
          return {
            generateContent: async (reqBody, options) => {
              // Simulate timeout
              if (this.apiKey === 'key_timeout') {
                const err = new Error("[GoogleGenerativeAI Error]: Request aborted: This operation was aborted");
                err.name = "AbortError";
                throw err;
              }
              // Simulate invalid key
              if (this.apiKey === 'key_invalid_auth') {
                const err = new Error("[GoogleGenerativeAI Error]: [400 Bad Request] API key not valid. Please pass a valid API key.");
                err.status = 400;
                throw err;
              }
              // Simulate quota error
              if (this.apiKey === 'key_bad_quota') {
                const err = new Error("Resource exhausted: Quota exceeded");
                err.status = 429;
                throw err;
              }
              // Simulate non-rotatable safety block
              if (this.apiKey === 'key_safety_block') {
                const err = new Error("Candidate content was blocked due to safety settings");
                throw err;
              }
              return {
                response: {
                  text: () => `Response from ${this.apiKey} for ${config.model}`
                }
              };
            },
            batchEmbedContents: async (reqBody, options) => {
              if (this.apiKey === 'key_bad_quota') {
                const err = new Error("Rate limit exceeded");
                err.status = 429;
                throw err;
              }
              return {
                embeddings: [{ values: [0.1, 0.2] }]
              };
            }
          };
        }
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

// Now import the chat handler and key manager
const chatHandler = require('../backend/chat').handler;
const embedHandler = require('../backend/embed').handler;
const km = require('../backend/geminiKeyManager');

async function runTests() {
  console.log("--- MOCK SERVER TEST: Chat Handler Rotation (Quota) ---");
  
  process.env.GEMINI_API_KEYS = "key_bad_quota,key_bad_quota,key_good";
  process.env.GEMINI_MAX_RETRIES = "3";
  process.env.GEMINI_KEY_COOLDOWN_MINUTES = "5";
  km.reset();
  mockedKeysTried.length = 0;

  const mockChatEvent = {
    httpMethod: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hello" }],
      model: "gemini-2.5-flash",
      disableFallback: true
    })
  };

  try {
    const result = await chatHandler(mockChatEvent);
    console.log("Chat result status:", result.statusCode);
    console.log("Mocked keys tried:", mockedKeysTried);
    if (mockedKeysTried.join(',') === 'key_bad_quota,key_bad_quota,key_good') {
      console.log("PASS: Chat rotated twice on quota errors and succeeded!");
    } else {
      console.error("FAIL: Expected sequence not followed.");
    }
  } catch (err) {
    console.error("Chat handler crashed:", err);
  }

  console.log("\n--- MOCK SERVER TEST: Chat Handler Rotation (Invalid Key) ---");
  process.env.GEMINI_API_KEYS = "key_invalid_auth,key_good";
  km.reset();
  mockedKeysTried.length = 0;

  try {
    const result = await chatHandler(mockChatEvent);
    console.log("Chat result status:", result.statusCode);
    console.log("Mocked keys tried:", mockedKeysTried);
    if (mockedKeysTried.join(',') === 'key_invalid_auth,key_good') {
      console.log("PASS: Chat rotated on invalid auth key and succeeded!");
    } else {
      console.error("FAIL: Expected sequence not followed.");
    }
  } catch (err) {
    console.error("Chat handler crashed:", err);
  }

  console.log("\n--- MOCK SERVER TEST: Chat Handler Rotation (Timeout) ---");
  process.env.GEMINI_API_KEYS = "key_timeout,key_good";
  km.reset();
  mockedKeysTried.length = 0;

  try {
    const result = await chatHandler(mockChatEvent);
    console.log("Chat result status:", result.statusCode);
    console.log("Mocked keys tried:", mockedKeysTried);
    if (mockedKeysTried.join(',') === 'key_timeout,key_good') {
      console.log("PASS: Chat rotated on timeout error and succeeded!");
    } else {
      console.error("FAIL: Expected sequence not followed.");
    }
  } catch (err) {
    console.error("Chat handler crashed:", err);
  }

  console.log("\n--- MOCK SERVER TEST: Non-rotatable Error (Safety Block) ---");
  process.env.GEMINI_API_KEYS = "key_safety_block,key_good";
  km.reset();
  mockedKeysTried.length = 0;

  try {
    const result = await chatHandler(mockChatEvent);
    console.log("Chat result status:", result.statusCode);
    console.log("Mocked keys tried:", mockedKeysTried);
    if (mockedKeysTried.length === 1 && mockedKeysTried[0] === 'key_safety_block') {
      console.log("PASS: Did not rotate on safety block error!");
    } else {
      console.error("FAIL: Rotated unnecessarily on non-rotatable error.");
    }
  } catch (err) {
    console.log("Expected throw/failure:", err.message);
  }

  console.log("\n--- MOCK SERVER TEST: Embed Handler Rotation ---");
  process.env.GEMINI_API_KEYS = "key_bad_quota,key_good";
  km.reset();
  mockedKeysTried.length = 0;

  const mockEmbedEvent = {
    httpMethod: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: ["some text to embed"]
    })
  };

  try {
    const result = await embedHandler(mockEmbedEvent);
    console.log("Embed result status:", result.statusCode);
    console.log("Mocked keys tried:", mockedKeysTried);
    if (mockedKeysTried.join(',') === 'key_bad_quota,key_good') {
      console.log("PASS: Embed rotated on quota errors and succeeded!");
    } else {
      console.error("FAIL: Embed rotation failed.");
    }
  } catch (err) {
    console.error("Embed handler crashed:", err);
  }
}

runTests();
