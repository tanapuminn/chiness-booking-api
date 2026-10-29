const test = require('node:test');
const assert = require('node:assert/strict');
const { createResetToken, hashResetToken, buildResetUrl, RESET_TOKEN_TTL_MINUTES } = require('../src/utils/passwordReset');

test('reset token is random, stored only as a sha256 hash, and expires after 15 minutes', () => {
  const now = Date.UTC(2026, 9, 29, 12, 0, 0);
  const first = createResetToken(now);
  const second = createResetToken(now);
  assert.match(first.token, /^[0-9a-f]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashResetToken(first.token));
  assert.notEqual(first.tokenHash, first.token);
  assert.equal(first.expiresAt.getTime() - now, RESET_TOKEN_TTL_MINUTES * 60 * 1000);
});

test('reset link uses FRONTEND_URL and is empty when it is not configured', () => {
  const previous = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://booking.example.com/';
  assert.equal(buildResetUrl('abc'), 'https://booking.example.com/reset-password?token=abc');
  delete process.env.FRONTEND_URL;
  assert.equal(buildResetUrl('abc'), '');
  if (previous !== undefined) process.env.FRONTEND_URL = previous;
});
