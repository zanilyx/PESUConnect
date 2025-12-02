/**
 * Fix MongoDB email index issue
 * This script drops the old email_1 index and lets Mongoose recreate it as sparse
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pesuconnect';

async function fixEmailIndex() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    // Get all indexes
    const indexes = await usersCollection.indexes();
    console.log('\n📋 Current indexes:');
    indexes.forEach(idx => {
      console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    // Check if email_1 index exists
    const emailIndex = indexes.find(idx => idx.name === 'email_1');
    if (emailIndex) {
      console.log('\n🗑️  Dropping old email_1 index...');
      await usersCollection.dropIndex('email_1');
      console.log('✅ Dropped email_1 index');
    } else {
      console.log('\n✅ No email_1 index found (already fixed or never existed)');
    }

    // Email field has been removed from schema, so no need to recreate index
    console.log('\n✅ Email field removed from schema - index will not be recreated');

    // Verify indexes
    const newIndexes = await usersCollection.indexes();
    const newEmailIndex = newIndexes.find(idx => idx.name === 'email_1');
    if (!newEmailIndex) {
      console.log('\n✅ Email index successfully removed');
    } else {
      console.log('\n⚠️  Email index still exists (this is okay if schema still has email field)');
    }

    console.log('\n✅ Email index fix completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing email index:', error);
    process.exit(1);
  }
}

fixEmailIndex();

