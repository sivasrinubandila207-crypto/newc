require('dotenv').config();
const { getDb } = require('../backend/db');
const { handler: docHandler } = require('../backend/documents');
const { handler: embedHandler } = require('../backend/embed');

// Mock docApi.saveDoc
async function mockSaveDoc(record, userId) {
  const jwt = require('jsonwebtoken');
  const SECRET = process.env.JWT_SECRET || 'ragpdfchat_fallback_secret';
  const token = jwt.sign({ userId }, SECRET);
  
  const event = {
    httpMethod: 'POST',
    queryStringParameters: { action: 'save' },
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(record)
  };
  
  const res = await docHandler(event);
  if (res.statusCode !== 200) {
    const err = new Error(JSON.parse(res.body).error || `HTTP ${res.statusCode}`);
    err.status = res.statusCode;
    throw err;
  }
  return JSON.parse(res.body);
}

// Mock saveDocumentRecord
async function simulateSaveDocumentRecord(record, userId) {
  try {
    console.log('Attempting save with full record...');
    const res = await mockSaveDoc(record, userId);
    console.log('First save attempt SUCCEEDED!');
    return res;
  } catch (err) {
    console.log(`First save attempt FAILED: status=${err.status}, message=${err.message}`);
    const isSizeIssue =
      err.status === 413 ||
      err.status === 500 ||
      /16 MB|BSON|payload|too large|large|size|413|500|fetch|network/i.test(err.message || '');
    if (!isSizeIssue) throw err;

    if (record.fileBase64) {
      try {
        console.warn(`[Persist] Payload too large. Retrying without fileBase64...`);
        const slimRecord = { ...record };
        delete slimRecord.fileBase64;
        const res = await mockSaveDoc(slimRecord, userId);
        console.log('1st Fallback (without fileBase64) SUCCEEDED!');
        return res;
      } catch (err2) {
        console.log(`1st Fallback FAILED: status=${err2.status}, message=${err2.message}`);
        if (!/16 MB|BSON|payload|too large|large|size|413|500|fetch|network/i.test(err2.message || '')) {
          throw err2;
        }
      }
    }

    console.warn(`[Persist] Still too large. Retrying without fileBase64 and vectorIndex...`);
    const ultraSlimRecord = { ...record };
    delete ultraSlimRecord.fileBase64;
    ultraSlimRecord.vectorIndex = [];
    const res = await mockSaveDoc(ultraSlimRecord, userId);
    console.log('2nd Fallback (without fileBase64 and vectorIndex) SUCCEEDED!');
    return res;
  }
}

async function run() {
  const db = await getDb();
  const col = db.collection('documents');
  
  // Find the existing pdf1.pdf document in DB to get the actual pages and text
  const doc = await col.findOne({ name: "pdf1.pdf" });
  if (!doc) {
    console.error("pdf1.pdf not found in DB.");
    process.exit(1);
  }
  
  const userId = doc.userId;
  
  // Reconstruct vectorIndex with mock embeddings (dim=768)
  const chunks = [];
  const chunkSize = 2500;
  const overlap = 100;
  
  function chunkText(text) {
    const result = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      result.push(text.slice(start, end));
      if (end >= text.length) break;
      start += chunkSize - overlap;
    }
    return result;
  }
  
  doc.pages.forEach((pageText, pi) => {
    if (!pageText || pageText.trim().length <= 30) return;
    const pageChunks = chunkText(pageText);
    pageChunks.forEach((chunk, ci) => {
      chunks.push({
        text: chunk,
        source: doc.name,
        page: pi + 1,
        chunkIndex: ci,
        vector: new Array(768).fill(0.01) // 768-dimensional mock vector
      });
    });
  });
  
  console.log(`\n--- IMMEDATELY BEFORE SAVE ---`);
  console.log(`vectorIndex length: ${chunks.length}`);
  console.log(`embedding count: ${chunks.filter(c => c.vector && c.vector.length > 0).length}`);
  
  // Simulate fileBase64 (approx 2 MB file bytes represented as base64)
  const mockFileBytes = new Uint8Array(1.5 * 1024 * 1024); // 1.5 MB of dummy PDF bytes
  const mockFileBase64 = Buffer.from(mockFileBytes).toString('base64');
  
  const recordToSave = {
    name: doc.name,
    pageCount: doc.pages.length,
    ocrExtracted: doc.ocrExtracted,
    text: doc.text,
    pages: doc.pages,
    pageConfidences: doc.pageConfidences || {},
    vectorIndex: chunks,
    fileBase64: mockFileBase64,
    nativeRollsCount: doc.nativeRollsCount || 0,
    processedRollsCount: doc.processedRollsCount || 0,
  };
  
  await simulateSaveDocumentRecord(recordToSave, userId);
  
  console.log(`\n--- IMMEDIATELY AFTER SAVE ---`);
  console.log(`vectorIndex length (in memory): ${recordToSave.vectorIndex.length}`);
  
  // Query DB directly
  const savedDoc = await col.findOne({ _id: doc._id });
  console.log(`\n--- READ MONGO RECORD DIRECTLY ---`);
  console.log(`vectorIndex length in DB: ${savedDoc.vectorIndex ? savedDoc.vectorIndex.length : 'undefined'}`);
  console.log(`fileBase64 exists in DB: ${!!savedDoc.fileBase64}`);
  
  // Simulate page refresh (which reads the DB document and maps it)
  const restoredDocObj = {
    vectorIndex: savedDoc.vectorIndex || []
  };
  console.log(`\n--- AFTER PAGE REFRESH ---`);
  console.log(`vectorIndex length: ${restoredDocObj.vectorIndex.length}`);
  
  process.exit(0);
}

run();
