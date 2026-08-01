const { rateLimit } = require('express-rate-limit');

const createLimiter = (windowMs, limit, message) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message },
});

const apiLimiter = createLimiter(15 * 60 * 1000, 300, 'Too many requests. Please try again later.');
const authLimiter = createLimiter(15 * 60 * 1000, 20, 'Too many authentication attempts. Please try again later.');
const bookingLimiter = createLimiter(15 * 60 * 1000, 30, 'Too many booking requests. Please try again later.');
const paymentLimiter = createLimiter(15 * 60 * 1000, 10, 'Too many payment attempts. Please try again later.');

module.exports = { apiLimiter, authLimiter, bookingLimiter, paymentLimiter };