const mongoose = require('mongoose');

const zoneConfigSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  description: { type: String, required: true },
  allowIndividualSeatBooking: { type: Boolean, default: true },
  seatPrice: { type: Number, required: true },
  tablePrice: { type: Number, required: true },
});

const zoneConfigModel = mongoose.model('zoneConfig', zoneConfigSchema)

module.exports = zoneConfigModel;