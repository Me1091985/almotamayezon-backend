require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function main() {
  console.log('Connecting to database cluster...');
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not found in environment variables!');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  console.log('Connected.');

  const adminDb = mongoose.connection.client.db().admin();
  const dbsInfo = await adminDb.listDatabases();
  
  console.log('\n================ ALL DATABASES IN CLUSTER ================');
  for (const dbInfo of dbsInfo.databases) {
    const dbName = dbInfo.name;
    const dbSizeMB = dbInfo.sizeOnDisk / 1024 / 1024;
    console.log(`Database: ${dbName.padEnd(20)} | Size on Disk: ${dbSizeMB.toFixed(2)} MB`);
    
    // Connect to this database and list collections
    const currentDb = mongoose.connection.client.db(dbName);
    const collections = await currentDb.listCollections().toArray();
    for (const colInfo of collections) {
      const colName = colInfo.name;
      const count = await currentDb.collection(colName).countDocuments({});
      
      // Try to get stats
      let sizeKB = 0;
      try {
        const stats = await currentDb.command({ collStats: colName });
        sizeKB = (stats.size || 0) / 1024;
      } catch (e) {
        // Ignored
      }
      
      console.log(`   ↳ Collection: ${colName.padEnd(20)} | Docs: ${String(count).padStart(5)} | Size: ${sizeKB.toFixed(2)} KB`);
    }
  }
  console.log('========================================================\n');

  await mongoose.disconnect();
  console.log('Disconnected.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
