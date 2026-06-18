const dotenv = require('dotenv');
dotenv.config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not found.");
    return;
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Test gemini-embedding-2 with outputDimensionality
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
    const result = await model.embedContent({
      content: { parts: [{ text: "Hello world" }] },
      outputDimensionality: 768
    });
    console.log("gemini-embedding-2 with outputDimensionality: 768 success!");
    console.log("Vector dimensions:", result.embedding.values.length);
  } catch (err) {
    console.error("gemini-embedding-2 with outputDimensionality: 768 failed:", err.message);
  }

  // Test batchEmbedContents with outputDimensionality
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
    const result = await model.batchEmbedContents({
      requests: [
        {
          content: { parts: [{ text: "Hello world" }] },
          outputDimensionality: 768
        }
      ]
    });
    console.log("batchEmbedContents with outputDimensionality: 768 success!");
    console.log("Vector dimensions:", result.embeddings[0].values.length);
  } catch (err) {
    console.error("batchEmbedContents with outputDimensionality: 768 failed:", err.message);
  }
}

test();
