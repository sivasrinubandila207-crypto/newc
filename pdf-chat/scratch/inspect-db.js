const dotenv = require('dotenv');
dotenv.config();

const { getDb } = require('../backend/db');

async function inspectDb() {
  try {
    const db = await getDb();
    const col = db.collection('documents');
    const docs = await col.find({}, { projection: { fileBase64: 0, vectorIndex: 0 } }).toArray();
    console.log('Database documents:');
    docs.forEach(d => {
      console.log(`- Name: "${d.name}", ID: ${d._id}, Pages: ${d.pageCount}, ocrExtracted: ${d.ocrExtracted}, TextLength: ${d.text?.length}, HasPagesArray: ${Array.isArray(d.pages)}`);
    });
  } catch (err) {
    console.error('Error connecting to database:', err);
  }
  process.exit(0);
}

inspectDb();
