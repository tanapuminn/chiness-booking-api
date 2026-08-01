const express = require('express');
const zoneCtr = require('../controllers/zoneController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', zoneCtr.getZoneConfigs);
router.post('/', authenticate, requireAdmin, zoneCtr.createZoneConfig);
router.put('/:id', authenticate, requireAdmin, zoneCtr.updateZoneConfig);
router.delete('/:id', authenticate, requireAdmin, zoneCtr.deleteZoneConfig);

module.exports = router;