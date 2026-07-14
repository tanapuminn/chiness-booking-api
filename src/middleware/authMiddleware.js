const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
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