const express = require('express');
const bookingCtr = require('../controllers/bookingController');
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

// ตั้งค่า Cloudinary Storage สำหรับ multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'chiness-booking/payment-proofs', // โฟลเดอร์ใน Cloudinary
    allowed_formats: ['jpg', 'jpeg', 'png'], // รองรับเฉพาะไฟล์ภาพ
    public_id: (req, file) => `${Date.now()}-${path.parse(file.originalname).name}`, // ชื่อไฟล์ใน Cloudinary
  },
});

// const storage = multer.diskStorage({
//   destination: './uploads/',
//   filename: (req, file, cb) => {
//     const ext = path.extname(file.originalname);
//     cb(null, `${Date.now()}${ext}`);
//   },
// });

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
router.post('/', bookingCtr.createBooking); // ไม่ต้องอัปโหลดไฟล์ตอนสร้างการจอง
router.post('/:id/confirm-payment', upload.single('paymentProof'), bookingCtr.confirmPayment); // ยืนยันการชำระเงิน
router.put('/:id', bookingCtr.updateBooking);
router.patch('/:id', bookingCtr.updateBookingStatus);
router.delete('/:id', bookingCtr.deleteBooking);
router.get('/export/xlsx', bookingCtr.exportBookingsToXlsx);
router.post('/check-expired', bookingCtr.checkExpiredBookings); // ตรวจสอบการจองที่หมดเวลา

module.exports = router;