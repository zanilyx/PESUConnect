const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({ 
  credentials: true, 
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token']
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/results', require('./routes/results'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/timetable', require('./routes/timetable'));

// Connect to MongoDB
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pesuconnect';

// MongoDB connection (options removed as they're deprecated in mongoose 6+)
mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('✅ Connected to MongoDB');
  console.log(`📊 Database: ${MONGODB_URI.split('/').pop().split('?')[0]}`);
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 API available at http://localhost:${PORT}`);
  });
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error.message);
  console.error('\n💡 Troubleshooting tips:');
  console.error('   1. Check if MongoDB is running (if using local)');
  console.error('   2. Verify MONGODB_URI in server/.env file');
  console.error('   3. Check IP whitelist (if using MongoDB Atlas)');
  console.error('   4. Verify username and password in connection string');
  process.exit(1);
});

// Handle connection events
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err);
});

