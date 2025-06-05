const express = require('express');
const zoneCtr = require('../controllers/zoneController');

const router = express.Router();

router.get('/', zoneCtr.getZoneConfigs);
router.post('/', zoneCtr.createZoneConfig);
router.put('/:id', zoneCtr.updateZoneConfig);
router.delete('/:id', zoneCtr.deleteZoneConfig);

module.exports = router;