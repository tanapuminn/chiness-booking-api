const bookingModel = require('../models/bookingModel');
const tablePositionModel = require('../models/tablePositionModel');

const activeBookingStatuses = ['pending_payment', 'confirmed'];
const isActiveBooking = (status) => activeBookingStatuses.includes(status);

const releaseBookingSeats = async (booking, session) => {
  for (const seat of booking.seats) {
    const zone = seat.zone || seat.seatZone;
    const otherActiveBooking = await bookingModel.exists({
      id: { $ne: booking.id },
      status: { $in: activeBookingStatuses },
      seats: { $elemMatch: { tableId: seat.tableId, seatNumber: seat.seatNumber, zone } },
    }).session(session);

    if (!otherActiveBooking) {
      await tablePositionModel.updateOne(
        { id: seat.tableId, zone, 'seats.seatNumber': seat.seatNumber },
        { $set: { 'seats.$.isBooked': false } },
        { session }
      );
    }
  }
};

module.exports = { isActiveBooking, releaseBookingSeats };
