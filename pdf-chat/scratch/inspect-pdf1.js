const dotenv = require('dotenv');
dotenv.config();

const { getDb } = require('../backend/db');

async function run() {
  try {
    const db = await getDb();
    const col = db.collection('documents');
    const docName = "pdf1.pdf";
    const doc = await col.findOne({ name: docName });

    if (!doc) {
      console.error(`Document "${docName}" not found.`);
      process.exit(1);
    }

    console.log(`Document Loaded: "${doc.name}"`);
    console.log(`Total Pages: ${doc.pages ? doc.pages.length : 0}`);
    
    const vectorIndex = doc.vectorIndex || [];
    console.log(`Total Chunks in vectorIndex: ${vectorIndex.length}`);

    const chunksWithVectors = vectorIndex.filter(c => c.vector && c.vector.length > 0);
    console.log(`Chunks with non-empty vectors: ${chunksWithVectors.length}`);

    const distinctPages = new Set(vectorIndex.map(c => c.page));
    console.log(`Distinct pages in vectorIndex: ${distinctPages.size}`);
    
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
