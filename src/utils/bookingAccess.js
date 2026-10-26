const isBookingOwner = (booking, req) => {
  if (booking.userId) return String(booking.userId) === String(req.user?.id);
  return Boolean(req.user?.phone) && booking.phone === req.user.phone;
};

const canAccessBooking = async (booking, req) => {
  if (req.user?.role === 'admin') return true;
  if (isBookingOwner(booking, req)) return true;
  return false;
};

module.exports = { isBookingOwner, canAccessBooking };
