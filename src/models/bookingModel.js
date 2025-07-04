const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    id: { 
        type: String, 
        required: true, 
        unique: true 
    },
    customerName: { 
        type: String, 
        required: true 
    },
    phone: { 
        type: String, 
        required: true 
    },
    seats: [{
        tableId: { type: Number, required: true },
        seatNumber: { type: Number, required: true },
        zone: { type: String, required: true },
    }],
    notes: { 
        type: String 
    },
    totalPrice: { 
        type: Number, 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['confirmed', 'cancelled'], 
        default: 'confirmed' 
    },
    bookingDate: { 
        type: String, 
        required: true 
    },
    paymentProof: { 
        type: String 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
});

const bookingModel = mongoose.model('booking', bookingSchema)

module.exports = bookingModel;
