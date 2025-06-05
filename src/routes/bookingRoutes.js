const express = require('express');
const bookingCtr = require('../controllers/bookingController');
const multer = require('multer');
const path = require('path');

const router = express.Router();

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // จำกัดขนาดไฟล์ 5MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images (jpeg, jpg, png) are allowed'));
  },
});

router.get('/', bookingCtr.getBookings);
router.get('/:id', bookingCtr.getBookingById);
router.post('/', upload.single('paymentProof'), bookingCtr.createBooking);
// router.post('/', bookingCtr.createBooking);
router.put('/:id', bookingCtr.updateBooking);
router.patch('/:id', bookingCtr.updateBookingStatus);

module.exports = router;