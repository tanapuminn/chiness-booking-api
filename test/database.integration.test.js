const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const runDatabaseTests = process.env.RUN_DB_TESTS === 'true';

test('database integration tests require RUN_DB_TESTS=true', { skip: !runDatabaseTests }, () => {});

if (runDatabaseTests) {
  const bookingModel = require('../src/models/bookingModel');
  const tablePositionModel = require('../src/models/tablePositionModel');
  const zoneConfigModel = require('../src/models/zoneConfigModel');
  const {
    createBooking,
    checkExpiredBookings,
    confirmPayment,
  } = require('../src/controllers/bookingController');

  let mongo;

  const createResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });

  const callController = (controller, req) => new Promise((resolve, reject) => {
    const res = createResponse();
    controller(req, res, (error) => error ? reject(error) : resolve(res));
    setTimeout(() => resolve(res), 1000);
  });

  const seedTable = async (id = 1) => tablePositionModel.create({
    id,
    name: `Table ${id}`,
    zone: 'A',
    x: 1,
    y: 1,
    isActive: true,
    seats: Array.from({ length: 9 }, (_, index) => ({
      seatNumber: index + 1,
      zone: 'A',
      isBooked: false,
    })),
  });

  test.before(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri());
    await zoneConfigModel.create({
      id: 'A',
      name: 'Zone A',
      description: 'Integration test zone',
      isActive: true,
      allowIndividualSeatBooking: true,
      seatPrice: 100,
      tablePrice: 900,
    });
  });

  test.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  test.beforeEach(async () => {
    await bookingModel.deleteMany({});
    await tablePositionModel.deleteMany({});
    await seedTable();
  });

  test('concurrent booking attempts cannot reserve the same seat twice', async () => {
    const request = (phone) => ({
      body: {
        customerName: 'Integration User',
        phone,
        seats: [{ tableId: 1, seatNumber: 1, zone: 'A' }],
        bookingDate: new Date(Date.now() + 86400000).toISOString(),
      },
      user: { id: new mongoose.Types.ObjectId(), role: 'customer' },
    });

    const results = await Promise.allSettled([
      callController(createBooking, request('0811111111')),
      callController(createBooking, request('0822222222')),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(await bookingModel.countDocuments({ status: 'pending_payment' }), 1);
    const table = await tablePositionModel.findOne({ id: 1 }).lean();
    assert.equal(table.seats.filter((seat) => seat.isBooked).length, 1);
  });

  test('expired booking is timed out and releases its seats', async () => {
    const booking = await bookingModel.create({
      id: 'BK-expired-test',
      customerName: 'Expired User',
      phone: '0812345678',
      userId: new mongoose.Types.ObjectId(),
      seats: [{ tableId: 1, seatNumber: 2, zone: 'A', tableName: 'Table 1' }],
      totalPrice: 100,
      bookingDate: new Date().toISOString(),
      status: 'pending_payment',
      paymentDeadline: new Date(Date.now() - 1000),
    });
    await tablePositionModel.updateOne(
      { id: 1, 'seats.seatNumber': 2 },
      { $set: { 'seats.$.isBooked': true } },
    );

    const response = await callController(checkExpiredBookings, {});
    const updatedBooking = await bookingModel.findOne({ id: booking.id }).lean();
    const table = await tablePositionModel.findOne({ id: 1 }).lean();

    assert.equal(response.statusCode, 200);
    assert.equal(updatedBooking.status, 'payment_timeout');
    assert.equal(table.seats.find((seat) => seat.seatNumber === 2).isBooked, false);
  });

  test('confirmed payment is idempotent and does not require a new slip', async () => {
    const userId = new mongoose.Types.ObjectId();
    const booking = await bookingModel.create({
      id: 'BK-confirmed-test',
      customerName: 'Confirmed User',
      phone: '0812345678',
      userId,
      seats: [{ tableId: 1, seatNumber: 3, zone: 'A', tableName: 'Table 1' }],
      totalPrice: 100,
      paymentTransactionRef: 'TX-ALREADY-USED',
      paymentAmount: 100,
      paymentVerifiedAt: new Date(),
      bookingDate: new Date().toISOString(),
      status: 'confirmed',
      paymentDeadline: new Date(Date.now() + 600000),
    });

    const response = await callController(confirmPayment, {
      params: { id: booking.id },
      user: { id: userId.toString(), role: 'customer', phone: booking.phone },
      file: undefined,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.message, 'Payment already confirmed.');
    assert.equal((await bookingModel.findOne({ id: booking.id })).paymentTransactionRef, 'TX-ALREADY-USED');
  });
}
