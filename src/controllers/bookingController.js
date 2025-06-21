import bookingModel from '../models/bookingModel.js';
import tablePositionModel from '../models/tablePositionModel.js';
import zoneConfigModel from '../models/zoneConfigModel.js';
import mongoose from 'mongoose';

class ApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ดึงข้อมูลการจองทั้งหมด
export const getBookings = async (req, res, next) => {
  try {
    const bookings = await bookingModel.find().select("id customerName phone seats status totalPrice bookingDate paymentProof notes").sort({ createdAt: -1 });
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

        // Atomic update to book the seat
        const updateResult = await tablePositionModel.findOneAndUpdate(
          {
            id: seat.tableId,
            zone: seat.zone,
            'seats': {
              $elemMatch: {
                seatNumber: seat.seatNumber,
                // zone: seat.zone,
                isBooked: false // Ensure seat is not booked
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
          // Check why the update failed
          const table = await tablePositionModel.findOne(
            { id: seat.tableId, zone: seat.zone },
            null,
            { session }
          );

          if (!table) {
            throw new Error(`Table ${seat.tableId} in zone ${seat.zone} not found`);
          }

          const tableSeat = table.seats.find(
            (s) => s.seatNumber === seat.seatNumber
          );

          if (!tableSeat) {
            throw new Error(`Seat ${seat.seatNumber} not found in table ${seat.tableId} in zone ${seat.zone}`);
          }

          if (tableSeat.isBooked) {
            throw new ApiError(
              `Seat ${seat.seatNumber} in table ${seat.tableId} in zone ${seat.zone} is already booked`,
              409 // Conflict status code
            );
          }

          // If we reach here, the seat exists and is not booked, but the update failed for another reason
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

    // Step 2: Create booking record
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

    await session.commitTransaction();
    console.log(`Booking created successfully with ${seatsToBook.length} seats`);
    res.status(201).json(booking);
  } catch (error) {
    console.error('Booking creation failed:', error.message);
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
      console.log('Cancelling booking, resetting seats:', booking.seats);
      
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
export const deleteBooking = async (req, res, next) => {
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