const mongoose = require('mongoose');

const tablePositionSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  zone: { type: String, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  isActive: { type: Boolean, default: true },
  seats: [{
    seatNumber: { type: Number, required: true },
    zone: { type: String, required: true },
    isBooked: { type: Boolean, default: false },
  }],
});
const tablePositionModel = mongoose.model('tablePosition', tablePositionSchema)

module.exports = tablePositionModel;