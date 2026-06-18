const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function test() {
  const key = process.env.GEMINI_API_KEY;
  console.log("Using API Key:", key);
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const result = await model.batchEmbedContents(
      {
        requests: [{
          content: {
            role: "user",
            parts: [{ text: "Hello" }]
          }
        }]
      },
      { timeout: 10 } // 10 milliseconds
    );
    console.log("Success! Response:", result.embeddings);
  } catch (err) {
    console.error("Error encountered on batchEmbedContents call:");
    console.error("Message:", err.message);
    console.error("Status:", err.status || err.statusCode);
    console.error("Name:", err.name);
  }
}

test();
