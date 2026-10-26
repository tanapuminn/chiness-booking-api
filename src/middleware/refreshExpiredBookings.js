const { expirePendingBookings } = require('../services/bookingExpirationService');
const logger = require('../utils/logger');

const refreshExpiredBookings = async (req, res, next) => {
  try {
    const result = await expirePendingBookings();
    if (result.errors.length > 0) {
      logger.warn('booking_expiration_incomplete', {
        path: req.path,
        errorCount: result.errors.length,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { refreshExpiredBookings };
