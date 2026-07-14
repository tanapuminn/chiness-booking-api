const express = require('express');
const settingsCtr = require('../controllers/settingsController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', settingsCtr.getSettings);
router.put('/', authenticate, requireAdmin, settingsCtr.updateSettings);

module.exports = router;