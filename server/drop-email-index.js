/**
 * Drop email index from MongoDB users collection
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pesuconnect';

async function dropEmailIndex() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    try {
      await usersCollection.dropIndex('email_1');
      console.log('✅ Dropped email_1 index');
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('✅ Email index does not exist (already removed)');
      } else {
        throw error;
      }
    }

    // Verify
    const indexes = await usersCollection.indexes();
    console.log('\n📋 Remaining indexes:');
    indexes.forEach(idx => {
      console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\n✅ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

dropEmailIndex();

