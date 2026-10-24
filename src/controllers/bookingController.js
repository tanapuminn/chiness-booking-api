const crypto = require('crypto');
const bookingModel = require('../models/bookingModel.js');
const userModel = require('../models/userModel.js');
const tablePositionModel = require('../models/tablePositionModel.js');
const zoneConfigModel = require('../models/zoneConfigModel.js');
const mongoose = require('mongoose');
const fs = require('fs');
const dotenv = require('dotenv');
const axios = require('axios');
const ExcelJS = require('exceljs');
dotenv.config();
const ApiError = require('../utils/ApiError.js');
const { sendTicketEmail } = require('../services/emailService.js');

const generateBookingId = async (session) => {
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const datePart = ['year', 'month', 'day']
    .map((type) => dateParts.find((part) => part.type === type)?.value)
    .join('');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const randomPart = crypto.randomInt(0, 100_000_000).toString().padStart(8, '0');
    const id = `PSM${datePart}-${randomPart}`;
    const existingBooking = await bookingModel.exists({ id }).session(session);
    if (!existingBooking) return id;
  }

  throw new ApiError('Unable to generate a unique booking ID. Please try again.', 503);
};

const parseAndValidateSeats = (rawSeats) => {
  let parsedSeats;
  try {
    parsedSeats = Array.isArray(rawSeats) ? rawSeats : JSON.parse(rawSeats);
  } catch {
    throw new ApiError('Invalid seats format', 400);
  }

  if (!Array.isArray(parsedSeats) || parsedSeats.length === 0 || parsedSeats.length > 100) {
    throw new ApiError('Seats must contain between 1 and 100 items', 400);
  }

  const seen = new Set();
  return parsedSeats.map((seat) => {
    const tableId = Number(seat?.tableId);
    const seatNumber = Number(seat?.seatNumber);
    const zone = String(seat?.zone || '').trim();
    const studentName = String(seat?.studentName || '').trim();
    const classLevel = String(seat?.classLevel || '').trim();

    if (!Number.isInteger(tableId) || tableId <= 0 || !Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 9 || !zone) {
      throw new ApiError('Each seat must have a valid tableId, seatNumber, and zone', 400);
    }
    if (!studentName || studentName.length > 120 || !classLevel || classLevel.length > 30) {
      throw new ApiError('Each seat must include a student name and class level', 400);
    }

    const key = `${tableId}-${seatNumber}-${zone}`;
    if (seen.has(key)) {
      throw new ApiError(`Duplicate seat selection: ${tableId}-${seatNumber}`, 400);
    }
    seen.add(key);

    return { ...seat, tableId, seatNumber, zone, studentName, classLevel };
  });
};
const isBookingOwner = (booking, req) => {
  if (req.user?.role === 'admin') return true;
  if (booking.userId) return String(booking.userId) === String(req.user?.id);
  // Backward-compatible fallback for bookings created before userId existed.
  return Boolean(req.user?.phone) && booking.phone === req.user.phone;
};

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
        $match: { id: id, ...(req.user.role !== 'admin' ? { $or: [{ userId: req.user.id }, { userId: { $exists: false }, phone: req.user.phone }] } : {}) }
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
    const parsedSeats = parseAndValidateSeats(seats);
    const normalizedCustomerName = String(customerName || '').trim();
    const normalizedPhone = String(phone || '').trim();
    const normalizedBookingDate = new Date(bookingDate);

    if (!normalizedCustomerName || normalizedCustomerName.length > 120 || !/^0\d{9}$/.test(normalizedPhone)) {
      throw new ApiError('Invalid customer name or phone number', 400);
    }

    if (Number.isNaN(normalizedBookingDate.getTime())) {
      throw new ApiError('Invalid booking date', 400);
    }

    if (notes !== undefined && notes !== null && String(notes).length > 500) {
      throw new ApiError('Notes must be 500 characters or fewer', 400);
    }

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
      if (!zoneConfig.isActive) {
        throw new ApiError(`Zone ${group.zone} is not active`, 409);
      }
      if (!zoneConfig.allowIndividualSeatBooking && group.seats.length !== 9) {
        throw new ApiError(`Zone ${group.zone} requires booking the full table`, 400);
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
        if (!table.isActive) {
          throw new ApiError(`Table ${seat.tableId} is not active`, 409);
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
    const paymentDeadline = new Date(Date.now() + 20 * 60 * 1000);
    const bookingId = await generateBookingId(session);

    const booking = new bookingModel({
      id: bookingId,
      customerName: normalizedCustomerName,
      phone: normalizedPhone,
      userId: req.user.id,
      seats: seatsToBook, // Using seatsToBook which includes tableName
      notes,
      totalPrice,
      bookingDate: normalizedBookingDate.toISOString(),
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

    if (!isBookingOwner(booking, req)) {
      throw new ApiError('You do not have access to this booking', 403);
    }

    // ตรวจสอบสถานะการจอง
    if (booking.status === 'confirmed') {
      await session.commitTransaction();
      return res.json({ ...booking.toObject(), message: 'Payment already confirmed.' });
    }

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
    const url = req.file.path;
    let slipData;

    try {
      const slipokRes = await axios.post(
        `https://api.slipok.com/api/line/apikey/${branchId}`,
        {
          url,
          log: true,
          // Always verify against the server-calculated booking total.
          amount: Number(booking.totalPrice),
        },
        {
          headers: {
            'x-authorization': apiKey,
          },
          timeout: 15000,
        }
      );

      slipData = slipokRes.data?.data;
      const verifiedAmount = Number(slipData?.amount);
      const transactionRef = String(slipData?.transRef || '').trim();

      if (!transactionRef || !Number.isFinite(verifiedAmount) || Math.abs(verifiedAmount - Number(booking.totalPrice)) > 0.005) {
        throw new ApiError('Payment amount or transaction reference could not be verified', 400);
      }

      const duplicatePayment = await bookingModel.findOne({ paymentTransactionRef: transactionRef }).session(session);
      if (duplicatePayment && duplicatePayment.id !== booking.id) {
        throw new ApiError('This payment slip has already been used', 409);
      }

      booking.paymentTransactionRef = transactionRef;
      booking.paymentAmount = verifiedAmount;
      booking.paymentVerifiedAt = new Date();
    } catch (err) {
      if (err instanceof ApiError) throw err;

      const errorData = err.response?.data;
      const errorCode = errorData?.code;
      const message = errorCode === 1012
        ? 'This payment slip has already been used'
        : errorData?.message || 'Invalid slip';
      throw new ApiError(message, errorCode === 1012 ? 409 : 400);
    }

    // Step 2: อัปโหลด slip ไปยัง Cloudinary
    const paymentProofUrl = req.file.path; // URL จาก Cloudinary

    // Step 3: อัปเดตการจอง
    booking.status = 'confirmed';
    booking.paymentProof = paymentProofUrl;
    await booking.save({ session });

    await session.commitTransaction();
    console.log(`Payment confirmed for booking ${id}`);

    const confirmedBooking = booking.toObject();
    let ticketEmailStatus = { skipped: true, reason: 'not_attempted' };

    try {
      const user = booking.userId
        ? await userModel.findById(booking.userId).select('email').lean()
        : await userModel.findOne({ phone: booking.phone }).select('email').lean();
      ticketEmailStatus = await sendTicketEmail({
        to: user?.email,
        booking: confirmedBooking,
      });
    } catch (emailError) {
      ticketEmailStatus = { sent: false, error: emailError.message };
      console.error(`Failed to send ticket email for booking ${id}:`, emailError);
    }

    res.json({
      ...confirmedBooking,
      message: 'Payment confirmed successfully.',
      ticketEmailStatus,
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
    }).lean();

    console.log(`Found ${expiredBookings.length} expired bookings==`);

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

    if (!isBookingOwner(booking, req)) {
      throw new ApiError('You do not have access to this booking', 403);
    }

    if (req.user.role !== 'admin') {
      const allowedCustomerUpdates = ['status'];
      const updateKeys = Object.keys(updates);
      if (updateKeys.some((key) => !allowedCustomerUpdates.includes(key)) || updates.status !== 'cancelled') {
        throw new ApiError('Customers may only cancel their own booking', 403);
      }
      if (booking.status !== 'pending_payment') {
        throw new ApiError('Only pending bookings can be cancelled by the customer', 409);
      }
    }

    // Release seats when a pending booking is cancelled through this endpoint.
    if (updates.status === 'cancelled' && booking.status === 'pending_payment') {
      for (const seat of booking.seats) {
        await tablePositionModel.updateOne(
          { id: seat.tableId, zone: seat.zone || seat.seatZone, 'seats.seatNumber': seat.seatNumber },
          { $set: { 'seats.$.isBooked': false } },
          { session }
        );
      }
    }

    // ถ้ามีการอัปเดต seats
    if (updates.seats) {
      const parsedSeats = parseAndValidateSeats(updates.seats);

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
        if (!table.isActive) {
          throw new ApiError(`Table ${seat.tableId} is not active`, 409);
        }
        const tableSeat = table.seats.find((s) => s.seatNumber === seat.seatNumber);
        if (!tableSeat) {
          throw new Error(`Seat ${seat.seatNumber} not found in table ${seat.tableId} in zone ${seat.zone}`);
        }
        if (tableSeat.isBooked) {
          throw new Error(`Seat ${seat.seatNumber} in table ${seat.tableId} in zone ${seat.zone} is already booked`);
        }

        seat.tableName = table.name;

        await tablePositionModel.updateOne(
          { id: seat.tableId, zone: seat.zone, 'seats.seatNumber': seat.seatNumber },
          { $set: { 'seats.$.isBooked': true } },
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
        if (!zoneConfig.isActive) {
          throw new ApiError(`Zone ${group.zone} is not active`, 409);
        }
        if (!zoneConfig.allowIndividualSeatBooking && group.seats.length !== 9) {
          throw new ApiError(`Zone ${group.zone} requires booking the full table`, 400);
        }

        if (!zoneConfig.allowIndividualSeatBooking || group.seats.length === 9) {
          totalPrice += zoneConfig.tablePrice;
        } else {
          totalPrice += group.seats.length * zoneConfig.seatPrice;
        }
      }
      updates.totalPrice = totalPrice;
      updates.seats = parsedSeats;
    }

    // Update booking

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

    const shouldSendTicketEmail = booking.status !== 'confirmed' && status === 'confirmed';
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
    const updatedBooking = booking.toObject();
    let ticketEmailStatus = { skipped: true, reason: 'not_attempted' };

    if (shouldSendTicketEmail) {
      try {
        const user = booking.userId
          ? await userModel.findById(booking.userId).select('email').lean()
          : await userModel.findOne({ phone: booking.phone }).select('email').lean();
        ticketEmailStatus = await sendTicketEmail({ to: user?.email, booking: updatedBooking });
      } catch (emailError) {
        ticketEmailStatus = { sent: false, error: emailError.message };
        console.error(`Failed to send admin-confirmed ticket email for booking ${id}:`, emailError);
      }
    }

    res.json({ ...updatedBooking, ticketEmailStatus });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error updating booking status:', error);
    next(error);
  } finally {
    session.endSession();
  }
};

const updateSeatCheckIn = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tableId = Number(req.body.tableId);
    const seatNumber = Number(req.body.seatNumber);
    const zone = String(req.body.zone || '');
    const checkedIn = req.body.checkedIn;

    if (!Number.isInteger(tableId) || !Number.isInteger(seatNumber) || !zone || typeof checkedIn !== 'boolean') {
      return res.status(400).json({ message: 'A valid table, seat, zone, and check-in status are required' });
    }

    const booking = await bookingModel.findOne({ id });
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ message: 'Only confirmed bookings can be checked in' });
    }

    const seat = booking.seats.find((item) =>
      item.tableId === tableId && item.seatNumber === seatNumber && item.zone === zone
    );
    if (!seat) return res.status(404).json({ message: 'Seat not found in this booking' });

    seat.checkIn = checkedIn
      ? { checkedIn: true, checkedInAt: new Date(), checkedInBy: req.user.id }
      : { checkedIn: false, checkedInAt: undefined, checkedInBy: undefined };
    await booking.save();
    res.json(booking);
  } catch (error) {
    next(error);
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
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Bookings');
    worksheet.columns = Object.keys(data[0] || {}).map((header) => ({
      header,
      key: header,
      width: Math.min(Math.max(header.length + 4, 14), 40)
    }));
    worksheet.addRows(data);
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await workbook.xlsx.writeBuffer();
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
    console.log('Checking for expired bookings...');
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
        const expiredBooking = await bookingModel.findOneAndUpdate(
          {
            id: booking.id,
            status: 'pending_payment',
            paymentDeadline: { $lt: now },
          },
          { $set: { status: 'payment_timeout' } },
          { new: true, session }
        );

        if (!expiredBooking) {
          await session.commitTransaction();
          continue;
        }

        for (const seat of expiredBooking.seats) {
          await tablePositionModel.updateOne(
            { id: seat.tableId, zone: seat.zone, 'seats.seatNumber': seat.seatNumber },
            { $set: { 'seats.$.isBooked': false } },
            { session }
          );
        }

        await session.commitTransaction();
        console.log(`Cancelled expired booking: ${expiredBooking.id}`);
        cancelledCount++;
      } catch (error) {
        await session.abortTransaction();
        console.error(`Failed to cancel expired booking ${expiredBooking.id}:`, error);
        errorMessages.push(`Failed to cancel booking ${expiredBooking.id}: ${error.message}`);
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

// ดึงการจองของ user ที่ login อยู่ (เทียบจาก phone ใน JWT)
const getMyBookings = async (req, res, next) => {
  try {
    const bookings = await bookingModel
      .find({ $or: [{ userId: req.user.id }, { userId: { $exists: false }, phone: req.user.phone }] })
      .sort({ createdAt: -1 })
      .lean();
    res.json(bookings);
  } catch (error) {
    next(error);
  }
};

// ดึงข้อมูลสถิติการจอง
const getBookingStats = async (req, res, next) => {
  try {
    const stats = await bookingModel.aggregate([
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          confirmedBookings: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] }
          },
          pendingBookings: {
            $sum: { $cond: [{ $eq: ["$status", "pending_payment"] }, 1, 0] }
          },
          cancelledBookings: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] }
          },
          timeoutBookings: {
            $sum: { $cond: [{ $eq: ["$status", "payment_timeout"] }, 1, 0] }
          },
          totalRevenue: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, "$totalPrice", 0] }
          },
          totalSeats: {
            $sum: { 
              $cond: [
                { $eq: ["$status", "confirmed"] }, 
                { 
                  $cond: [
                    { $ne: ["$seats", null] },
                    { $size: { $ifNull: ["$seats", []] } },
                    0
                  ]
                }, 
                0
              ] 
            }
          }
        }
      }
    ]);

    // ดึงข้อมูลสถิติแยกตามโซน - เฉพาะจำนวนที่นั่ง
    const zoneStats = await bookingModel.aggregate([
      {
        $match: { status: "confirmed" }
      },
      {
        $unwind: "$seats"
      },
      {
        $group: {
          _id: "$seats.zone",
          totalSeats: { $sum: 1 },
          totalRevenue: { $sum: 0 } // ไม่คำนวณ revenue ตามโซน เพราะซับซ้อน
        }
      }
    ]);

    // ดึงข้อมูลสถิติรายเดือน (6 เดือนล่าสุด)
    const monthlyStats = await bookingModel.aggregate([
      {
        $match: { status: "confirmed" }
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: "$totalPrice" },
          totalSeats: { 
            $sum: { 
              $size: { $ifNull: ["$seats", []] }
            } 
          }
        }
      },
      {
        $sort: { "_id.year": -1, "_id.month": -1 }
      },
      {
        $limit: 6
      }
    ]);

    const result = {
      overall: stats[0] || {
        totalBookings: 0,
        confirmedBookings: 0,
        pendingBookings: 0,
        cancelledBookings: 0,
        timeoutBookings: 0,
        totalRevenue: 0,
        totalSeats: 0
      },
      byZone: zoneStats,
      monthly: monthlyStats
    };

    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  parseAndValidateSeats,
  isBookingOwner,
  getBookings,
  getMyBookings,
  getBookingById,
  createBooking,
  confirmPayment,
  checkAndCancelExpiredBookings,
  checkExpiredBookings,
  updateBooking,
  updateBookingStatus,
  updateSeatCheckIn,
  deleteBooking,
  exportBookingsToXlsx,
  getBookingStats
};
