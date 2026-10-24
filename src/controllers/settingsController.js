const appSettingModel = require('../models/appSettingModel');
const generatePromptPayPayload = require('promptpay-qr');
const QRCode = require('qrcode');

const DEFAULT_SETTINGS = {
  key: 'site',
  projectTitle: '',
  projectSubtitle: '',
  bankName: 'ธนาคารไทยพาณิชย์',
  bankAccountName: 'พัชรี เวชยันต์วิวัฒน์',
  bankAccountNumber: '404-487734-0',
  bankAccountImage: 'https://i.pinimg.com/736x/02/31/87/023187a2f2dc47bbdc809b43c7667b3a.jpg',
  paymentType: 'bank',
  promptpayName: '',
  promptpayNumber: '',
};

const formatSettings = (settings, includeBankImage = false) => ({
  projectTitle: settings.projectTitle || '',
  projectSubtitle: settings.projectSubtitle || '',
  bankName: settings.bankName || DEFAULT_SETTINGS.bankName,
  bankAccountName: settings.bankAccountName || DEFAULT_SETTINGS.bankAccountName,
  bankAccountNumber: settings.bankAccountNumber || DEFAULT_SETTINGS.bankAccountNumber,
  paymentType: settings.paymentType || DEFAULT_SETTINGS.paymentType,
  promptpayName: settings.promptpayName || '',
  promptpayNumber: settings.promptpayNumber || '',
  ...(includeBankImage ? { bankAccountImage: settings.bankAccountImage || DEFAULT_SETTINGS.bankAccountImage } : {}),
});

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
    const projectTitle = String(req.body.projectTitle ?? current.projectTitle ?? '').trim();
    const projectSubtitle = String(req.body.projectSubtitle ?? current.projectSubtitle ?? '').trim();
    const bankName = String(req.body.bankName ?? current.bankName ?? DEFAULT_SETTINGS.bankName).trim();
    const bankAccountName = String(req.body.bankAccountName ?? current.bankAccountName ?? DEFAULT_SETTINGS.bankAccountName).trim();
    const bankAccountNumber = String(req.body.bankAccountNumber ?? current.bankAccountNumber ?? DEFAULT_SETTINGS.bankAccountNumber).trim();
    const paymentType = String(req.body.paymentType ?? current.paymentType ?? DEFAULT_SETTINGS.paymentType);
    const promptpayName = String(req.body.promptpayName ?? current.promptpayName ?? '').trim();
    const promptpayNumber = String(req.body.promptpayNumber ?? current.promptpayNumber ?? '').replace(/\D/g, '');
    const bankAccountImage = req.file
      ? req.file.path
      : current.bankAccountImage || DEFAULT_SETTINGS.bankAccountImage;

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
      { $set: { projectTitle, projectSubtitle, bankName, bankAccountName, bankAccountNumber, bankAccountImage, paymentType, promptpayName, promptpayNumber } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    sendSettings(res, settings, true);
  } catch (error) {
    next(error);
  }
};

module.exports = { getSettings, getPromptPayQr, updateSettings };
