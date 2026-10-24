const cron = require('node-cron');
const bookingController = require('../controllers/bookingController.js');
const logger = require('./logger');

const startBookingScheduler = () => {
  logger.info('booking_scheduler_started');
  const task = cron.schedule('*/6 * * * *', async () => {
    try {
      logger.info('booking_scheduler_run', { at: new Date().toISOString() });
      await bookingController.checkExpiredBookings();
    } catch (error) {
      logger.error('booking_scheduler_failed', { error: logger.serializeError(error) });
    }
  });
  return task;
};

module.exports = { startBookingScheduler };