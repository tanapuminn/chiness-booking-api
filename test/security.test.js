const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTH_COOKIE_NAME,
  setAuthCookie,
  clearAuthCookie,
  getAuthToken,
} = require('../src/utils/authCookie');
const { requireAdmin } = require('../src/middleware/authMiddleware');

const createResponse = () => ({
  cookieCalls: [],
  clearCookieCalls: [],
  cookie(...args) { this.cookieCalls.push(args); },
  clearCookie(...args) { this.clearCookieCalls.push(args); },
});

test('auth cookie stores secure HttpOnly session settings', () => {
  const response = createResponse();
  const previousEnvironment = process.env.NODE_ENV;
  const previousSameSite = process.env.AUTH_COOKIE_SAMESITE;
  process.env.NODE_ENV = 'production';
  process.env.AUTH_COOKIE_SAMESITE = 'none';

  setAuthCookie(response, 'signed-token');

  assert.equal(response.cookieCalls.length, 1);
  assert.equal(response.cookieCalls[0][0], AUTH_COOKIE_NAME);
  assert.equal(response.cookieCalls[0][1], 'signed-token');
  assert.equal(response.cookieCalls[0][2].httpOnly, true);
  assert.equal(response.cookieCalls[0][2].secure, true);
  assert.equal(response.cookieCalls[0][2].sameSite, 'none');
  assert.equal(response.cookieCalls[0][2].path, '/');

  if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
  if (previousSameSite === undefined) delete process.env.AUTH_COOKIE_SAMESITE; else process.env.AUTH_COOKIE_SAMESITE = previousSameSite;
});

test('auth cookie can be cleared without changing its scope', () => {
  const previousSameSite = process.env.AUTH_COOKIE_SAMESITE;
  delete process.env.AUTH_COOKIE_SAMESITE;
  const response = createResponse();
  clearAuthCookie(response);

  assert.deepEqual(response.clearCookieCalls, [[AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
  }]]);
  if (previousSameSite === undefined) { delete process.env.AUTH_COOKIE_SAMESITE; } else { process.env.AUTH_COOKIE_SAMESITE = previousSameSite; }
});

test('auth token parser reads only the requested cookie', () => {
  const request = {
    headers: {
      cookie: 'theme=dark; auth_token=abc%20123; other=value',
    },
  };

  assert.equal(getAuthToken(request), 'abc 123');
  assert.equal(getAuthToken({ headers: {} }), null);
});

test('admin guard rejects missing or non-admin users', () => {
  const responses = [];
  const response = { status(code) { responses.push(code); return this; }, json(body) { responses.push(body); } };

  requireAdmin({ user: { role: 'customer' } }, response, () => assert.fail('customer must be rejected'));
  requireAdmin({ user: undefined }, response, () => assert.fail('anonymous user must be rejected'));

  assert.deepEqual(responses, [403, { message: 'Admin access required' }, 403, { message: 'Admin access required' }]);
});

test('admin guard allows admin users', () => {
  let called = false;
  requireAdmin({ user: { role: 'admin' } }, {}, () => { called = true; });
  assert.equal(called, true);
});
test('health route reports database readiness', () => {
  const healthRouter = require('../src/middleware/health-check');
  assert.equal(typeof healthRouter, 'function');
  const routes = healthRouter.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.deepEqual(routes, ['/health-check', '/health']);
});
const { parseAndValidateSeats, isBookingOwner } = require('../src/controllers/bookingController');

test('booking seat validation normalizes valid input', () => {
  const seats = parseAndValidateSeats(JSON.stringify([
    { tableId: '12', seatNumber: '3', zone: '  A  ', note: 'window' },
  ]));

  assert.deepEqual(seats, [{
    tableId: 12,
    seatNumber: 3,
    zone: 'A',
    note: 'window',
  }]);
});

test('booking seat validation rejects duplicate seats', () => {
  assert.throws(
    () => parseAndValidateSeats([
      { tableId: 1, seatNumber: 1, zone: 'A' },
      { tableId: 1, seatNumber: 1, zone: 'A' },
    ]),
    (error) => error.statusCode === 400 && error.message.includes('Duplicate seat selection'),
  );
});

test('booking seat validation rejects invalid seat ranges and payload sizes', () => {
  assert.throws(() => parseAndValidateSeats([{ tableId: 1, seatNumber: 0, zone: 'A' }]), /valid tableId/);
  assert.throws(() => parseAndValidateSeats([]), /between 1 and 100/);
  assert.throws(() => parseAndValidateSeats('not-json'), /Invalid seats format/);
});

test('booking ownership requires matching user or legacy phone', () => {
  assert.equal(isBookingOwner({ userId: 'user-1' }, { user: { id: 'user-1', role: 'customer' } }), true);
  assert.equal(isBookingOwner({ userId: 'user-1' }, { user: { id: 'user-2', role: 'customer' } }), false);
  assert.equal(isBookingOwner({ phone: '0812345678' }, { user: { phone: '0812345678', role: 'customer' } }), true);
  assert.equal(isBookingOwner({ userId: 'user-1' }, { user: { role: 'admin' } }), true);
});