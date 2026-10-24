const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');

test('health endpoint exposes readiness and request id without starting the server', async () => {
  const response = await request(app).get('/api/health');

  assert.equal(response.status, 503);
  assert.equal(response.body.status, 'unhealthy');
  assert.equal(response.body.dependencies.database, 'down');
  assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
});

test('protected booking endpoints reject anonymous requests', async () => {
  const response = await request(app).get('/api/bookings/my');

  assert.equal(response.status, 401);
  assert.equal(response.body.message, 'No token provided');
  assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
});

test('admin booking listing rejects anonymous requests before controller access', async () => {
  const response = await request(app).get('/api/bookings');

  assert.equal(response.status, 401);
  assert.equal(response.body.message, 'No token provided');
});

test('logout clears the HttpOnly auth cookie without authentication', async () => {
  const response = await request(app).post('/api/auth/logout');

  assert.equal(response.status, 204);
  assert.match(response.headers['set-cookie'][0], /auth_token=;/);
});
