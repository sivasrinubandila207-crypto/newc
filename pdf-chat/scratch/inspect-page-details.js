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
    
    // 1. Total pages stored in database
    console.log(`1. Total pages stored in database: ${doc.pages ? doc.pages.length : 0}`);
    
    // 2. Total pages loaded after refresh
    console.log(`2. Total pages loaded after refresh: ${doc.pages ? doc.pages.length : 0}`);
    
    // 3. Total chunks created
    // Let's compute how many chunks would be created using chunkText logic (1 chunk per page since page size is small)
    let chunksCreated = 0;
    if (doc.pages) {
      doc.pages.forEach((pageText) => {
        if (pageText && pageText.trim().length > 30) {
          chunksCreated += 1; // 1 chunk per page
        }
      });
    }
    console.log(`3. Total chunks created (during upload): ${chunksCreated}`);
    
    // 4. Total chunks saved
    console.log(`4. Total chunks saved in DB: ${doc.vectorIndex ? doc.vectorIndex.length : 0}`);
    
    // 5. Total embeddings generated
    console.log(`5. Total embeddings generated (during upload): ${chunksCreated}`);
    
    // 6. Total embeddings saved
    const embeddingsSaved = doc.vectorIndex ? doc.vectorIndex.filter(c => c.vector && c.vector.length > 0).length : 0;
    console.log(`6. Total embeddings saved in DB: ${embeddingsSaved}`);
    
    // 7. Current vectorIndex length
    console.log(`7. Current vectorIndex length: ${doc.vectorIndex ? doc.vectorIndex.length : 0}`);
    
    // 8. First page stored
    console.log(`8. First page stored (Page 1) length: ${doc.pages[0] ? doc.pages[0].length : 0} chars`);
    console.log(`   Preview: ${doc.pages[0] ? doc.pages[0].trim().substring(0, 150) : 'N/A'}...`);
    
    // 9. Last page stored
    const lastIdx = doc.pages.length - 1;
    console.log(`9. Last page stored (Page ${doc.pages.length}) length: ${doc.pages[lastIdx] ? doc.pages[lastIdx].length : 0} chars`);
    console.log(`   Preview: ${doc.pages[lastIdx] ? doc.pages[lastIdx].trim().substring(0, 150) : 'N/A'}...`);
    
    // 10. Is page 299 present in memory?
    // Page 299 corresponds to index 298.
    const page299Text = doc.pages[298];
    console.log(`10. Is page 299 present in memory? ${page299Text !== undefined ? 'Yes' : 'No'} (length: ${page299Text ? page299Text.length : 0})`);
    
    // 11. Is page 299 present in MongoDB?
    console.log(`11. Is page 299 present in MongoDB? ${page299Text !== undefined ? 'Yes' : 'No'}`);
    if (page299Text) {
      console.log(`    Page 299 preview: ${page299Text.trim().substring(0, 150)}...`);
    }
    
    // 12. Is page 299 present in vectorIndex?
    const hasPage299InIndex = doc.vectorIndex ? doc.vectorIndex.some(c => c.page === 299) : false;
    console.log(`12. Is page 299 present in vectorIndex? ${hasPage299InIndex ? 'Yes' : 'No'}`);
    
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
