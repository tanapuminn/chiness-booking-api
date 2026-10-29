const express = require('express');
const authCtr = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/register', authLimiter, authCtr.register);
router.post('/login', authLimiter, authCtr.login);
router.post('/google', authLimiter, authCtr.googleLogin);
router.post('/forgot-password', authLimiter, authCtr.forgotPassword);
router.post('/reset-password', authLimiter, authCtr.resetPassword);
router.post('/logout', authCtr.logout);
router.get('/me', authenticate, authCtr.me);
router.put('/profile', authenticate, authCtr.updateProfile);

module.exports = router;
