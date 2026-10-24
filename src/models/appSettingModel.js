const mongoose = require('mongoose');

const appSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'site' },
  projectTitle: { type: String, trim: true, default: '' },
  projectSubtitle: { type: String, trim: true, default: '' },
  bankName: { type: String, trim: true, default: 'ธนาคารไทยพาณิชย์' },
  bankAccountName: { type: String, trim: true, default: 'พัชรี เวชยันต์วิวัฒน์' },
  bankAccountNumber: { type: String, trim: true, default: '404-487734-0' },
  bankAccountImage: { type: String, trim: true, default: 'https://i.pinimg.com/736x/02/31/87/023187a2f2dc47bbdc809b43c7667b3a.jpg' },
  paymentType: { type: String, enum: ['bank', 'promptpay'], default: 'bank' },
  promptpayName: { type: String, trim: true, default: '' },
  promptpayNumber: { type: String, trim: true, default: '' },
}, { timestamps: true });

const appSettingModel = mongoose.model('appsetting', appSettingSchema);

module.exports = appSettingModel;
