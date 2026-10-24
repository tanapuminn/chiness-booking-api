const express = require('express');
const bookingCtr = require('../controllers/bookingController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');
const { bookingLimiter, paymentLimiter } = require('../middleware/rateLimiters');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();
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
    folder: 'chiness-booking/payment-proofs',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    public_id: (req, file) => `${Date.now()}-${path.parse(file.originalname).name}`,
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Only images (jpeg, jpg, png) are allowed'));
  },
});

// Administrative reporting and maintenance endpoints.
router.get('/', authenticate, requireAdmin, bookingCtr.getBookings);
router.get('/stats', authenticate, requireAdmin, bookingCtr.getBookingStats);
router.get('/export/xlsx', authenticate, requireAdmin, bookingCtr.exportBookingsToXlsx);
router.post('/check-expired', authenticate, requireAdmin, bookingCtr.checkExpiredBookings);

// Authenticated customer endpoints.
router.get('/my', authenticate, bookingCtr.getMyBookings);
router.get('/:id', authenticate, bookingCtr.getBookingById);
router.post('/', bookingLimiter, authenticate, bookingCtr.createBooking);
router.post('/:id/confirm-payment', paymentLimiter, authenticate, upload.single('paymentProof'), bookingCtr.confirmPayment);

// Only administrators can modify booking records directly.
router.put('/:id', authenticate, bookingCtr.updateBooking);
router.patch('/:id', authenticate, requireAdmin, bookingCtr.updateBookingStatus);
router.patch('/:id/check-in', authenticate, requireAdmin, bookingCtr.updateSeatCheckIn);
router.delete('/:id', authenticate, requireAdmin, bookingCtr.deleteBooking);

module.exports = router;
