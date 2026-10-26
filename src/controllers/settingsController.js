const appSettingModel = require('../models/appSettingModel');
const generatePromptPayPayload = require('promptpay-qr');
const QRCode = require('qrcode');
const { isPaymentConfigured } = require('../utils/paymentSettings');
const { DEFAULT_PAYMENT_TIMEOUT_MINUTES, MAX_PAYMENT_TIMEOUT_MINUTES, getPaymentTimeoutMinutes } = require('../utils/paymentTimeout');

const DEFAULT_SETTINGS = {
  key: 'site',
  projectTitle: '',
  projectSubtitle: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankAccountImage: '',
  paymentType: 'bank',
  promptpayName: '',
  promptpayNumber: '',
  bookingEnabled: false,
  paymentTimeoutMinutes: DEFAULT_PAYMENT_TIMEOUT_MINUTES,
};

const formatSettings = (settings, includeBankImage = false) => {
  const paymentConfigured = isPaymentConfigured(settings);
  const bankActive = paymentConfigured && settings.paymentType === 'bank';
  const promptpayActive = paymentConfigured && settings.paymentType === 'promptpay';
  return {
    projectTitle: settings.projectTitle || '',
    projectSubtitle: settings.projectSubtitle || '',
    paymentConfigured,
    bookingEnabled: settings.bookingEnabled === true,
    paymentTimeoutMinutes: getPaymentTimeoutMinutes(settings),
    paymentType: settings.paymentType || DEFAULT_SETTINGS.paymentType,
    bankName: bankActive ? settings.bankName || '' : '',
    bankAccountName: bankActive ? settings.bankAccountName || '' : '',
    bankAccountNumber: bankActive ? settings.bankAccountNumber || '' : '',
    promptpayName: promptpayActive ? settings.promptpayName || '' : '',
    promptpayNumber: promptpayActive ? settings.promptpayNumber || '' : '',
    ...(includeBankImage ? { bankAccountImage: bankActive ? settings.bankAccountImage || '' : '' } : {}),
  };
};

const sendSettings = (res, settings, includeBankImage = false) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json(formatSettings(settings, includeBankImage));
};

const getSettingsDocument = async () => {
  const settings = await appSettingModel.findOneAndUpdate(
    { key: 'site' },
    { $setOnInsert: DEFAULT_SETTINGS },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return settings;
};

const getSettings = async (req, res, next) => {
  try {
    const settings = await getSettingsDocument();
    sendSettings(res, settings, req.query.includeBankImage === 'true');
  } catch (error) {
    next(error);
  }
};

const getPromptPayQr = async (req, res, next) => {
  try {
    const amount = Number(req.query.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ message: 'Amount must be between 0.01 and 1,000,000 baht' });
    }

    const settings = await getSettingsDocument();
    if (!isPaymentConfigured(settings)) {
      return res.status(409).json({ message: 'Payment method is not configured' });
    }
    const promptpayNumber = String(settings.promptpayNumber || '').replace(/\D/g, '');
    if (settings.paymentType !== 'promptpay' || ![10, 13].includes(promptpayNumber.length)) {
      return res.status(409).json({ message: 'PromptPay is not configured' });
    }

    const payload = generatePromptPayPayload(promptpayNumber, { amount });
    const qrCode = await QRCode.toDataURL(payload, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
    res.set('Cache-Control', 'no-store');
    res.json({ qrCode, amount });
  } catch (error) {
    next(error);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const current = await getSettingsDocument();
    const previouslyConfigured = isPaymentConfigured(current);
    const projectTitle = String(req.body.projectTitle ?? current.projectTitle ?? '').trim();
    const projectSubtitle = String(req.body.projectSubtitle ?? current.projectSubtitle ?? '').trim();
    const bankName = String(req.body.bankName ?? (previouslyConfigured ? current.bankName : '')).trim();
    const bankAccountName = String(req.body.bankAccountName ?? (previouslyConfigured ? current.bankAccountName : '')).trim();
    const bankAccountNumber = String(req.body.bankAccountNumber ?? (previouslyConfigured ? current.bankAccountNumber : '')).trim();
    const paymentType = String(req.body.paymentType ?? current.paymentType ?? DEFAULT_SETTINGS.paymentType);
    const promptpayName = String(req.body.promptpayName ?? (previouslyConfigured ? current.promptpayName : '')).trim();
    const promptpayNumber = String(req.body.promptpayNumber ?? (previouslyConfigured ? current.promptpayNumber : '')).replace(/\D/g, '');
    const bankAccountImage = req.file
      ? req.file.path
      : (previouslyConfigured ? current.bankAccountImage || '' : '');

    if (!projectTitle || !projectSubtitle) {
      return res.status(400).json({ message: 'projectTitle and projectSubtitle are required' });
    }
    if (!['bank', 'promptpay'].includes(paymentType)) {
      return res.status(400).json({ message: 'Invalid payment type' });
    }
    if (paymentType === 'promptpay' && (!promptpayName || ![10, 13].includes(promptpayNumber.length))) {
      return res.status(400).json({ message: 'PromptPay requires a name and a 10-digit mobile or 13-digit ID' });
    }
    if (paymentType === 'bank' && (!bankName || !bankAccountName || !bankAccountNumber)) {
      return res.status(400).json({ message: 'Bank name, account name, and account number are required' });
    }

    const settings = await appSettingModel.findOneAndUpdate(
      { key: 'site' },
      { $set: { projectTitle, projectSubtitle, bankName, bankAccountName, bankAccountNumber, bankAccountImage, paymentType, promptpayName, promptpayNumber, paymentConfiguredAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    sendSettings(res, settings, true);
  } catch (error) {
    next(error);
  }
};

const updateBookingStatus = async (req, res, next) => {
  try {
    if (typeof req.body.bookingEnabled !== 'boolean') {
      return res.status(400).json({ message: 'bookingEnabled must be a boolean' });
    }

    const current = await getSettingsDocument();
    if (req.body.bookingEnabled && !isPaymentConfigured(current)) {
      return res.status(409).json({ message: 'Configure a payment method before opening bookings' });
    }

    const settings = await appSettingModel.findOneAndUpdate(
      { key: 'site' },
      { $set: { bookingEnabled: req.body.bookingEnabled } },
      { new: true }
    );
    sendSettings(res, settings, true);
  } catch (error) {
    next(error);
  }
};

const updatePaymentTimeout = async (req, res, next) => {
  try {
    const minutes = req.body.paymentTimeoutMinutes;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_PAYMENT_TIMEOUT_MINUTES) {
      return res.status(400).json({ message: `paymentTimeoutMinutes must be an integer between 1 and ${MAX_PAYMENT_TIMEOUT_MINUTES}` });
    }

    await getSettingsDocument();
    const settings = await appSettingModel.findOneAndUpdate(
      { key: 'site' },
      { $set: { paymentTimeoutMinutes: minutes } },
      { new: true, runValidators: true }
    );
    sendSettings(res, settings, true);
  } catch (error) {
    next(error);
  }
};

module.exports = { getSettings, getPromptPayQr, updateSettings, updateBookingStatus, updatePaymentTimeout };
