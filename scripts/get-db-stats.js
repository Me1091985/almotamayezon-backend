require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function main() {
  console.log('Connecting to database...');
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not found in environment variables!');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  console.log('Connected successfully. Inspecting database collections...');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  console.log('\n================ DATABASE STATS ================');
  let grandTotalSize = 0;
  
  for (const colInfo of collections) {
    const colName = colInfo.name;
    const col = db.collection(colName);
    
    // Get doc count
    const count = await col.countDocuments({});
    
    // Try to get stats
    let storageSizeKB = 0;
    try {
      const stats = await db.command({ collStats: colName });
      storageSizeKB = (stats.size || 0) / 1024;
      grandTotalSize += stats.size || 0;
    } catch (e) {
      // Fallback: estimate size of some documents
    }

    console.log(`- Collection: ${colName.padEnd(25)} | Docs: ${String(count).padStart(6)} | Estimated Size: ${storageSizeKB.toFixed(2)} KB`);

    // Let's sample a few documents and find if they contain huge fields (like base64)
    const sampleDocs = await col.find({}).limit(100).toArray();
    let largestDoc = null;
    let maxDocSize = 0;
    let largeFieldInfo = '';

    for (const doc of sampleDocs) {
      const serialized = JSON.stringify(doc);
      if (serialized.length > maxDocSize) {
        maxDocSize = serialized.length;
        largestDoc = doc;
      }
    }

    if (maxDocSize > 10 * 1024) { // Larger than 10KB
      // Find which field is the biggest
      let maxField = '';
      let maxFieldSize = 0;
      for (const [key, val] of Object.entries(largestDoc || {})) {
        const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
        if (valStr.length > maxFieldSize) {
          maxFieldSize = valStr.length;
          maxField = key;
        }
      }
      largeFieldInfo = `[Largest Doc: ID ${largestDoc._id}, Size: ${(maxDocSize/1024).toFixed(2)} KB, Largest Field: "${maxField}" (${(maxFieldSize/1024).toFixed(2)} KB)]`;
      console.log(`    ↳ ${largeFieldInfo}`);
      
      // If it looks like base64, warn
      const bigVal = largestDoc[maxField];
      if (typeof bigVal === 'string' && bigVal.startsWith('data:image')) {
        console.log(`    ⚠️  WARNING: Field "${maxField}" contains a Base64 image!`);
      }
    }
  }

  console.log(`\nGrand Total Data Size: ${(grandTotalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log('================================================\n');

  await mongoose.disconnect();
  console.log('Disconnected.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
