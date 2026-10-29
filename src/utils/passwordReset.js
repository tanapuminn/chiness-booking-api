const crypto = require('crypto');

const RESET_TOKEN_TTL_MINUTES = 15;
const MIN_PASSWORD_LENGTH = 6;

// เก็บเฉพาะ hash ของ token ในฐานข้อมูล ตัว token จริงอยู่ในลิงก์ที่ส่งทางอีเมลเท่านั้น
const hashResetToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const createResetToken = (now = Date.now()) => {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(now + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
  };
};

const buildResetUrl = (token) => {
  const frontendUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || '').replace(/\/$/, '');
  return frontendUrl ? `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}` : '';
};

module.exports = { RESET_TOKEN_TTL_MINUTES, MIN_PASSWORD_LENGTH, hashResetToken, createResetToken, buildResetUrl };
