const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const userModel = require('../models/userModel');
const { setAuthCookie, clearAuthCookie } = require('../utils/authCookie');
const { getAuthSessionDuration } = require('../utils/authSession');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const signToken = (user) =>
  jwt.sign(
    { id: user._id, phone: user.phone || '', email: user.email, fullname: user.fullname, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: getAuthSessionDuration() }
  );

const formatUser = (user) => ({
  id: user._id,
  phone: user.phone || '',
  email: user.email,
  fullname: user.fullname,
  role: user.role,
  profileCompleted: Boolean(user.phone),
  authProviders: {
    password: Boolean(user.password),
    google: Boolean(user.googleId),
  },
});

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const verifyGoogleCredential = async (credential) => {
  if (!credential) {
    const error = new Error('Google credential is required');
    error.statusCode = 400;
    throw error;
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    const error = new Error('GOOGLE_CLIENT_ID is not configured');
    error.statusCode = 500;
    throw error;
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email) {
    const error = new Error('Invalid Google credential');
    error.statusCode = 401;
    throw error;
  }

  if (!payload.email_verified) {
    const error = new Error('Google email is not verified');
    error.statusCode = 401;
    throw error;
  }

  return {
    googleId: payload.sub,
    email: normalizeEmail(payload.email),
    fullname: payload.name || payload.email,
    avatarUrl: payload.picture || '',
  };
};

const attachGoogleAccount = (user, googleProfile) => {
  user.googleId = googleProfile.googleId;
  user.googleEmail = googleProfile.email;
  user.googleName = googleProfile.fullname;
  user.avatarUrl = googleProfile.avatarUrl;
};

const register = async (req, res, next) => {
  try {
    const { phone, email, password, fullname, googleCredential } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!phone || !normalizedEmail || !password || !fullname) {
      return res.status(400).json({ message: 'phone, email, fullname and password are required' });
    }

    const phoneRegex = /^0\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    let googleProfile = null;
    if (googleCredential) {
      googleProfile = await verifyGoogleCredential(googleCredential);
      if (googleProfile.email !== normalizedEmail) {
        return res.status(400).json({ message: 'Google email must match the registered email' });
      }
    }

    const phoneExists = await userModel.findOne({ phone });
    if (phoneExists) {
      return res.status(409).json({ message: 'This phone number is already registered' });
    }

    const emailExists = await userModel.findOne({ email: normalizedEmail });
    if (emailExists) {
      return res.status(409).json({ message: 'This email is already registered' });
    }

    if (googleProfile) {
      const googleExists = await userModel.findOne({ googleId: googleProfile.googleId });
      if (googleExists) {
        return res.status(409).json({ message: 'This Google account is already linked to another user' });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const userData = { phone, email: normalizedEmail, fullname, password: hashed };

    if (googleProfile) {
      Object.assign(userData, {
        googleId: googleProfile.googleId,
        googleEmail: googleProfile.email,
        googleName: googleProfile.fullname,
        avatarUrl: googleProfile.avatarUrl,
      });
    }

    const user = await userModel.create(userData);
    const token = signToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ user: formatUser(user) });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: 'phone and password are required' });
    }

    const user = await userModel.findOne({ phone });
    if (!user) {
      return res.status(401).json({ message: 'Phone number or password is incorrect' });
    }

    if (!user.password) {
      return res.status(401).json({ message: 'Please sign in with Google for this account' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Phone number or password is incorrect' });
    }

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user: formatUser(user) });
  } catch (error) {
    next(error);
  }
};

const googleLogin = async (req, res, next) => {
  try {
    const googleProfile = await verifyGoogleCredential(req.body.credential);

    let user = await userModel.findOne({ googleId: googleProfile.googleId });
    if (!user) {
      user = await userModel.findOne({ email: googleProfile.email });
    }

    if (!user) {
      user = await userModel.create({
        email: googleProfile.email,
        fullname: googleProfile.fullname,
        googleId: googleProfile.googleId,
        googleEmail: googleProfile.email,
        googleName: googleProfile.fullname,
        avatarUrl: googleProfile.avatarUrl,
      });
    }

    if (user.googleId && user.googleId !== googleProfile.googleId) {
      return res.status(409).json({ message: 'This email is linked to a different Google account' });
    }

    if (!user.googleId) {
      attachGoogleAccount(user, googleProfile);
      await user.save();
    }

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user: formatUser(user) });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { phone, fullname } = req.body;
    const user = await userModel.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (phone !== undefined) {
      const normalizedPhone = String(phone || '').trim();
      const phoneRegex = /^0\d{9}$/;

      if (!phoneRegex.test(normalizedPhone)) {
        return res.status(400).json({ message: 'Invalid phone number format' });
      }

      const phoneExists = await userModel.findOne({ phone: normalizedPhone, _id: { $ne: user._id } });
      if (phoneExists) {
        return res.status(409).json({ message: 'This phone number is already registered' });
      }

      user.phone = normalizedPhone;
    }

    if (fullname !== undefined) {
      const normalizedFullname = String(fullname || '').trim();
      if (!normalizedFullname) {
        return res.status(400).json({ message: 'Full name is required' });
      }
      user.fullname = normalizedFullname;
    }

    await user.save();

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user: formatUser(user) });
  } catch (error) {
    next(error);
  }
};
const logout = async (req, res) => {
  clearAuthCookie(res);
  res.status(204).send();
};
const me = async (req, res, next) => {
  try {
    const user = await userModel.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: formatUser(user) });
  } catch (error) {
    next(error);
  }
};
module.exports = { register, login, googleLogin, updateProfile, me, logout };
