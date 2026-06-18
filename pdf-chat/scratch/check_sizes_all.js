require('dotenv').config();
const { getDb } = require('../backend/db');

async function check() {
  const db = await getDb();
  const col = db.collection('documents');
  const docs = await col.find({}).toArray();
  for (const d of docs) {
    console.log('--- Document:', d.name);
    console.log('ID:', d._id);
    console.log('ocrExtracted:', d.ocrExtracted);
    console.log('uploadedAt:', d.uploadedAt);
    console.log('pageCount:', d.pageCount);
    console.log('text length:', d.text ? d.text.length : 0);
    console.log('pages length:', d.pages ? d.pages.length : 0);
    console.log('pageConfidences keys:', d.pageConfidences ? Object.keys(d.pageConfidences).length : 0);
    console.log('fileBase64 exists:', !!d.fileBase64);
    if (d.fileBase64) {
      console.log('fileBase64 length:', d.fileBase64.length);
    }
    console.log('vectorIndex exists:', !!d.vectorIndex);
    if (d.vectorIndex) {
      console.log('vectorIndex array length:', d.vectorIndex.length);
      if (d.vectorIndex.length > 0) {
        console.log('First chunk text length:', d.vectorIndex[0].text ? d.vectorIndex[0].text.length : 0);
        console.log('First chunk vector length:', d.vectorIndex[0].vector ? d.vectorIndex[0].vector.length : 0);
      }
    }
  }
  process.exit(0);
}

check();
