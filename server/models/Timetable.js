const mongoose = require('mongoose');

const timetableSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // One timetable per user
  },
  timetable: [{
    day: {
      type: String,
      required: true
    },
    periods: [{
      period: Number,
      time: String,
      shortSubject: String,
      subjectCode: String,
      subjectName: String,
      teacher: String,
      room: String
    }]
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

timetableSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('Timetable', timetableSchema);

