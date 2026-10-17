require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });
const PORT = process.env.PORT || 5005;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cit_db');
  const col = mongoose.connection.db.collection('courses');
  const courses = await col.find({}).toArray();

  for (const c of courses) {
    let thumb = (c.thumbnail || c.imageUrl || '').trim();
    if (!thumb) {
      console.log('SKIP (no cover):', c.title);
      continue;
    }
    if (thumb.startsWith('http') && thumb.includes('/uploads/')) {
      const fixed = thumb.replace(/localhost:\d+/i, `localhost:${PORT}`);
      if (fixed !== thumb) {
        await col.updateOne({ _id: c._id }, { $set: { thumbnail: fixed, imageUrl: fixed } });
        console.log('FIXED PORT:', c.title);
      }
      continue;
    }
    if (thumb.startsWith('data:image')) {
      try {
        const r = await cloudinary.uploader.upload(thumb, { folder: 'myweb-cit' });
        await col.updateOne({ _id: c._id }, { $set: { thumbnail: r.secure_url, imageUrl: r.secure_url } });
        console.log('MIGRATED:', c.title);
      } catch (e) {
        console.log('FAIL:', c.title, e.message);
      }
      continue;
    }
    if (thumb.startsWith('http')) {
      await col.updateOne({ _id: c._id }, { $set: { thumbnail: thumb, imageUrl: thumb } });
      console.log('SYNCED:', c.title);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
