const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const uri = 'mongodb+srv://alkafy:alkafy@cluster0.l0t8qcc.mongodb.net/?appName=Cluster0';

async function fixAdmin() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const phone = '01098744710';
    const plainPassword = '12344321@';
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const adminDb = client.db().admin();
    const dbs = await adminDb.listDatabases();

    for (const dbInfo of dbs.databases) {
      if (['admin', 'local', 'config'].includes(dbInfo.name)) continue;
      const db = client.db(dbInfo.name);
      const usersCol = db.collection('users');

      const count = await usersCol.countDocuments();
      if (count === 0) continue;

      console.log(`\n================ Processing DB: [${dbInfo.name}] (Total users: ${count}) ================`);

      // 1. Find if phone 01098744710 already exists in this DB
      const userByPhone = await usersCol.findOne({ phone: phone });
      if (userByPhone) {
        console.log(`Found user with phone ${phone} in [${dbInfo.name}]:`, {
          id: userByPhone._id,
          name: userByPhone.name,
          role: userByPhone.role,
          phone: userByPhone.phone
        });

        await usersCol.updateOne(
          { _id: userByPhone._id },
          {
            $set: {
              password: hashedPassword,
              role: 'admin',
              phone: phone
            }
          }
        );
        console.log(`✅ Updated existing user [${userByPhone.name}] to admin with password ${plainPassword} in [${dbInfo.name}]`);
      } else {
        // Find existing admin or create new
        const existingAdmin = await usersCol.findOne({ role: 'admin' });
        if (existingAdmin) {
          console.log(`Found admin user without phone ${phone}:`, existingAdmin.name, existingAdmin.phone);
          await usersCol.updateOne(
            { _id: existingAdmin._id },
            {
              $set: {
                phone: phone,
                password: hashedPassword,
                role: 'admin'
              }
            }
          );
          console.log(`✅ Updated admin [${existingAdmin.name}] to phone ${phone} and password in [${dbInfo.name}]`);
        } else {
          // Create new admin
          const res = await usersCol.insertOne({
            name: 'مدير المنصة (الأدمن)',
            phone: phone,
            password: hashedPassword,
            role: 'admin',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          console.log(`✅ Created brand new admin in [${dbInfo.name}] with id:`, res.insertedId);
        }
      }

      // Verify
      const verified = await usersCol.findOne({ phone: phone });
      console.log(`Verification in [${dbInfo.name}]:`, {
        id: verified._id,
        name: verified.name,
        phone: verified.phone,
        role: verified.role
      });
      const match = await bcrypt.compare(plainPassword, verified.password);
      console.log(`Password bcrypt test in [${dbInfo.name}]:`, match ? 'MATCH ✅' : 'FAIL ❌');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

fixAdmin();




