const bookingModel = require('../models/bookingModel.js');
const tablePositionModel = require('../models/tablePositionModel.js');
const zoneConfigModel = require('../models/zoneConfigModel.js');
const mongoose = require('mongoose');
const { v2: cloudinary } = require('cloudinary');
const fs = require('fs');
const dotenv = require('dotenv');
const axios = require('axios');
const XLSX = require('xlsx');
dotenv.config();
const ApiError = require('../utils/ApiError.js');

// ตั้งค่า Cloudinary (แนะนำให้ใช้ .env)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ดึงข้อมูลการจองทั้งหมด
const getBookings = async (req, res, next) => {
  try {
    const bookings = await bookingModel.aggregate([
      {
        $lookup: {
          from: "tablepositions", // collection name in MongoDB
          let: { bookingSeats: "$seats" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ["$id", "$$bookingSeats.tableId"]
                }
              }
            }
          ],
          as: "tableDetails"
        }
      },
      {
        $addFields: {
          seats: {
            $map: {
              input: "$seats",
              as: "seat",
              in: {
                $mergeObjects: [
                  "$$seat",
                  {
                    tableName: {
                      $let: {
                        vars: {
                          matchedTable: {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: "$tableDetails",
                                  cond: {
                                    $and: [
                                      { $eq: ["$$this.id", "$$seat.tableId"] },
                                      { $eq: ["$$this.zone", "$$seat.zone"] }
                                    ]
                                  }
                                }
                              },
                              0
                            ]
                          }
                        },
                        in: "$$matchedTable.name"
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      },
      {
        $project: {
          tableDetails: 0
        }
      },
      {
        $sort: { createdAt: -1 }
      }
    ]);

    res.json(bookings);
  } catch (error) {
    next(error);
  }
};

// ดึงข้อมูลการจองโดย ID
const getBookingById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [booking] = await bookingModel.aggregate([
      {
        $match: { id: id }
      },
      {
        $lookup: {
          from: "tablepositions",
          let: { bookingSeats: "$seats" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ["$id", "$$bookingSeats.tableId"]
                }
              }
            }
          ],
          as: "tableDetails"
        }
      },
      {
        $addFields: {
          seats: {
            $map: {
              input: "$seats",
              as: "seat",
              in: {
                $mergeObjects: [
                  "$$seat",
                  {
                    tableName: {
                      $let: {
                        vars: {
                          matchedTable: {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: "$tableDetails",
                                  cond: {
                                    $and: [
                                      { $eq: ["$$this.id", "$$seat.tableId"] },
                                      { $eq: ["$$this.zone", "$$seat.zone"] }
                                    ]
                                  }
                                }
                              },
                              0
                            ]
                          }
                        },
                        in: "$$matchedTable.name"
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      },
      {
        $project: {
          tableDetails: 0
        }
      }
    ]);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    res.json(booking);
  } catch (error) {
    next(error);
  }
};

// สร้างการจองใหม่
const createBooking = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { customerName, phone, seats, notes, bookingDate } = req.body;
    let parsedSeats;
    try {
      parsedSeats = JSON.parse(seats);
    } catch (error) {
      throw new Error('Invalid seats format');
    }
    console.log('body:: ', req.body);

    if (!customerName || !phone || !parsedSeats || !bookingDate) {
      throw new Error('Missing required fields: customerName, phone, seats, or bookingDate');
    }

    if (!Array.isArray(parsedSeats) || parsedSeats.length === 0) {
      throw new Error('Seats must be a non-empty array');
    }
    console.log('Parsed seats:', parsedSeats);

    const tableGroups = {};
    parsedSeats.forEach((seat) => {
      if (!seat.tableId || !seat.seatNumber || !seat.zone) {
        throw new Error('Each seat must have tableId, seatNumber, and zone');
      }
      const key = `${seat.tableId}-${seat.zone}`;
      if (!tableGroups[key]) {
        tableGroups[key] = { zone: seat.zone, tableId: seat.tableId, seats: [] };
      }
      tableGroups[key].seats.push(seat);
    });

    let totalPrice = 0;
    const seatsToBook = [];

    // Step 1: Check and book seats atomically
    for (const group of Object.values(tableGroups)) {
      console.log('Processing group:', group);

      // Check zone configuration
      const zoneConfig = await zoneConfigModel.findOne({ id: group.zone }).session(session);
      if (!zoneConfig) {
        throw new Error(`Zone ${group.zone} not found`);
      }

      // Book each seat in the group
      for (const seat of group.seats) {
        console.log(`Attempting to book seat ${seat.seatNumber} in table ${seat.tableId} zone ${seat.zone}`);

        // Get table details including name
        const table = await tablePositionModel.findOne(
          { id: seat.tableId, zone: seat.zone },
          null,
          { session }
        );

        if (!table) {
          throw new Error(`Table ${seat.tableId} in zone ${seat.zone} not found`);
        }

        // Add table name to seat object
        seat.tableName = table.name;

        // Atomic update to book the seat
        const updateResult = await tablePositionModel.findOneAndUpdate(
          {
            id: seat.tableId,
            zone: seat.zone,
            'seats': {
              $elemMatch: {
                seatNumber: seat.seatNumber,
                isBooked: false
              }
            }
          },
          {
            $set: { 'seats.$.isBooked': true }
          },
          {
            session,
            new: true,
            runValidators: true
          }
        );

        if (!updateResult) {
          const tableSeat = table.seats.find(
            (s) => s.seatNumber === seat.seatNumber
          );
          console.log('tableSeat:: ', tableSeat);

          if (!tableSeat) {
            throw new Error(`Seat ${seat.seatNumber} not found in table ${seat.tableId} in zone ${seat.zone}`);
          }

          if (tableSeat.isBooked) {
            throw new ApiError(
              `Seat ${seat.seatNumber} in table ${seat.tableId} in zone ${seat.zone} is already booked`,
              409
            );
          }

          throw new ApiError(
            `Failed to book seat ${seat.seatNumber} in table ${seat.tableId} in zone ${seat.zone} for unknown reason`,
            500
          );
        }

        console.log(`Successfully booked seat ${seat.seatNumber}`);
        seatsToBook.push(seat);
      }

      // Calculate price
      if (!zoneConfig.allowIndividualSeatBooking || group.seats.length === 9) {
        totalPrice += zoneConfig.tablePrice;
      } else {
        totalPrice += group.seats.length * zoneConfig.seatPrice;
      }
    }

    // set timeout for payment (20 minutes)
    const paymentDeadline = new Date(Date.now() + 2 * 60 * 1000);

    const booking = new bookingModel({
      id: `BK${Date.now()}`,
      customerName,
      phone,
      seats: seatsToBook, // Using seatsToBook which includes tableName
      notes,
      totalPrice,
      bookingDate,
      status: 'pending_payment',
      paymentDeadline,
    });

    await booking.save({ session });

    await session.commitTransaction();
    console.log(`Booking created successfully with ${seatsToBook.length} seats. Payment deadline: ${paymentDeadline}`);
    res.status(201).json({
      ...booking.toObject(),
      message: 'Booking created successfully. Please complete payment within 1 minute.',
      paymentDeadline: paymentDeadline
    });
  } catch (error) {
    console.error('Booking creation failed:', error.message);
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ยืนยันการชำระเงิน
const confirmPayment = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!id) {
      throw new Error('Booking ID is required');
    }

    // ค้นหาการจอง
    const booking = await bookingModel.findOne({ id: id }).session(session);
    if (!booking) {
      throw new Error('Booking not found');
    }

    // ตรวจสอบสถานะการจอง
    if (booking.status !== 'pending_payment') {
      throw new Error(`Cannot confirm payment for booking with status: ${booking.status}`);
    }

    // ตรวจสอบเวลาหมดอายุ
    if (new Date() > booking.paymentDeadline) {
      // อัปเดตสถานะเป็น payment_timeout
      booking.status = 'payment_timeout';
      await booking.save({ session });

      // รีเซ็ตที่นั่ง
      for (const seat of booking.seats) {
        await tablePositionModel.updateOne(
          { id: seat.tableId, zone: seat.zone, 'seats.seatNumber': seat.seatNumber },
          { $set: { 'seats.$.isBooked': false } },
          { session }
        );
      }

      await session.commitTransaction();
      return res.status(400).json({
        message: 'Payment deadline has expired. Booking has been cancelled.',
        status: 'payment_timeout'
      });
    }

    // ตรวจสอบว่ามีไฟล์ slip หรือไม่
    if (!req.file) {
      throw new Error('Payment proof is required');
    }

    // Step 1: ตรวจสอบ slip ด้วย SlipOK
    const branchId = process.env.SLIPOK_BRANCH_ID;
    const apiKey = process.env.SLIPOK_API_KEY;
    const path = req.file.path;
    const buffer = fs.readFileSync(path);

    try {
      const slipokRes = await axios.post(
        `https://api.slipok.com/api/line/apikey/${branchId}`,
        {
          files: buffer,
          log: true,
          amount: req.body.amount
        },
        {
          headers: {
            "x-authorization": apiKey,
            "Content-Type": "multipart/form-data",
          },
        }
      );
      // ถ้า success จะได้ slipData
      const slipData = slipokRes.data.data;
      console.log('SlipOK success:', slipData);
    } catch (err) {
      // ถ้า slip ไม่ถูกต้อง
      const errorData = err.response.data;
      console.log(err.response.data);

      // ลบไฟล์ local
      fs.unlinkSync(path);

      return res.status(400).json({
        message: errorData?.message || 'Invalid slip',
        code: errorData?.code,
      });
    }

    // Step 2: อัปโหลด slip ไปยัง Cloudinary
    let paymentProofUrl = null;
    try {
      const result = await cloudinary.uploader.upload(path, {
        folder: 'booking_payment_proofs',
      });
      paymentProofUrl = result.secure_url;
      // ลบไฟล์ local หลังอัปโหลด
      fs.unlinkSync(path);
    } catch (err) {
      throw new Error('Failed to upload image to Cloudinary: ' + err.message);
    }

    // Step 3: อัปเดตการจอง
    booking.status = 'confirmed';
    booking.paymentProof = paymentProofUrl;
    await booking.save({ session });

    await session.commitTransaction();
    console.log(`Payment confirmed for booking ${id}`);
    res.json({
      ...booking.toObject(),
      message: 'Payment confirmed successfully.'
    });
  } catch (error) {
    console.error('Payment confirmation failed:', error.message);
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ตรวจสอบและยกเลิกการจองที่หมดเวลา
const checkAndCancelExpiredBookings = async () => {
  try {
    const now = new Date();
    const expiredBookings = await bookingModel.find({
      status: 'pending_payment',
      paymentDeadline: { $lt: now }
    });

    console.log(`Found ${expiredBookings.length} expired bookings`);

    for (const booking of expiredBookings) {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // อัปเดตสถานะเป็น payment_timeout
        booking.status = 'payment_timeout';
        await booking.save({ session });

        // รีเซ็ตที่นั่ง
        for (const seat of booking.seats) {
          await tablePositionModel.updateOne(
            { id: seat.tableId, zone: seat.zone, 'seats.seatNumber': seat.seatNumber },
            { $set: { 'seats.$.isBooked': false } },
            { session }
          );
        }

        await session.commitTransaction();
        console.log(`Cancelled expired booking: ${booking.id}`);
      } catch (error) {
        await session.abortTransaction();
        console.error(`Failed to cancel expired booking ${booking.id}:`, error);
      } finally {
        session.endSession();
      }
    }
  } catch (error) {
    console.error('Error checking expired bookings:', error);
  }
};

// อัปเดตการจอง
const updateBooking = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const updates = req.body;

    if (!id) {
      throw new Error('Booking ID is required');
    }

    // ค้นหาการจองเดิม
    const booking = await bookingModel.findOne({ id: id }).session(session);
    if (!booking) {
      throw new Error('Booking not found');
    }

    // ถ้ามีการอัปเดต seats
    if (updates.seats) {
      let parsedSeats;
      try {
        parsedSeats = Array.isArray(updates.seats) ? updates.seats : JSON.parse(updates.seats);
      } catch (error) {
        throw new Error('Invalid seats format');
      }

      if (!Array.isArray(parsedSeats)) {
        throw new Error('Seats must be an array');
      }

      // รีเซ็ต isBooked สำหรับที่นั่งเดิม
      for (const seat of booking.seats) {
        await tablePositionModel.updateOne(
          { id: seat.tableId, zone: seat.zone, 'seats.seatNumber': seat.seatNumber },
          { $set: { 'seats.$.isBooked': false } },
          { session }
        );
      }

      // ตรวจสอบที่นั่งใหม่
      for (const seat of parsedSeats) {
        const table = await tablePositionModel.findOne({ id: seat.tableId, zone: seat.zone }).session(session);
        if (!table) {
          throw new Error(`Table ${seat.tableId} in zone ${seat.zone} not found`);
        }
        const tableSeat = table.seats.find((s) => s.seatNumber === seat.seatNumber);
        if (!tableSeat) {
          throw new Error(`Seat ${seat.seatNumber} not found in table ${seat.tableId} in zone ${seat.zone}`);
        }
        if (tableSeat.isBooked) {
          throw new Error(`Seat ${seat.seatNumber} in table ${seat.tableId} in zone ${seat.zone} is already booked`);
        }

        await tablePositionModel.updateOne(
          { id: seat.tableId, zone: seat.zone, 'seats.seatNumber': seat.seatNumber },
          { $set: { 'seats.$.isBooked': false } },
          { session }
        );
      }

      // คำนวณ totalPrice
      let totalPrice = 0;
      const tableGroups = {};
      parsedSeats.forEach((seat) => {
        const key = `${seat.tableId}-${seat.zone}`;
        if (!tableGroups[key]) {
          tableGroups[key] = { zone: seat.zone, seats: [] };
        }
        tableGroups[key].seats.push(seat);
      });

      for (const group of Object.values(tableGroups)) {
        const zoneConfig = await zoneConfigModel.findOne({ id: group.zone }).session(session);
        if (!zoneConfig) {
          throw new Error(`Zone ${group.zone} not found`);
        }

        if (!zoneConfig.allowIndividualSeatBooking || group.seats.length === 9) {
          totalPrice += zoneConfig.tablePrice;
        } else {
          totalPrice += group.seats.length * zoneConfig.seatPrice;
        }
      }
      updates.totalPrice = totalPrice;
      updates.seats = parsedSeats;
    } else if (booking) {
      for (const seat of booking.seats) {
        await tablePositionModel.updateOne(
          { id: seat.tableId, zone: seat.zone, 'seats.seatNumber': seat.seatNumber },
          { $set: { 'seats.$.isBooked': false } },
          { session }
        );
      }
    }

    // อัปเดต booking
    const updatedBooking = await bookingModel.findOneAndUpdate(
      { id: id },
      { $set: updates },
      { new: true, session }
    );

    await session.commitTransaction();
    res.json(updatedBooking);
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const updateBookingStatus = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending_payment', 'confirmed', 'cancelled', 'payment_timeout'].includes(status)) {
      throw new Error('Invalid status');
    }

    const booking = await bookingModel.findOne({ id: id }).session(session);
    if (!booking) {
      throw new Error('Booking not found');
    }

    if (booking.status === 'cancelled' && status !== 'cancelled') {
      throw new Error('Cannot change status from cancelled');
    }

    if (booking.status === 'payment_timeout' && status !== 'payment_timeout') {
      throw new Error('Cannot change status from payment_timeout');
    }

    booking.status = status;
    await booking.save({ session });

    // รีเซ็ต isBooked เมื่อสถานะเป็น cancelled หรือ payment_timeout
    if (status === 'cancelled' || status === 'payment_timeout') {
      console.log(`${status === 'cancelled' ? 'Cancelling' : 'Payment timeout for'} booking, resetting seats:`, booking.seats);

      for (const seat of booking.seats) {
        // ใช้ seat.zone แทน seat.seatZone (ตรวจสอบชื่อฟิลด์ที่ถูกต้อง)
        const seatZone = seat.zone || seat.seatZone;

        console.log(`Resetting seat - tableId: ${seat.tableId}, zone: ${seatZone}, seatNumber: ${seat.seatNumber}`);

        // ตรวจสอบว่า table มีอยู่หรือไม่ก่อน
        const table = await tablePositionModel.findOne({
          id: seat.tableId,
          zone: seatZone
        }).session(session);

        if (!table) {
          console.warn(`Table not found - tableId: ${seat.tableId}, zone: ${seatZone}`);
          continue;
        }

        // ตรวจสอบว่า seat มีอยู่ใน table หรือไม่
        const tableSeat = table.seats.find(s =>
          s.seatNumber === seat.seatNumber
        );

        if (!tableSeat) {
          console.warn(`Seat not found in table - seatNumber: ${seat.seatNumber}, zone: ${seatZone}`);
          continue;
        }

        // อัปเดต isBooked เป็น false
        const result = await tablePositionModel.updateOne(
          {
            id: seat.tableId,
            zone: seatZone,
            'seats.seatNumber': seat.seatNumber
          },
          { $set: { 'seats.$.isBooked': false } },
          { session }
        );

        console.log(`Update result for seat ${seat.seatNumber}:`, {
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount
        });

        if (!result.matchedCount) {
          console.warn(`No matching document found for tableId: ${seat.tableId}, zone: ${seatZone}, seatNumber: ${seat.seatNumber}`);
        } else if (!result.modifiedCount) {
          console.warn(`Document found but not modified for tableId: ${seat.tableId}, zone: ${seatZone}, seatNumber: ${seat.seatNumber}`);
        }
      }
    }

    await session.commitTransaction();
    res.json(booking);
  } catch (error) {
    await session.abortTransaction();
    console.error('Error updating booking status:', error);
    next(error);
  } finally {
    session.endSession();
  }
};

// ลบการจอง
const deleteBooking = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new Error('Booking ID is required');
    }

    const booking = await bookingModel.findOne({ id: id });
    if (!booking) {
      throw new Error('Booking not found');
    }

    // ลบ booking
    await bookingModel.deleteOne({ id: id });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// Export bookings to XLSX
const exportBookingsToXlsx = async (req, res, next) => {
  try {
    const bookings = await bookingModel.find().select("id customerName phone seats status totalPrice bookingDate paymentProof notes").sort({ createdAt: -1 });
    // แปลงข้อมูลเป็น array ของ object สำหรับ worksheet
    const data = bookings.map(b => ({
      รหัสการจอง: b.id,
      ชื่อลูกค้า: b.customerName,
      เบอร์โทร: b.phone,
      โซน: b.seats && b.seats.length > 0 ? b.seats[0].zone : '',
      โต๊ะ: b.seats && b.seats.length > 0 ? b.seats[0].tableName : '',
      ที่นั่ง: Array.isArray(b.seats) ? b.seats.map(s => `${s.seatNumber}`).join(", ") : '',
      // ที่นั่ง: Array.isArray(b.seats) ? b.seats.map(s => `โต๊ะ${s.tableName}-ที่นั่ง${s.seatNumber}`).join(", ") : '',
      สถานะ: b.status === 'pending_payment' ? 'รอชำระเงิน' :
        b.status === 'confirmed' ? 'ยืนยันแล้ว' :
          b.status === 'cancelled' ? 'ยกเลิก' :
            b.status === 'payment_timeout' ? 'หมดเวลาชำระเงิน' : b.status,
      "ราคารวม": b.totalPrice,
      "วันที่จอง": b.bookingDate ? new Date(b.bookingDate).toLocaleString('th-TH') : '',
      "หลักฐานการชำระเงิน": b.paymentProof || '',
      หมายเหตุ: b.notes || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bookings');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const now = new Date();
    const formattedDateTime = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') + '_' +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');
    const filename = `booking_report_${formattedDateTime}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    next(error);
  }
};

// ตรวจสอบการจองที่หมดเวลาทันที (API endpoint)
const checkExpiredBookings = async (req, res, next) => {
  try {
    const now = new Date();
    
    // Find expired bookings
    const expiredBookings = await bookingModel.find({
      status: 'pending_payment',
      paymentDeadline: { $lt: now }
    });

    // Find pending bookings to calculate remaining time
    const pendingBookings = await bookingModel.find({
      status: 'pending_payment',
      paymentDeadline: { $gt: now }
    });

    // Calculate remaining time for pending bookings
    const pendingBookingsWithTime = pendingBookings.map(booking => ({
      id: booking.id,
      remainingTime: Math.max(0, booking.paymentDeadline - now),
      paymentDeadline: booking.paymentDeadline
    }));

    console.log(`Found ${expiredBookings.length} expired bookings`);

    let cancelledCount = 0;
    let errorMessages = [];

    for (const booking of expiredBookings) {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // อัปเดตสถานะเป็น payment_timeout
        booking.status = 'payment_timeout';
        await booking.save({ session });

        // รีเซ็ตที่นั่ง
        for (const seat of booking.seats) {
          await tablePositionModel.updateOne(
            { id: seat.tableId, zone: seat.zone, 'seats.seatNumber': seat.seatNumber },
            { $set: { 'seats.$.isBooked': false } },
            { session }
          );
        }

        await session.commitTransaction();
        console.log(`Cancelled expired booking: ${booking.id}`);
        cancelledCount++;
      } catch (error) {
        await session.abortTransaction();
        console.error(`Failed to cancel expired booking ${booking.id}:`, error);
        errorMessages.push(`Failed to cancel booking ${booking.id}: ${error.message}`);
      } finally {
        session.endSession();
      }
    }

    // ตรวจสอบว่าการรีเซ็ตที่นั่งสำเร็จครบทุก booking หรือไม่
    if (expiredBookings.length > 0) {
      return res.status(200).json({
        message: `Checked expired bookings. Found ${expiredBookings.length} expired bookings, successfully cancelled ${cancelledCount} bookings.`,
        expiredCount: expiredBookings.length,
        cancelledCount: cancelledCount,
        pendingBookings: pendingBookingsWithTime
      });
    } else {
      return res.status(200).json({
        message: 'No expired bookings found.',
        expiredCount: 0,
        cancelledCount: 0,
        pendingBookings: pendingBookingsWithTime,
        errors: errorMessages
      });
    }
  } catch (error) {
    console.error('Error checking expired bookings:', error);
    return res.status(500).json({
      message: 'Error checking expired bookings',
      error: error.message
    });
  }
};

module.exports = {
  getBookings,
  getBookingById,
  createBooking,
  confirmPayment,
  checkAndCancelExpiredBookings,
  checkExpiredBookings,
  updateBooking,
  updateBookingStatus,
  deleteBooking,
  exportBookingsToXlsx
};