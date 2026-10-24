const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true, sparse: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  fullname: { type: String, required: true, trim: true },
  password: { type: String },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  googleId: { type: String, unique: true, sparse: true, index: true },
  googleEmail: { type: String, trim: true, lowercase: true },
  googleName: { type: String, trim: true },
  avatarUrl: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now },
});

const userModel = mongoose.model('user', userSchema);

module.exports = userModel;
