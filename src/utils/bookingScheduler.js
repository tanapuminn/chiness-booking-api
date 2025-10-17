const bookingController = require('../controllers/bookingController.js');

// ตรวจสอบการจองที่หมดเวลาทุก 1 นาที
const startBookingScheduler = () => {
  console.log('Starting booking scheduler...');
  
  // ตรวจสอบทันทีเมื่อเริ่มต้น
  // bookingController.checkAndCancelExpiredBookings();
  // // bookingController.checkExpiredBookings();
  
  // // ตั้งเวลาให้ตรวจสอบทุก 1 นาที
  // setInterval(async () => {
  //   try {
  //     console.log('Checking....')
  //     await bookingController.checkAndCancelExpiredBookings();
  //     // await bookingController.checkExpiredBookings();//call new service
  //   } catch (error) {
  //     console.error('Error in booking scheduler:', error);
  //   }
  // }, 60 * 1000); // 60 วินาที = 1 นาที
};

// ฟังก์ชันสำหรับตรวจสอบการจองที่หมดเวลาทันที (สำหรับใช้ใน API)
// const checkExpiredBookingsNow = async () => {
//   try {
//     await bookingController.checkAndCancelExpiredBookings();
//     return { success: true, message: 'Expired bookings checked and cancelled' };
//   } catch (error) {
//     console.error('Error checking expired bookings:', error);
//     return { success: false, message: error.message };
//   }
// };

module.exports = {
  startBookingScheduler,
  // checkExpiredBookingsNow
}; 