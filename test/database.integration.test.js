const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const runDatabaseTests = process.env.RUN_DB_TESTS === 'true';

test('database integration tests require RUN_DB_TESTS=true', { skip: !runDatabaseTests }, () => {});

if (runDatabaseTests) {
  const bookingModel = require('../src/models/bookingModel');
  const userModel = require('../src/models/userModel');
  const tablePositionModel = require('../src/models/tablePositionModel');
  const zoneConfigModel = require('../src/models/zoneConfigModel');
  const appSettingModel = require('../src/models/appSettingModel');
  const jwt = require('jsonwebtoken');
  const request = require('supertest');
  const app = require('../app');
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
    await appSettingModel.deleteMany({});
    await appSettingModel.create({
      key: 'site', projectTitle: 'Test', projectSubtitle: 'Test event',
      paymentType: 'bank', bankName: 'Test Bank', bankAccountName: 'Test Account',
      bankAccountNumber: '0001112223', paymentConfiguredAt: new Date(), bookingEnabled: true,
    });
    await seedTable();
  });

  test('admin cannot delete a table or zone referenced by booking history', async () => {
    process.env.JWT_SECRET ||= 'integration-test-secret';
    const admin = await userModel.create({ email: 'delete-guard-admin@example.com', fullname: 'Admin', phone: '0800000061', role: 'admin' });
    const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET);
    const adminDelete = (path) => request(app).delete(path).set('Authorization', `Bearer ${token}`);

    await zoneConfigModel.create({ id: 'B', name: 'Zone B', description: 'Delete guard zone', isActive: true, seatPrice: 100, tablePrice: 900 });
    await tablePositionModel.create({ id: 2, name: 'Table 2', zone: 'B', x: 2, y: 2,
      seats: [{ seatNumber: 1, zone: 'B', isBooked: false }] });

    await bookingModel.create({
      id: 'BK-delete-guard', customerName: 'Customer', phone: '0800000062',
      seats: [{ tableId: 2, seatNumber: 1, zone: 'B', tableName: 'Table 2' }],
      totalPrice: 100, status: 'cancelled', bookingDate: new Date().toISOString(),
      paymentDeadline: new Date(),
    });

    assert.equal((await adminDelete('/api/tables/2')).status, 409);
    assert.equal((await adminDelete('/api/zones/B')).status, 409);
    assert.ok(await tablePositionModel.exists({ id: 2 }));
    assert.ok(await zoneConfigModel.exists({ id: 'B' }));

    await bookingModel.deleteMany({ id: 'BK-delete-guard' });
    assert.equal((await adminDelete('/api/zones/B')).status, 409);
    assert.equal((await adminDelete('/api/tables/2')).status, 200);
    assert.equal((await adminDelete('/api/zones/B')).status, 200);
    assert.equal(await tablePositionModel.exists({ id: 2 }), null);
    assert.equal(await zoneConfigModel.exists({ id: 'B' }), null);
  });

  test('unconfirmed legacy account is hidden and cannot create a booking or lock a seat', async () => {
    await appSettingModel.updateOne({ key: 'site' }, {
      $set: { bankName: 'Legacy Bank', bankAccountName: 'Legacy Owner', bankAccountNumber: '9999999999' },
      $unset: { paymentConfiguredAt: '' },
    });
    const publicSettings = await request(app).get('/api/settings?includeBankImage=true');
    assert.equal(publicSettings.status, 200);
    assert.equal(publicSettings.body.paymentConfigured, false);
    assert.equal(publicSettings.body.bankName, '');
    assert.equal(publicSettings.body.bankAccountName, '');
    assert.equal(publicSettings.body.bankAccountNumber, '');
    assert.equal((await request(app).get('/api/settings/promptpay-qr?amount=100')).status, 409);

    const user = await userModel.create({ email: 'unconfigured@example.com', fullname: 'Visitor', phone: '0800000011' });
    process.env.JWT_SECRET ||= 'integration-test-secret';
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
    const bookingPayload = {
      customerName: 'Visitor', phone: '0800000011',
      seats: [{ tableId: 1, seatNumber: 1, zone: 'A', studentName: 'Student', classLevel: 'M.1' }],
      bookingDate: new Date().toISOString(),
    };
    const denied = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(bookingPayload);
    assert.equal(denied.status, 503);
    assert.equal(await bookingModel.countDocuments(), 0);
    assert.equal((await tablePositionModel.findOne({ id: 1 })).seats[0].isBooked, false);

    const admin = await userModel.create({ email: 'config-admin@example.com', fullname: 'Admin', phone: '0800000012', role: 'admin' });
    const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET);
    assert.equal((await request(app).patch('/api/settings/booking-status')
      .set('Authorization', `Bearer ${adminToken}`).send({ bookingEnabled: true })).status, 409);
    const configured = await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .field('projectTitle', 'Test').field('projectSubtitle', 'Test event')
      .field('paymentType', 'bank').field('bankName', 'New Bank')
      .field('bankAccountName', 'New Owner').field('bankAccountNumber', '1234567890');
    assert.equal(configured.status, 200);
    assert.equal(configured.body.paymentConfigured, true);
    assert.equal(configured.body.bankName, 'New Bank');
    assert.equal((await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(bookingPayload)).status, 201);
  });

  test('admin can close bookings while registration stays available, then reopen them', async () => {
    process.env.JWT_SECRET ||= 'integration-test-secret';
    const admin = await userModel.create({ email: 'booking-switch-admin@example.com', fullname: 'Admin', phone: '0800000031', role: 'admin' });
    const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET);
    assert.equal((await request(app).patch('/api/settings/booking-status').send({ bookingEnabled: false })).status, 401);
    assert.equal((await request(app).patch('/api/settings/booking-status')
      .set('Authorization', `Bearer ${adminToken}`).send({ bookingEnabled: 'false' })).status, 400);

    const closed = await request(app).patch('/api/settings/booking-status')
      .set('Authorization', `Bearer ${adminToken}`).send({ bookingEnabled: false });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.bookingEnabled, false);
    assert.equal((await request(app).get('/api/settings')).body.bookingEnabled, false);

    const registered = await request(app).post('/api/auth/register').send({
      email: 'prelaunch@example.com', fullname: 'Prelaunch Visitor', phone: '0800000032', password: 'SecurePass123!',
    });
    assert.equal(registered.status, 201);
    const visitor = await userModel.findOne({ email: 'prelaunch@example.com' });
    const visitorToken = jwt.sign({ id: visitor.id }, process.env.JWT_SECRET);
    assert.equal((await request(app).patch('/api/settings/booking-status')
      .set('Authorization', `Bearer ${visitorToken}`).send({ bookingEnabled: true })).status, 403);
    const payload = {
      customerName: 'Prelaunch Visitor', phone: '0800000032',
      seats: [{ tableId: 1, seatNumber: 1, zone: 'A', studentName: 'Student', classLevel: 'M.1' }],
      bookingDate: new Date().toISOString(),
    };
    assert.equal((await request(app).post('/api/bookings')
      .set('Authorization', `Bearer ${visitorToken}`).send(payload)).status, 503);
    assert.equal(await bookingModel.countDocuments(), 0);
    assert.equal((await tablePositionModel.findOne({ id: 1 })).seats[0].isBooked, false);

    const reopened = await request(app).patch('/api/settings/booking-status')
      .set('Authorization', `Bearer ${adminToken}`).send({ bookingEnabled: true });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.bookingEnabled, true);
    const created = await request(app).post('/api/bookings')
      .set('Authorization', `Bearer ${visitorToken}`).send(payload);
    assert.equal(created.status, 201);
    assert.equal(created.body.createdByRole, 'user');
  });

  test('admin payment timeout applies to new bookings without changing existing deadlines', async () => {
    process.env.JWT_SECRET ||= 'integration-test-secret';
    const admin = await userModel.create({ email: 'timeout-admin@example.com', fullname: 'Admin', phone: '0800000041', role: 'admin' });
    const visitor = await userModel.create({ email: 'timeout-visitor@example.com', fullname: 'Visitor', phone: '0800000042' });
    const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET);
    const visitorToken = jwt.sign({ id: visitor.id }, process.env.JWT_SECRET);
    const updateTimeout = (minutes) => request(app).patch('/api/settings/payment-timeout')
      .set('Authorization', `Bearer ${adminToken}`).send({ paymentTimeoutMinutes: minutes });

    assert.equal((await request(app).get('/api/settings')).body.paymentTimeoutMinutes, 20);
    assert.equal((await request(app).patch('/api/settings/payment-timeout').send({ paymentTimeoutMinutes: 5 })).status, 401);
    assert.equal((await request(app).patch('/api/settings/payment-timeout')
      .set('Authorization', `Bearer ${visitorToken}`).send({ paymentTimeoutMinutes: 5 })).status, 403);
    for (const invalid of [0, 2.5, 181, '5']) {
      assert.equal((await updateTimeout(invalid)).status, 400);
    }
    assert.equal((await updateTimeout(5)).status, 200);

    const createAtSeat = (seatNumber) => request(app).post('/api/bookings')
      .set('Authorization', `Bearer ${visitorToken}`).send({
        customerName: 'Visitor', phone: '0800000042',
        seats: [{ tableId: 1, seatNumber, zone: 'A', studentName: 'Student', classLevel: 'M.1' }],
        bookingDate: new Date().toISOString(),
      });
    const firstStartedAt = Date.now();
    const first = await createAtSeat(1);
    assert.equal(first.status, 201);
    assert.match(first.body.message, /within 5 minutes/);
    assert.ok(new Date(first.body.paymentDeadline).getTime() - firstStartedAt >= 5 * 60_000);
    assert.ok(new Date(first.body.paymentDeadline).getTime() - Date.now() <= 5 * 60_000);

    assert.equal((await updateTimeout(30)).status, 200);
    assert.equal((await request(app).get('/api/settings')).body.paymentTimeoutMinutes, 30);
    const second = await createAtSeat(2);
    assert.equal(second.status, 201);
    assert.match(second.body.message, /within 30 minutes/);
    assert.ok(new Date(second.body.paymentDeadline).getTime() - Date.now() <= 30 * 60_000);
    assert.equal((await bookingModel.findOne({ id: first.body.id })).paymentDeadline.toISOString(), first.body.paymentDeadline);
  });

  test('admin can activate PromptPay and generate a QR only for the active method', async () => {
    process.env.JWT_SECRET ||= 'integration-test-secret';
    const admin = await userModel.create({ email: 'promptpay-admin@example.com', fullname: 'Admin', phone: '0800000022', role: 'admin' });
    const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET);
    const saved = await request(app).put('/api/settings').set('Authorization', `Bearer ${token}`)
      .field('projectTitle', 'Test').field('projectSubtitle', 'Test event')
      .field('paymentType', 'promptpay').field('promptpayName', 'PromptPay Owner')
      .field('promptpayNumber', '0800000022');
    assert.equal(saved.status, 200);
    assert.equal(saved.body.paymentConfigured, true);
    assert.equal(saved.body.bankAccountNumber, '');
    assert.equal(saved.body.promptpayNumber, '0800000022');
    const qr = await request(app).get('/api/settings/promptpay-qr?amount=100');
    assert.equal(qr.status, 200);
    assert.match(qr.body.qrCode, /^data:image\/png;base64,/);
  });

  test('concurrent booking attempts cannot reserve the same seat twice', async () => {
    const request = (phone) => ({
      body: {
        customerName: 'Integration User',
        phone,
        seats: [{ tableId: 1, seatNumber: 1, zone: 'A', studentName: 'Integration Student', classLevel: 'M.1' }],
        bookingDate: new Date(Date.now() + 86400000).toISOString(),
      },
      user: { id: new mongoose.Types.ObjectId(), role: 'user' },
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

  test('an expired seat can be booked by the next visitor after refreshing availability', async () => {
    await bookingModel.create({
      id: 'BK-expired-before-rebooking',
      customerName: 'Previous User',
      phone: '0812345678',
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

    const tablesResponse = await request(app).get('/api/tables');
    assert.equal(tablesResponse.status, 200);
    assert.equal(tablesResponse.body[0].seats[1].isBooked, false);
    assert.equal((await bookingModel.findOne({ id: 'BK-expired-before-rebooking' })).status, 'payment_timeout');
    assert.equal((await tablePositionModel.findOne({ id: 1 })).seats[1].isBooked, false);

    const response = await callController(createBooking, {
      body: {
        customerName: 'Next User',
        phone: '0899999999',
        seats: [{ tableId: 1, seatNumber: 2, zone: 'A', studentName: 'Next Student', classLevel: 'M.1' }],
        bookingDate: new Date(Date.now() + 86400000).toISOString(),
      },
      user: { id: new mongoose.Types.ObjectId(), role: 'user' },
    });

    assert.equal(response.statusCode, 201);
    assert.equal((await tablePositionModel.findOne({ id: 1 })).seats[1].isBooked, true);
  });

  test('booking endpoint releases an expired seat before accepting a new reservation', async () => {
    await bookingModel.create({
      id: 'BK-expired-before-post',
      customerName: 'Previous User',
      phone: '0812345678',
      seats: [{ tableId: 1, seatNumber: 3, zone: 'A', tableName: 'Table 1' }],
      totalPrice: 100,
      bookingDate: new Date().toISOString(),
      status: 'pending_payment',
      paymentDeadline: new Date(Date.now() - 1000),
    });
    await tablePositionModel.updateOne(
      { id: 1, 'seats.seatNumber': 3 },
      { $set: { 'seats.$.isBooked': true } },
    );
    const user = await userModel.create({
      email: 'next-visitor@example.com',
      fullname: 'Next Visitor',
      phone: '0899999999',
    });
    process.env.JWT_SECRET ||= 'integration-test-secret';
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);

    const response = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Next Visitor',
        phone: user.phone,
        seats: [{ tableId: 1, seatNumber: 3, zone: 'A', studentName: 'Next Student', classLevel: 'M.1' }],
        bookingDate: new Date(Date.now() + 86400000).toISOString(),
      });

    assert.equal(response.status, 201);
    assert.equal((await bookingModel.findOne({ id: 'BK-expired-before-post' })).status, 'payment_timeout');
    assert.equal((await tablePositionModel.findOne({ id: 1 })).seats[2].isBooked, true);
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

  test('slip verification accepts a valid transfer and rejects duplicates, mismatches, and late transfers', async (t) => {
    const axios = require('axios');
    let providerResponse;
    t.mock.method(axios, 'post', async () => providerResponse);
    const userId = new mongoose.Types.ObjectId();
    const makeBooking = async (id, seatNumber) => {
      const booking = await bookingModel.create({
        id,
        customerName: 'Payment Visitor',
        phone: '0800000030',
        userId,
        seats: [{ tableId: 1, seatNumber, zone: 'A', tableName: 'Table 1' }],
        totalPrice: 100,
        bookingDate: new Date().toISOString(),
        status: 'pending_payment',
        paymentDeadline: new Date(Date.now() + 600000),
      });
      await tablePositionModel.updateOne(
        { id: 1, 'seats.seatNumber': seatNumber },
        { $set: { 'seats.$.isBooked': true } },
      );
      return booking;
    };
    const verified = (booking, transRef, overrides = {}) => ({
      data: {
        success: true,
        data: {
          success: true,
          amount: 100,
          transRef,
          transTimestamp: booking.createdAt.toISOString(),
          ...overrides,
        },
      },
    });
    const submit = (booking) => callController(confirmPayment, {
      params: { id: booking.id },
      user: { id: userId.toString(), role: 'user', phone: booking.phone },
      file: { path: 'https://example.com/test-slip.png' },
    });

    const first = await makeBooking('BK-slip-valid', 1);
    providerResponse = verified(first, 'TX-ONE');
    assert.equal((await submit(first)).body.status, 'confirmed');
    assert.equal((await bookingModel.findOne({ id: first.id })).paymentTransactionRef, 'TX-ONE');

    const duplicate = await makeBooking('BK-slip-duplicate', 2);
    providerResponse = verified(duplicate, 'TX-ONE');
    await assert.rejects(submit(duplicate), { statusCode: 409 });

    const wrongAmount = await makeBooking('BK-slip-amount', 3);
    providerResponse = verified(wrongAmount, 'TX-AMOUNT', { amount: 99 });
    await assert.rejects(submit(wrongAmount), { statusCode: 400 });

    const lateTransfer = await makeBooking('BK-slip-late', 4);
    providerResponse = verified(lateTransfer, 'TX-LATE', {
      transTimestamp: new Date(lateTransfer.paymentDeadline.getTime() + 1000).toISOString(),
    });
    await assert.rejects(submit(lateTransfer), { statusCode: 400 });

    const oldTransfer = await makeBooking('BK-slip-old', 5);
    providerResponse = verified(oldTransfer, 'TX-OLD', {
      transTimestamp: new Date(oldTransfer.createdAt.getTime() - 3600000).toISOString(),
    });
    await assert.rejects(submit(oldTransfer), { statusCode: 400 });

    for (const booking of [duplicate, wrongAmount, lateTransfer, oldTransfer]) {
      const saved = await bookingModel.findOne({ id: booking.id });
      assert.equal(saved.status, 'pending_payment');
      assert.equal(saved.paymentTransactionRef, undefined);
      assert.equal((await tablePositionModel.findOne({ id: 1 })).seats[booking.seats[0].seatNumber - 1].isBooked, true);
    }
  });

  test('verification outages leave the pending booking and its seat unchanged', async (t) => {
    const axios = require('axios');
    let providerError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    t.mock.method(axios, 'post', async () => { throw providerError; });
    const userId = new mongoose.Types.ObjectId();
    const booking = await bookingModel.create({
      id: 'BK-slip-outage',
      customerName: 'Payment Visitor',
      phone: '0800000040',
      userId,
      seats: [{ tableId: 1, seatNumber: 6, zone: 'A', tableName: 'Table 1' }],
      totalPrice: 100,
      bookingDate: new Date().toISOString(),
      status: 'pending_payment',
      paymentDeadline: new Date(Date.now() + 600000),
    });
    await tablePositionModel.updateOne(
      { id: 1, 'seats.seatNumber': 6 },
      { $set: { 'seats.$.isBooked': true } },
    );
    const submit = () => callController(confirmPayment, {
      params: { id: booking.id },
      user: { id: userId.toString(), role: 'user', phone: booking.phone },
      file: { path: 'https://example.com/test-slip.png' },
    });

    await assert.rejects(submit(), { statusCode: 503 });
    providerError = { response: { status: 400, data: { code: 1009, message: 'Bank temporarily unavailable' } } };
    await assert.rejects(submit(), { statusCode: 503 });
    providerError = { response: { status: 400, data: { code: 1012, message: 'Duplicate slip' } } };
    await assert.rejects(submit(), { statusCode: 409 });
    assert.equal((await bookingModel.findOne({ id: booking.id })).status, 'pending_payment');
    assert.equal((await tablePositionModel.findOne({ id: 1 })).seats[5].isBooked, true);
  });

  test('payment confirmation after the deadline times out the booking and releases its seat', async (t) => {
    const axios = require('axios');
    let providerCalls = 0;
    t.mock.method(axios, 'post', async () => { providerCalls += 1; });
    const userId = new mongoose.Types.ObjectId();
    const booking = await bookingModel.create({
      id: 'BK-slip-expired',
      customerName: 'Expired Payment Visitor',
      phone: '0800000050',
      userId,
      seats: [{ tableId: 1, seatNumber: 7, zone: 'A', tableName: 'Table 1' }],
      totalPrice: 100,
      bookingDate: new Date().toISOString(),
      status: 'pending_payment',
      paymentDeadline: new Date(Date.now() - 1000),
    });
    await tablePositionModel.updateOne(
      { id: 1, 'seats.seatNumber': 7 },
      { $set: { 'seats.$.isBooked': true } },
    );

    const response = await callController(confirmPayment, {
      params: { id: booking.id },
      user: { id: userId.toString(), role: 'user', phone: booking.phone },
      file: { path: 'https://example.com/test-slip.png' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.status, 'payment_timeout');
    assert.equal(providerCalls, 0);
    assert.equal((await bookingModel.findOne({ id: booking.id })).status, 'payment_timeout');
    assert.equal((await tablePositionModel.findOne({ id: 1 })).seats[6].isBooked, false);
  });

  test('deleting active bookings releases their seats for another visitor', async () => {
    const admin = await userModel.create({
      email: 'admin-delete-seats@example.com',
      fullname: 'Delete Admin',
      phone: '0800000010',
      role: 'admin',
    });
    await bookingModel.create(['pending_payment', 'confirmed'].map((status, index) => ({
      id: `BK-delete-${status}`,
      customerName: 'Booked Visitor',
      phone: `080000001${index + 1}`,
      userId: new mongoose.Types.ObjectId(),
      seats: [{ tableId: 1, seatNumber: index + 1, zone: 'A', tableName: 'Table 1' }],
      totalPrice: 100,
      bookingDate: new Date().toISOString(),
      status,
      paymentDeadline: new Date(Date.now() + 600000),
    })));
    for (const seatNumber of [1, 2]) {
      await tablePositionModel.updateOne(
        { id: 1, 'seats.seatNumber': seatNumber },
        { $set: { 'seats.$.isBooked': true } },
      );
    }

    process.env.JWT_SECRET ||= 'integration-test-secret';
    const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET);
    for (const status of ['pending_payment', 'confirmed']) {
      const response = await request(app)
        .delete(`/api/bookings/BK-delete-${status}`)
        .set('Authorization', `Bearer ${token}`);
      assert.equal(response.status, 204);
    }
    const table = await tablePositionModel.findOne({ id: 1 }).lean();
    assert.equal(table.seats[0].isBooked, false);
    assert.equal(table.seats[1].isBooked, false);
    assert.equal(await bookingModel.countDocuments({ id: /^BK-delete-/ }), 0);
  });

  test('PUT and PATCH cancellations release seats once and cannot revive cancelled bookings', async () => {
    const admin = await userModel.create({
      email: 'admin-cancel-seats@example.com',
      fullname: 'Cancel Admin',
      phone: '0800000020',
      role: 'admin',
    });
    const customer = await userModel.create({
      email: 'customer-cancel-seats@example.com',
      fullname: 'Cancel Customer',
      phone: '0800000021',
      role: 'user',
    });
    const bookings = [
      { id: 'BK-put-confirmed', status: 'confirmed', seatNumber: 1, user: admin },
      { id: 'BK-patch-confirmed', status: 'confirmed', seatNumber: 2, user: admin },
      { id: 'BK-put-pending', status: 'pending_payment', seatNumber: 3, user: customer },
    ];
    for (const booking of bookings) {
      await bookingModel.create({
        id: booking.id,
        customerName: booking.user.fullname,
        phone: booking.user.phone,
        userId: booking.user.id,
        seats: [{ tableId: 1, seatNumber: booking.seatNumber, zone: 'A', tableName: 'Table 1' }],
        totalPrice: 100,
        bookingDate: new Date().toISOString(),
        status: booking.status,
        paymentDeadline: new Date(Date.now() + 600000),
      });
      await tablePositionModel.updateOne(
        { id: 1, 'seats.seatNumber': booking.seatNumber },
        { $set: { 'seats.$.isBooked': true } },
      );
    }

    process.env.JWT_SECRET ||= 'integration-test-secret';
    const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET);
    const customerToken = jwt.sign({ id: customer.id }, process.env.JWT_SECRET);
    const putCancel = await request(app).put('/api/bookings/BK-put-confirmed')
      .set('Authorization', `Bearer ${adminToken}`).send({ status: 'cancelled' });
    const patchCancel = await request(app).patch('/api/bookings/BK-patch-confirmed')
      .set('Authorization', `Bearer ${adminToken}`).send({ status: 'cancelled' });
    const customerCancel = await request(app).put('/api/bookings/BK-put-pending')
      .set('Authorization', `Bearer ${customerToken}`).send({ status: 'cancelled' });
    assert.equal(putCancel.status, 200);
    assert.equal(patchCancel.status, 200);
    assert.equal(customerCancel.status, 200);
    assert.deepEqual((await tablePositionModel.findOne({ id: 1 }).lean()).seats.slice(0, 3).map((seat) => seat.isBooked), [false, false, false]);

    await bookingModel.create({
      id: 'BK-seat-reused',
      customerName: customer.fullname,
      phone: customer.phone,
      userId: customer.id,
      seats: [{ tableId: 1, seatNumber: 2, zone: 'A', tableName: 'Table 1' }],
      totalPrice: 100,
      bookingDate: new Date().toISOString(),
      status: 'pending_payment',
      paymentDeadline: new Date(Date.now() + 600000),
    });
    await tablePositionModel.updateOne(
      { id: 1, 'seats.seatNumber': 2 },
      { $set: { 'seats.$.isBooked': true } },
    );

    const repeatedCancel = await request(app).patch('/api/bookings/BK-patch-confirmed')
      .set('Authorization', `Bearer ${adminToken}`).send({ status: 'cancelled' });
    const revive = await request(app).put('/api/bookings/BK-put-confirmed')
      .set('Authorization', `Bearer ${adminToken}`).send({ status: 'confirmed' });
    const editCancelledSeats = await request(app).put('/api/bookings/BK-put-confirmed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ seats: [{ tableId: 1, seatNumber: 4, zone: 'A', studentName: 'Test', classLevel: 'M.1' }] });
    assert.equal(repeatedCancel.status, 200);
    assert.equal(revive.status, 409);
    assert.equal(editCancelledSeats.status, 409);
    assert.equal((await tablePositionModel.findOne({ id: 1 }).lean()).seats[1].isBooked, true);
    assert.equal((await bookingModel.findOne({ id: 'BK-patch-confirmed' })).status, 'cancelled');
  });

  test('admins can read and manage every booking while customers remain limited to their own', async () => {
    const [adminA, adminB, customer] = await Promise.all([
      userModel.create({ email: 'admin-a-scope@example.com', fullname: 'Admin A', phone: '0800000001', role: 'admin' }),
      userModel.create({ email: 'admin-b-scope@example.com', fullname: 'Admin B', phone: '0800000002', role: 'admin' }),
      userModel.create({ email: 'customer-scope@example.com', fullname: 'Customer', phone: '0800000003', role: 'user' }),
    ]);
    const makeBooking = (id, owner, role, seatNumber) => ({
      id,
      customerName: owner.fullname,
      phone: owner.phone,
      userId: owner._id,
      ...(role ? { createdByRole: role } : {}),
      seats: [{ tableId: 1, seatNumber, zone: 'A', tableName: 'Table 1' }],
      totalPrice: 100,
      bookingDate: new Date().toISOString(),
      status: 'confirmed',
      paymentDeadline: new Date(Date.now() + 600000),
    });
    await bookingModel.create([
      makeBooking('BK-admin-a', adminA, 'admin', 1),
      makeBooking('BK-admin-b', adminB, 'admin', 2),
      makeBooking('BK-customer', customer, 'user', 3),
      makeBooking('BK-legacy-customer', customer, null, 4),
      makeBooking('BK-legacy-admin-b', adminB, null, 5),
    ]);

    process.env.JWT_SECRET ||= 'integration-test-secret';
    const tokenFor = (user) => jwt.sign({ id: user.id }, process.env.JWT_SECRET);
    const asAdminA = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${tokenFor(adminA)}`);
    const list = await asAdminA('get', '/api/bookings');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map((item) => item.id).sort(), ['BK-admin-a', 'BK-admin-b', 'BK-customer', 'BK-legacy-admin-b', 'BK-legacy-customer']);

    const own = await asAdminA('get', '/api/bookings/BK-admin-a');
    assert.equal(own.status, 200);
    const other = await asAdminA('get', '/api/bookings/BK-admin-b');
    assert.equal(other.status, 200);
    assert.equal((await asAdminA('get', '/api/bookings/BK-legacy-admin-b')).status, 200);
    assert.equal((await asAdminA('get', '/api/bookings/BK-customer')).status, 200);

    const stats = await asAdminA('get', '/api/bookings/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.body.overall.totalBookings, 5);
    assert.equal(stats.body.overall.totalRevenue, 500);

    const exported = await asAdminA('get', '/api/bookings/export/xlsx').buffer(true).parse((response, callback) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
      response.on('error', callback);
    });
    assert.equal(exported.status, 200);
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body);
    const exportIds = [];
    workbook.worksheets[0].eachRow((row, number) => {
      if (number > 1) exportIds.push(row.getCell(1).value);
    });
    assert.deepEqual(exportIds.sort(), ['BK-admin-a', 'BK-admin-b', 'BK-customer', 'BK-legacy-admin-b', 'BK-legacy-customer']);

    assert.equal((await asAdminA('put', '/api/bookings/BK-admin-b').send({ notes: 'changed' })).status, 200);
    assert.equal((await bookingModel.findOne({ id: 'BK-admin-b' })).notes, 'changed');
    assert.equal((await asAdminA('patch', '/api/bookings/BK-admin-b/check-in').send({ tableId: 1, seatNumber: 2, zone: 'A', checkedIn: true })).status, 200);
    assert.equal((await bookingModel.findOne({ id: 'BK-admin-b' })).seats[0].checkIn.checkedIn, true);
    assert.equal((await asAdminA('post', '/api/bookings/BK-admin-b/confirm-payment')).status, 200);
    assert.equal((await asAdminA('patch', '/api/bookings/BK-admin-b').send({ status: 'cancelled' })).status, 200);
    assert.equal((await bookingModel.findOne({ id: 'BK-admin-b' })).status, 'cancelled');
    assert.equal((await asAdminA('put', '/api/bookings/BK-admin-a').send({ createdByRole: 'user' })).status, 400);
    assert.equal((await bookingModel.findOne({ id: 'BK-admin-a' })).createdByRole, 'admin');

    const customerList = await request(app).get('/api/bookings/my').set('Authorization', `Bearer ${tokenFor(customer)}`);
    assert.equal(customerList.status, 200);
    assert.deepEqual(customerList.body.map((item) => item.id).sort(), ['BK-customer', 'BK-legacy-customer']);
    const adminHistory = await asAdminA('get', '/api/bookings/my');
    assert.equal(adminHistory.status, 200);
    assert.deepEqual(adminHistory.body.map((item) => item.id), ['BK-admin-a']);
    assert.equal((await request(app).get('/api/bookings/BK-admin-a').set('Authorization', `Bearer ${tokenFor(customer)}`)).status, 404);
    assert.equal((await request(app).put('/api/bookings/BK-admin-a').set('Authorization', `Bearer ${tokenFor(customer)}`).send({ status: 'cancelled' })).status, 403);
    assert.equal((await asAdminA('patch', '/api/bookings/BK-customer/check-in').send({ tableId: 1, seatNumber: 3, zone: 'A', checkedIn: true })).status, 200);
    assert.equal((await bookingModel.findOne({ id: 'BK-customer' })).seats[0].checkIn.checkedIn, true);
    const adminBList = await request(app).get('/api/bookings').set('Authorization', `Bearer ${tokenFor(adminB)}`);
    assert.deepEqual(adminBList.body.map((item) => item.id).sort(), ['BK-admin-a', 'BK-admin-b', 'BK-customer', 'BK-legacy-admin-b', 'BK-legacy-customer']);
    assert.equal((await asAdminA('delete', '/api/bookings/BK-admin-b')).status, 204);
    assert.equal(await bookingModel.countDocuments({ id: 'BK-admin-b' }), 0);
  });
}
