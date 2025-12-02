const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  srn: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    // Removed strict SRN validation to allow any username format
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  pesuUsername: {
    type: String,
    default: ''
  },
  pesuPassword: {
    type: String,
    default: ''
  },
  name: {
    type: String,
    default: ''
  },
  currentSemester: {
    type: Number,
    default: 3
  },
  currentSection: {
    type: String,
    default: 'CS-A'
  },
  rememberPassword: {
    type: Boolean,
    default: false
  },
  semesterCache: [{
    semNumber: Number,
    semId: String,
    label: String
  }],
  semesterCacheUpdatedAt: {
    type: Date
  },
  subjectsCache: [{
    semesterId: String,
    semesterNumber: Number,
    subjects: [{
      cells: [String],
      courseId: String,
      code: String,
      name: String
    }],
    headers: [String],
    updatedAt: Date
  }],
  lastLoginAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

