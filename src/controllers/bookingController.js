import bookingModel from '../models/bookingModel.js';
import tablePositionModel from '../models/tablePositionModel.js';
import zoneConfigModel from '../models/zoneConfigModel.js';
import mongoose from 'mongoose';

// ดึงข้อมูลการจองทั้งหมด
export const getBookings = async (req, res, next) => {
  try {
    const bookings = await bookingModel.find().select("id customerName phone seats status totalPrice bookingDate paymentProof notes");
    res.json(bookings);
  } catch (error) {
    next(error);
  }
};
// ดึงข้อมูลการจองโดย ID
export const getBookingById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await bookingModel.findOne({ id });
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    res.json(booking);
  } catch (error) {
    next(error);
  }
};

// สร้างการจองใหม่
export const createBooking = async (req, res, next) => {
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

    if (!customerName || !phone || !parsedSeats || !bookingDate) {
      throw new Error('Missing required fields: customerName, phone, seats, or bookingDate');
    }

    if (!Array.isArray(parsedSeats) || parsedSeats.length === 0) {
      throw new Error('Seats must be a non-empty array');
    }
    console.log('Parsed seats:===', parsedSeats);

    const tableGroups = {};
    parsedSeats.forEach((seat) => {
      if (!seat.tableId || !seat.seatNumber || !seat.zone) {
        throw new Error('Each seat must have tableId, seatNumber, and zone');
      }
      const key = `${seat.tableId}-${seat.zone}`; // รวม zone ใน key
      if (!tableGroups[key]) {
        tableGroups[key] = { zone: seat.zone, tableId: seat.tableId, seats: [] };
      }
      tableGroups[key].seats.push(seat);
    });

    let totalPrice = 0;
    for (const group of Object.values(tableGroups)) {
      console.log('Processing group:', group);
      // ค้นหา table ด้วย tableId และ zone
      const table = await tablePositionModel.findOne({ id: group.tableId, zone: group.zone }).session(session);
      console.log('table:', table);
      if (!table) {
        throw new Error(`Table ${group.tableId} in zone ${group.zone} not found`);
      }

      // ตรวจสอบ zoneConfig
      const zoneConfig = await zoneConfigModel.findOne({ id: group.zone }).session(session);
      console.log('zoneConfig:', zoneConfig);
      if (!zoneConfig) {
        throw new Error(`Zone ${group.zone} not found`);
      }

      // ตรวจสอบที่นั่ง
      for (const seat of group.seats) {
        const tableSeat = table.seats.find((s) => s.seatNumber === seat.seatNumber);
        console.log('tableSeat:', tableSeat);
        if (!tableSeat) {
          throw new Error(`Seat ${seat.seatNumber} not found in table ${seat.tableId} in zone ${seat.zone}`);
        }
        if (tableSeat.isBooked) {
          throw new Error(`Seat ${seat.seatNumber} in table ${seat.tableId} in zone ${seat.zone} is already booked`);
        }
      }

      // คำนวณราคา
      if (!zoneConfig.allowIndividualSeatBooking || group.seats.length === 9) {
        totalPrice += zoneConfig.tablePrice;
      } else {
        totalPrice += group.seats.length * zoneConfig.seatPrice;
      }
    }

    const booking = new bookingModel({
      id: `BK${Date.now()}`,
      customerName,
      phone,
      seats: parsedSeats,
      notes,
      totalPrice,
      bookingDate,
      status: 'confirmed',
      paymentProof: req.file ? req.file.path : null,
    });

    await booking.save({ session });

    // อัปเดต isBooked
    for (const seat of parsedSeats) {
      await tablePositionModel.updateOne(
        { id: seat.tableId, zone: seat.zone, 'seats.seatNumber': seat.seatNumber },
        { $set: { 'seats.$.isBooked': true } },
        { session }
      );
    }

    await session.commitTransaction();
    res.status(201).json(booking);
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// อัปเดตการจอง
export const updateBooking = async (req, res, next) => {
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

export const updateBookingStatus = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['confirmed', 'cancelled'].includes(status)) {
      throw new Error('Invalid status');
    }

    const booking = await bookingModel.findOne({ id: id }).session(session);
    if (!booking) {
      throw new Error('Booking not found');
    }

    if (booking.status === 'cancelled' && status !== 'cancelled') {
      throw new Error('Cannot change status from cancelled');
    }

    booking.status = status;
    await booking.save({ session });

    // รีเซ็ต isBooked เมื่อสถานะเป็น cancelled
    if (status === 'cancelled') {
      for (const seat of booking.seats) {
        const result = await tablePositionModel.updateOne(
          { id: seat.tableId, zone: seat.seatZone, 'seats.seatNumber': seat.seatNumber },
          { $set: { 'seats.$.isBooked': false } },
          { session }
        );
        if (!result.matchedCount) {
          console.warn(`No matching table found for tableId: ${ seat.tableId }, zone: ${ seat.seatZone }, seatNumber: ${ seat.seatNumber }`);
        }
      }
    }

    await session.commitTransaction();
    res.json(booking);
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};