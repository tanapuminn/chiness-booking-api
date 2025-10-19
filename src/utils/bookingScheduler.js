const cron = require('node-cron');
const bookingController = require('../controllers/bookingController.js');

// ตรวจสอบการจองที่หมดเวลาทุก 6 นาที
const startBookingScheduler = () => {
  console.log('Starting booking scheduler...');

  // ทำงานทุก ๆ 6 นาที
  cron.schedule('*/6 * * * *', async () => {
    try {
      //add time log for debugging
      const now = new Date();
      console.log(`Booking scheduler running at ${now.toISOString()}`);
      await bookingController.checkExpiredBookings();
    } catch (error) {
      console.error('Error in booking scheduler:', error);
    }
  });
  
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