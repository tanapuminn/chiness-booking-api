const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const { getAuthToken } = require('../utils/authCookie');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearerToken || getAuthToken(req);

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(payload.id).select('phone email fullname role').lean();

    if (!user) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    req.user = {
      ...payload,
      id: user._id,
      phone: user.phone || '',
      email: user.email,
      fullname: user.fullname,
      role: user.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

module.exports = { authenticate, requireAdmin };