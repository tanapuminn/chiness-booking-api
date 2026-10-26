const cron = require('node-cron');
const { expirePendingBookings } = require('../services/bookingExpirationService.js');
const logger = require('./logger');

const startBookingScheduler = ({ schedule = cron.schedule, expire = expirePendingBookings } = {}) => {
  logger.info('booking_scheduler_started');
  const task = schedule('*/6 * * * *', async () => {
    try {
      const result = await expire();
      logger.info('booking_scheduler_run', {
        at: new Date().toISOString(),
        expiredCount: result.expiredCount,
        cancelledCount: result.cancelledCount,
        errorCount: result.errors.length,
      });
    } catch (error) {
      logger.error('booking_scheduler_failed', { error: logger.serializeError(error) });
    }
  });
  return task;
};

module.exports = { startBookingScheduler };
