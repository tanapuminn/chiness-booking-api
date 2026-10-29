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
  // ลืมรหัสผ่าน: เก็บ hash ของ token และเวลาหมดอายุ ส่วน passwordChangedAt ใช้ยกเลิก session เก่า
  passwordResetTokenHash: { type: String, index: true, sparse: true },
  passwordResetExpiresAt: { type: Date },
  passwordChangedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

const userModel = mongoose.model('user', userSchema);

module.exports = userModel;
