const isPaymentConfigured = (settings) => {
  if (!settings?.paymentConfiguredAt) return false;
  if (settings.paymentType === 'promptpay') {
    return Boolean(String(settings.promptpayName || '').trim()) &&
      /^(?:\d{10}|\d{13})$/.test(String(settings.promptpayNumber || '').replace(/\D/g, ''));
  }
  if (settings.paymentType === 'bank') {
    return Boolean(
      String(settings.bankName || '').trim() &&
      String(settings.bankAccountName || '').trim() &&
      String(settings.bankAccountNumber || '').trim()
    );
  }
  return false;
};

module.exports = { isPaymentConfigured };
