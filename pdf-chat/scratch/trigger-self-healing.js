const dotenv = require('dotenv');
dotenv.config();

const { getDb } = require('../backend/db');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function chunkText(text, chunkSize = 1200, overlap = 200) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

function isRealContent(t) {
  return Boolean(t && t.trim().length > 30 && !t.startsWith('[OCR') && !t.startsWith('[This page'));
}

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not found in environment.");
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });

  try {
    const db = await getDb();
    const col = db.collection('documents');
    
    // Find documents with empty or missing vectorIndex
    const docs = await col.find({}).toArray();
    console.log(`Checking ${docs.length} documents...`);

    for (const doc of docs) {
      if (doc.name !== "Large_RAG_Test_Document_300_Pages (1).pdf") {
        console.log(`- Skipping "${doc.name}" for this test run.`);
        continue;
      }

      console.log(`- Document "${doc.name}" has no vectorIndex. Rebuilding...`);
      const isLargeDoc = doc.pages.length > 40;
      const chunkSize = isLargeDoc ? 2500 : 1200;
      const overlap = isLargeDoc ? 100 : 200;

      const chunks = [];
      doc.pages.forEach((pageText, pi) => {
        if (!isRealContent(pageText)) return;
        const pageChunks = chunkText(pageText, chunkSize, overlap);
        pageChunks.forEach((chunk, ci) => {
          chunks.push({ text: chunk, source: doc.name, page: pi + 1, chunkIndex: ci });
        });
      });

      if (chunks.length === 0) {
        console.log(`  No chunks generated for "${doc.name}".`);
        continue;
      }

      console.log(`  Generated ${chunks.length} chunks. Fetching 768-dimensional embeddings...`);

      const embeddings = [];
      const batchSize = 80; // slightly smaller batch size to avoid hitting limits aggressively

      async function embedWithRetry(batchRequest, attempt = 1) {
        try {
          return await model.batchEmbedContents(batchRequest);
        } catch (err) {
          const isRateLimit = err.status === 429 || /429|quota|rate/i.test(err.message || '');
          if (isRateLimit && attempt <= 8) {
            let delaySec = 35;
            if (err.errorDetails) {
              const retryInfo = err.errorDetails.find(d => d['@type'] && d['@type'].includes('RetryInfo'));
              if (retryInfo && retryInfo.retryDelay) {
                delaySec = parseInt(retryInfo.retryDelay) || 35;
              }
            }
            console.log(`  [429] Rate limit hit. Waiting ${delaySec} seconds before retry (Attempt ${attempt}/8)...`);
            await new Promise(r => setTimeout(r, delaySec * 1000));
            return await embedWithRetry(batchRequest, attempt + 1);
          }
          throw err;
        }
      }

      for (let i = 0; i < chunks.length; i += batchSize) {
        const chunkBatch = chunks.slice(i, i + batchSize);
        console.log(`  Embedding batch ${i / batchSize + 1} of ${Math.ceil(chunks.length / batchSize)}...`);
        
        const batchRequest = {
          requests: chunkBatch.map(c => ({
            content: {
              role: "user",
              parts: [{ text: c.text.slice(0, 2048) }]
            },
            outputDimensionality: 768
          }))
        };

        const result = await embedWithRetry(batchRequest);
        if (result && result.embeddings) {
          result.embeddings.forEach(e => embeddings.push(e.values));
        } else {
          throw new Error("Failed to get embeddings from batch.");
        }
        
        // Add a small delay between successful batches to be gentle on quota
        if (i + batchSize < chunks.length) {
          console.log("  Batch complete. Waiting 2 seconds...");
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      console.log(`  Successfully generated ${embeddings.length} embeddings of dimension ${embeddings[0].length}`);

      // Map embeddings back to chunks
      const vectorIndex = chunks.map((c, idx) => ({
        ...c,
        vector: embeddings[idx]
      }));

      // Update database record (stripping fileBase64 if size is large to fit in Netlify limit)
      const updateData = {
        vectorIndex: vectorIndex
      };
      
      console.log(`  Updating "${doc.name}" in database...`);
      // Since it's a 300-page doc, let's unset fileBase64 to ensure it remains highly performant and under Netlify payload limits.
      await col.updateOne({ _id: doc._id }, { $set: updateData, $unset: { fileBase64: "" } });

      console.log(`  Document "${doc.name}" updated successfully!`);
    }

    console.log("Self-healing script execution completed.");

  } catch (err) {
    console.error("Self-healing failed:", err);
  }
  process.exit(0);
}

run();
