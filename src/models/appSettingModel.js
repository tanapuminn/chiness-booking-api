const mongoose = require('mongoose');

const appSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'site' },
  projectTitle: { type: String, trim: true, default: '' },
  projectSubtitle: { type: String, trim: true, default: '' },
}, { timestamps: true });

const appSettingModel = mongoose.model('appsetting', appSettingSchema);

module.exports = appSettingModel;