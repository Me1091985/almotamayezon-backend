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

  console.log('Dropping sample database "sample_mflix"...');
  const db = mongoose.connection.client.db('sample_mflix');
  await db.dropDatabase();
  console.log('Database "sample_mflix" dropped successfully!');

  await mongoose.disconnect();
  console.log('Disconnected.');
}

main().catch((e) => {
  console.error('Error dropping database:', e);
  process.exit(1);
});
