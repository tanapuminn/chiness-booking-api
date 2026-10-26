const DEFAULT_PAYMENT_TIMEOUT_MINUTES = 20;
const MAX_PAYMENT_TIMEOUT_MINUTES = 180;

const getPaymentTimeoutMinutes = (settings) => {
  const minutes = settings?.paymentTimeoutMinutes;
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_PAYMENT_TIMEOUT_MINUTES
    ? minutes
    : DEFAULT_PAYMENT_TIMEOUT_MINUTES;
};

module.exports = { DEFAULT_PAYMENT_TIMEOUT_MINUTES, MAX_PAYMENT_TIMEOUT_MINUTES, getPaymentTimeoutMinutes };
