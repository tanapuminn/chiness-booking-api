const express = require('express');
const tableCtr = require('../controllers/tableController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');
const { refreshExpiredBookings } = require('../middleware/refreshExpiredBookings');

const router = express.Router();

router.get('/', refreshExpiredBookings, tableCtr.getTablePositions);
router.post('/', authenticate, requireAdmin, tableCtr.createTable);
router.put('/:id', authenticate, requireAdmin, tableCtr.updateTablePosition);
router.delete('/:id', authenticate, requireAdmin, tableCtr.deleteTable);
router.put('/:id/toggle-active', authenticate, requireAdmin, tableCtr.toggleTableActive);

module.exports = router;
