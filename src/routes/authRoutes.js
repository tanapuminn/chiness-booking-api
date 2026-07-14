const express = require('express');
const authCtr = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', authCtr.register);
router.post('/login', authCtr.login);
router.post('/google', authCtr.googleLogin);
router.get('/me', authenticate, authCtr.me);
router.put('/profile', authenticate, authCtr.updateProfile);

module.exports = router;
