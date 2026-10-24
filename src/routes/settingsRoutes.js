const express = require('express');
const settingsCtr = require('../controllers/settingsController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const router = express.Router();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'chiness-booking/bank-accounts',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    public_id: (req, file) => `bank-account-${Date.now()}-${path.parse(file.originalname).name}`,
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, or WEBP images are allowed'));
  },
});

router.get('/', settingsCtr.getSettings);
router.get('/promptpay-qr', settingsCtr.getPromptPayQr);
router.put('/', authenticate, requireAdmin, upload.single('bankAccountImage'), settingsCtr.updateSettings);

module.exports = router;
