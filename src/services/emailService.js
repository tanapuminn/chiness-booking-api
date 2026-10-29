const nodemailer = require('nodemailer');
const appSettingModel = require('../models/appSettingModel');

const T = {
  bookingConfirmed: '\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19\u0e01\u0e32\u0e23\u0e08\u0e2d\u0e07\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08',
  bookingCode: '\u0e23\u0e2b\u0e31\u0e2a\u0e01\u0e32\u0e23\u0e08\u0e2d\u0e07',
  customerName: '\u0e0a\u0e37\u0e48\u0e2d\u0e1c\u0e39\u0e49\u0e08\u0e2d\u0e07',
  phone: '\u0e40\u0e1a\u0e2d\u0e23\u0e4c\u0e42\u0e17\u0e23\u0e28\u0e31\u0e1e\u0e17\u0e4c',
  bookingDate: '\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48\u0e08\u0e2d\u0e07',
  seats: '\u0e17\u0e35\u0e48\u0e19\u0e31\u0e48\u0e07',
  seatCount: '\u0e08\u0e33\u0e19\u0e27\u0e19\u0e17\u0e35\u0e48\u0e19\u0e31\u0e48\u0e07',
  totalPrice: '\u0e23\u0e32\u0e04\u0e32\u0e23\u0e27\u0e21',
  note: '\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38',
  openTicket: '\u0e40\u0e1b\u0e34\u0e14\u0e2b\u0e19\u0e49\u0e32\u0e15\u0e31\u0e4b\u0e27',
  table: '\u0e42\u0e15\u0e4a\u0e30',
  keepEmail: '\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e01\u0e47\u0e1a\u0e2d\u0e35\u0e40\u0e21\u0e25\u0e09\u0e1a\u0e31\u0e1a\u0e19\u0e35\u0e49\u0e44\u0e27\u0e49\u0e40\u0e1b\u0e47\u0e19\u0e2b\u0e25\u0e31\u0e01\u0e10\u0e32\u0e19\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19\u0e01\u0e32\u0e23\u0e08\u0e2d\u0e07 \u0e41\u0e25\u0e30\u0e41\u0e2a\u0e14\u0e07\u0e23\u0e2b\u0e31\u0e2a\u0e01\u0e32\u0e23\u0e08\u0e2d\u0e07\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e40\u0e08\u0e49\u0e32\u0e2b\u0e19\u0e49\u0e32\u0e17\u0e35\u0e48',
};

const isEmailEnabled = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
  if (!isEmailEnabled()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const formatThaiDate = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('th-TH', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: process.env.TZ || 'Asia/Bangkok',
  });
};

const formatSeats = (seats = []) => {
  if (!Array.isArray(seats) || seats.length === 0) return '-';
  return seats
    .map((seat) => `${seat.tableName || `${T.table} ${seat.tableId}`} ${T.seats} ${seat.seatNumber}`)
    .join(', ');
};

const getSiteSettings = async () => {
  const settings = await appSettingModel.findOne({ key: 'site' }).lean();
  return {
    projectTitle: settings?.projectTitle || '',
    projectSubtitle: settings?.projectSubtitle || '',
  };
};

const buildProjectLine = (settings) => [settings.projectTitle, settings.projectSubtitle].filter(Boolean).join(' ');

const buildTicketEmailHtml = ({ booking, ticketUrl, settings }) => {
  const seats = formatSeats(booking.seats);
  const projectLine = buildProjectLine(settings);

  return `
    <div style="font-family: Arial, 'Tahoma', sans-serif; color: #111827; line-height: 1.6; max-width: 640px; margin: 0 auto;">
      <h1 style="font-size: 24px; margin: 0 0 8px; color: #166534;">${T.bookingConfirmed}</h1>
      ${projectLine ? `<p style="margin: 0 0 20px; color: #4b5563;">${escapeHtml(projectLine)}</p>` : ''}

      <div style="border: 1px solid #bbf7d0; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
        <div style="background: #f0fdf4; padding: 16px; text-align: center;">
          <div style="font-size: 13px; color: #4b5563;">${T.bookingCode}</div>
          <div style="font-size: 22px; font-weight: 700; letter-spacing: 0.04em;">${escapeHtml(booking.id)}</div>
        </div>
        <div style="padding: 16px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px 0; color: #6b7280;">${T.customerName}</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${escapeHtml(booking.customerName)}</td></tr>
              <tr><td style="padding: 8px 0; color: #6b7280;">${T.phone}</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${escapeHtml(booking.phone)}</td></tr>
              <tr><td style="padding: 8px 0; color: #6b7280;">${T.bookingDate}</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${escapeHtml(formatThaiDate(booking.bookingDate))}</td></tr>
              <tr><td style="padding: 8px 0; color: #6b7280;">${T.seats}</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${escapeHtml(seats)}</td></tr>
              <tr><td style="padding: 8px 0; color: #6b7280;">${T.seatCount}</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${booking.seats?.length || 0}</td></tr>
              <tr><td style="padding: 8px 0; color: #6b7280;">${T.totalPrice}</td><td style="padding: 8px 0; text-align: right; font-weight: 700; color: #2563eb;">฿${Number(booking.totalPrice || 0).toLocaleString('th-TH')}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      ${booking.notes ? `<p style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:12px;"><strong>${T.note}:</strong> ${escapeHtml(booking.notes)}</p>` : ''}

      ${ticketUrl ? `<p style="margin: 20px 0;"><a href="${escapeHtml(ticketUrl)}" style="display:inline-block; background:#2563eb; color:#ffffff; text-decoration:none; padding:10px 16px; border-radius:6px; font-weight:600;">${T.openTicket}</a></p>` : ''}

      <p style="font-size: 13px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px;">
        ${T.keepEmail}
      </p>
    </div>
  `;
};

const sendTicketEmail = async ({ to, booking }) => {
  if (!to) {
    console.warn(`Ticket email skipped for booking ${booking.id}: recipient email missing`);
    return { skipped: true, reason: 'recipient_missing' };
  }

  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`Ticket email skipped for booking ${booking.id}: SMTP env is not configured`);
    return { skipped: true, reason: 'smtp_not_configured' };
  }

  const settings = await getSiteSettings();
  const projectLine = buildProjectLine(settings);
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const frontendUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || '').replace(/\/$/, '');
  const ticketUrl = frontendUrl ? `${frontendUrl}/ticket?bookingId=${encodeURIComponent(booking.id)}` : '';

  await transporter.sendMail({
    from,
    to,
    subject: `${projectLine ? `${projectLine} - ` : ''}${T.bookingCode} ${booking.id}`,
    text: [
      T.bookingConfirmed,
      projectLine,
      `${T.bookingCode}: ${booking.id}`,
      `${T.customerName}: ${booking.customerName}`,
      `${T.phone}: ${booking.phone}`,
      `${T.bookingDate}: ${formatThaiDate(booking.bookingDate)}`,
      `${T.seats}: ${formatSeats(booking.seats)}`,
      `${T.totalPrice}: ฿${Number(booking.totalPrice || 0).toLocaleString('th-TH')}`,
      ticketUrl ? `${T.openTicket}: ${ticketUrl}` : '',
    ].filter(Boolean).join('\n'),
    html: buildTicketEmailHtml({ booking, ticketUrl, settings }),
  });

  return { sent: true };
};

const buildPasswordResetHtml = ({ fullname, resetUrl, projectLine, ttlMinutes }) => `
    <div style="font-family: Arial, 'Tahoma', sans-serif; color: #111827; line-height: 1.6; max-width: 560px; margin: 0 auto;">
      <h1 style="font-size: 22px; margin: 0 0 8px;">ตั้งรหัสผ่านใหม่</h1>
      ${projectLine ? `<p style="margin: 0 0 16px; color: #4b5563;">${escapeHtml(projectLine)}</p>` : ''}
      <p>สวัสดีคุณ ${escapeHtml(fullname)}</p>
      <p>เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ ลิงก์นี้ใช้ได้ครั้งเดียวและมีอายุ ${ttlMinutes} นาที</p>
      <p style="margin: 24px 0;"><a href="${escapeHtml(resetUrl)}" style="display:inline-block; background:#be2a7c; color:#ffffff; text-decoration:none; padding:10px 18px; border-radius:6px; font-weight:600;">ตั้งรหัสผ่านใหม่</a></p>
      <p style="font-size: 13px; color: #6b7280;">ถ้าคุณไม่ได้ขอตั้งรหัสผ่านใหม่ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ</p>
    </div>
  `;

const sendPasswordResetEmail = async ({ to, fullname, resetUrl, ttlMinutes }) => {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('Password reset email skipped: SMTP env is not configured');
    return { skipped: true, reason: 'smtp_not_configured' };
  }

  const settings = await getSiteSettings();
  const projectLine = buildProjectLine(settings);
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `${projectLine ? `${projectLine} - ` : ''}ตั้งรหัสผ่านใหม่`,
    text: [
      `สวัสดีคุณ ${fullname}`,
      `ตั้งรหัสผ่านใหม่ได้ที่ลิงก์นี้ (ใช้ได้ครั้งเดียว มีอายุ ${ttlMinutes} นาที): ${resetUrl}`,
      'ถ้าคุณไม่ได้ขอตั้งรหัสผ่านใหม่ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ',
    ].join('\n'),
    html: buildPasswordResetHtml({ fullname, resetUrl, projectLine, ttlMinutes }),
  });

  return { sent: true };
};

module.exports = { sendTicketEmail, sendPasswordResetEmail };
