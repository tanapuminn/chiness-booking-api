const mongoose = require('mongoose');
const bookingModel = require('../models/bookingModel');
const { releaseBookingSeats } = require('./bookingSeatService');
const logger = require('../utils/logger');

const runExpiration = async (now) => {
  const expiredBookings = await bookingModel.find({
    status: 'pending_payment',
    paymentDeadline: { $lte: now },
  }).select('id').lean();

  const result = { expiredCount: expiredBookings.length, cancelledCount: 0, errors: [] };

  for (const candidate of expiredBookings) {
    const session = await mongoose.startSession();
    try {
      const expired = await session.withTransaction(async () => {
        // Claim the pending booking within the transaction. A payment
        // confirmation or another expiry worker can only win one update.
        const booking = await bookingModel.findOneAndUpdate(
          { id: candidate.id, status: 'pending_payment', paymentDeadline: { $lte: now } },
          { $set: { status: 'payment_timeout' } },
          { new: true, session }
        );

        if (!booking) return false;

        await releaseBookingSeats(booking, session);

        return true;
      });
      if (expired) result.cancelledCount += 1;
    } catch (error) {
      result.errors.push({ bookingId: candidate.id, message: error.message });
      logger.error('booking_expiration_failed', {
        bookingId: candidate.id,
        error: logger.serializeError(error),
      });
    } finally {
      await session.endSession();
    }
  }

  return result;
};

let inFlightExpiration;

const expirePendingBookings = (now = new Date()) => {
  if (inFlightExpiration) return inFlightExpiration;
  inFlightExpiration = runExpiration(now).finally(() => {
    inFlightExpiration = undefined;
  });
  return inFlightExpiration;
};

module.exports = { expirePendingBookings };
