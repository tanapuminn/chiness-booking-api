const mongoose = require('mongoose');
const { DEFAULT_PAYMENT_TIMEOUT_MINUTES, MAX_PAYMENT_TIMEOUT_MINUTES } = require('../utils/paymentTimeout');

const appSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'site' },
  projectTitle: { type: String, trim: true, default: '' },
  projectSubtitle: { type: String, trim: true, default: '' },
  bankName: { type: String, trim: true, default: '' },
  bankAccountName: { type: String, trim: true, default: '' },
  bankAccountNumber: { type: String, trim: true, default: '' },
  bankAccountImage: { type: String, trim: true, default: '' },
  paymentType: { type: String, enum: ['bank', 'promptpay'], default: 'bank' },
  promptpayName: { type: String, trim: true, default: '' },
  promptpayNumber: { type: String, trim: true, default: '' },
  paymentConfiguredAt: { type: Date },
  bookingEnabled: { type: Boolean, default: false },
  paymentTimeoutMinutes: { type: Number, default: DEFAULT_PAYMENT_TIMEOUT_MINUTES, min: 1, max: MAX_PAYMENT_TIMEOUT_MINUTES },
}, { timestamps: true });

const appSettingModel = mongoose.model('appsetting', appSettingSchema);

module.exports = appSettingModel;
