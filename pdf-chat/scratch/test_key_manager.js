const km = require("../backend/geminiKeyManager");

// Setup env variables for testing
process.env.GEMINI_API_KEYS = "key_one,key_two,key_three";
process.env.GEMINI_MAX_RETRIES = "5";
process.env.GEMINI_KEY_COOLDOWN_MINUTES = "0.005"; // ~0.3 seconds cooldown for testing

console.log("--- TEST 1: Key Manager Initialization ---");
const key1 = km.getCurrentKey();
console.log("Initial active key:", key1); // Should be key_one
console.log("Status:", km.getStatus());

console.log("\n--- TEST 2: Max Retries Capped by Pool Size ---");
const maxRetries = km.getMaxRetries();
console.log("Max Retries (configured 5, pool size 3):", maxRetries); // Should be 3
if (maxRetries !== 3) {
  console.error("FAIL: maxRetries should be capped to pool size!");
} else {
  console.log("PASS");
}

console.log("\n--- TEST 3: Rotation & Cooldown ---");
const isRotatable = km.isRotatableError(new Error("Resource exhausted: quota exceeded for 429 requests"));
console.log("Is rotatable error?", isRotatable); // Should be true

const nonRotatable = km.isRotatableError(new Error("API key invalid"));
console.log("Is non-rotatable error?", nonRotatable); // Should be false

console.log("Marking key1 failed...");
const rotationResult = km.markKeyFailed(key1, "quota exceeded");
console.log("Rotation result:", rotationResult); // Should rotated to key_two
console.log("New active key:", km.getCurrentKey()); // Should be key_two
console.log("Status immediately after failure:", km.getStatus());

console.log("\n--- TEST 4: Cooldown Recovery ---");
console.log("Waiting 0.5 seconds for cooldown to expire...");
setTimeout(() => {
  const statusAfterWait = km.getStatus();
  console.log("Status after wait:", statusAfterWait);
  console.log("Active key after recovery:", km.getCurrentKey()); // Should be key_one again if we rotated and it recovered
  
  if (statusAfterWait.healthy === 3) {
    console.log("PASS: Cooldown expired and key recovered!");
  } else {
    console.error("FAIL: Key did not recover from cooldown");
  }
}, 500);
