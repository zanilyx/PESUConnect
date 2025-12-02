const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  semester: {
    type: Number,
    required: true
  },
  subjectCode: {
    type: String,
    required: true
  },
  subjectName: {
    type: String,
    required: true
  },
  ia1: {
    type: Number,
    default: 0
  },
  ia2: {
    type: Number,
    default: 0
  },
  ese: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    default: 0
  },
  maxMarks: {
    type: Number,
    default: 100
  }
}, {
  timestamps: true
});

resultSchema.index({ userId: 1, semester: 1, subjectCode: 1 }, { unique: true });

module.exports = mongoose.model('Result', resultSchema);

