const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  section: {
    type: String,
    required: true,
    index: true // Index for faster queries by section
  },
  text: {
    type: String,
    required: true
  },
  sender: {
    type: String,
    default: 'system' // 'system' for system messages, SRN for user messages
  },
  senderSrn: {
    type: String,
    default: null
  },
  senderName: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true // Index for sorting by timestamp
  }
}, {
  timestamps: true // Adds createdAt and updatedAt automatically
});

// Compound index for efficient queries: section + timestamp
chatMessageSchema.index({ section: 1, timestamp: 1 });

module.exports = mongoose.model('Chat', chatMessageSchema);

