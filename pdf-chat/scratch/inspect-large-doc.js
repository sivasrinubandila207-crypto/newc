const dotenv = require('dotenv');
dotenv.config();

const { getDb } = require('../backend/db');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

function textOverlapRatio(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  wordsA.forEach(w => { if (wordsB.has(w)) common++; });
  return common / Math.min(wordsA.size, wordsB.size);
}

function deduplicateChunks(scored) {
  const kept = [];
  for (const candidate of scored) {
    const isDupe = kept.some(k => textOverlapRatio(k.text, candidate.text) > 0.80);
    if (!isDupe) kept.push(candidate);
  }
  return kept;
}

function mergeOverlappingTexts(text1, text2) {
  const minOverlap = 10;
  const maxOverlap = Math.min(text1.length, text2.length);
  for (let len = maxOverlap; len >= minOverlap; len--) {
    const suffix = text1.slice(-len);
    if (text2.startsWith(suffix)) {
      return text1 + text2.slice(len);
    }
  }
  return text1 + " " + text2;
}

function mergeOverlappingChunks(chunks) {
  const groups = {};
  for (const chunk of chunks) {
    const key = `${chunk.source}||${chunk.page}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(chunk);
  }

  const merged = [];
  for (const key in groups) {
    const pageChunks = groups[key];
    pageChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    const mergedPageChunks = [];
    for (const chunk of pageChunks) {
      if (mergedPageChunks.length === 0) {
        mergedPageChunks.push({ ...chunk });
      } else {
        const last = mergedPageChunks[mergedPageChunks.length - 1];
        if (chunk.chunkIndex === last.chunkIndex + 1) {
          last.text = mergeOverlappingTexts(last.text, chunk.text);
          last.score = Math.max(last.score, chunk.score);
          last.chunkIndex = chunk.chunkIndex;
        } else {
          mergedPageChunks.push({ ...chunk });
        }
      }
    }
    merged.push(...mergedPageChunks);
  }
  return merged;
}

async function run() {
  try {
    const db = await getDb();
    const col = db.collection('documents');
    const docName = "Large_RAG_Test_Document_300_Pages (1).pdf";
    const doc = await col.findOne({ name: docName });

    if (!doc) {
      console.error(`Document "${docName}" not found in database.`);
      process.exit(1);
    }

    console.log(`Document Loaded: "${doc.name}"`);
    console.log(`Total Pages in document record: ${doc.pages ? doc.pages.length : 0}`);
    console.log(`OCR Extracted: ${doc.ocrExtracted}`);

    const vectorIndex = doc.vectorIndex || [];
    console.log(`Total chunks in vectorIndex: ${vectorIndex.length}`);

    const chunksWithVectors = vectorIndex.filter(c => c.vector && c.vector.length > 0);
    console.log(`Chunks with non-empty vectors: ${chunksWithVectors.length}`);

    // Check which pages are present in vectorIndex
    const pagesWithChunks = new Set(vectorIndex.map(c => c.page));
    console.log(`Number of distinct pages indexed in vectorIndex: ${pagesWithChunks.size}`);
    
    // Find missing pages
    const missingPages = [];
    for (let p = 1; p <= doc.pages.length; p++) {
      if (!pagesWithChunks.has(p)) {
        missingPages.push(p);
      }
    }
    console.log(`Missing pages from vectorIndex (total ${missingPages.length}):`, missingPages.slice(0, 30));

    // Inspect page 237 text
    const page237Text = doc.pages[237 - 1]; // 0-indexed
    console.log(`\n--- Page 237 Text (Length: ${page237Text ? page237Text.length : 0}) ---`);
    if (page237Text) {
      console.log(page237Text.trim().substring(0, 500));
    } else {
      console.log('Page 237 text is empty/undefined!');
    }

    // Embed the query "What is the project identifier on page 237?"
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is not defined in environment.");
      process.exit(1);
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-2" }); // Or gemini-embedding-001 depending on what was used. Let's try both if one fails.
    
    let queryVector;
    try {
      console.log("\nEmbedding query via gemini-embedding-2...");
      const result = await embedModel.embedContent("What is the project identifier on page 237?");
      queryVector = result.embedding.values;
    } catch (e) {
      console.warn("gemini-embedding-2 failed, trying gemini-embedding-001...");
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
      const result = await fallbackModel.embedContent("What is the project identifier on page 237?");
      queryVector = result.embedding.values;
    }

    console.log(`Query Vector Generated (dim=${queryVector.length})`);

    // Compute cosine similarities
    const scored = [];
    for (let i = 0; i < vectorIndex.length; i++) {
      const entry = vectorIndex[i];
      if (entry.vector && entry.vector.length > 0) {
        const score = cosineSimilarity(queryVector, entry.vector);
        scored.push({
          index: i,
          text: entry.text,
          page: entry.page,
          chunkIndex: entry.chunkIndex,
          score: score
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    console.log(`\nTop 10 highest similarity chunks in vectorIndex:`);
    scored.slice(0, 10).forEach((c, idx) => {
      console.log(`${idx + 1}. Page ${c.page} (ChunkIndex: ${c.chunkIndex}) Score: ${c.score.toFixed(4)}`);
      console.log(`   Text snippet: ${c.text.trim().substring(0, 150).replace(/\n/g, ' ')}...`);
    });

    // Run retrieval filters (Threshold = 0.35)
    console.log(`\n--- Simulating retrieval filtering with Threshold = 0.35 ---`);
    let top = scored.filter(c => c.score > 0.35);
    console.log(`Chunks above 0.35 threshold: ${top.length}`);
    
    top = mergeOverlappingChunks(top);
    console.log(`Chunks after merging: ${top.length}`);
    
    top = deduplicateChunks(top);
    console.log(`Chunks after deduplication: ${top.length}`);
    
    top.sort((a, b) => b.score - a.score);
    
    // Max RAG chunks limit simulation (MAX_RAG_CHUNKS = 3)
    const MAX_RAG_CHUNKS = 3;
    const finalChunks = top.slice(0, MAX_RAG_CHUNKS);
    console.log(`Final chunks sent to LLM (with MAX_RAG_CHUNKS = ${MAX_RAG_CHUNKS}):`);
    finalChunks.forEach((c, idx) => {
      console.log(`\n[Chunk ${idx + 1}] Page ${c.page} Score: ${c.score.toFixed(4)}`);
      console.log(`Text: ${c.text}`);
    });

  } catch (err) {
    console.error('Run failed:', err);
  }
  process.exit(0);
}

run();
