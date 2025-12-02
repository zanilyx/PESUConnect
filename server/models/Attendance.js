const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
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
  totalClasses: {
    type: Number,
    default: 0
  },
  attendedClasses: {
    type: Number,
    default: 0
  },
  percentage: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

attendanceSchema.index({ userId: 1, semester: 1, subjectCode: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);

