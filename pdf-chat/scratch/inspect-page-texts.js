const dotenv = require('dotenv');
dotenv.config();

const { getDb } = require('../backend/db');

async function run() {
  try {
    const db = await getDb();
    const col = db.collection('documents');
    const docName = "Large_RAG_Test_Document_300_Pages (1).pdf";
    const doc = await col.findOne({ name: docName });

    if (!doc) {
      console.error(`Document "${docName}" not found.`);
      process.exit(1);
    }

    console.log(`Document Loaded: "${doc.name}"`);
    console.log(`Total Pages: ${doc.pages.length}`);

    for (let i = 234; i <= 238; i++) {
      console.log(`\n--- doc.pages[${i}] (Page ${i + 1} of PDF) ---`);
      console.log(doc.pages[i] ? doc.pages[i].trim() : 'undefined');
    }
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
