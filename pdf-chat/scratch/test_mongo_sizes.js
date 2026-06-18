require('dotenv').config();
const { getDb } = require('../backend/db');

async function checkSizes() {
  try {
    const db = await getDb();
    const col = db.collection('documents');
    console.log("Fetching documents from DB...");
    const docs = await col.find({}, { projection: { name: 1, fileBase64: 1, text: 1, pages: 1 } }).toArray();
    console.log(`Found ${docs.length} documents.`);
    for (const d of docs) {
      const base64Length = d.fileBase64 ? d.fileBase64.length : 0;
      const textLength = d.text ? d.text.length : 0;
      const pagesCount = d.pages ? d.pages.length : 0;
      console.log(`- Document: "${d.name}"`);
      console.log(`  Pages: ${pagesCount}`);
      console.log(`  Text length: ${textLength} chars`);
      console.log(`  Base64 size: ${(base64Length / 1024 / 1024).toFixed(2)} MB`);
    }
  } catch (err) {
    console.error("Diagnostic failed:", err);
  }
}

checkSizes();
