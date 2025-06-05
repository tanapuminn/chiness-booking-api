const express = require('express');
const tableCtr = require('../controllers/tableController');

const router = express.Router();

router.get('/', tableCtr.getTablePositions);
router.post('/', tableCtr.createTable);
router.put('/:id', tableCtr.updateTablePosition);
router.delete('/:id', tableCtr.deleteTable);
router.put('/:id/toggle-active', tableCtr.toggleTableActive);

module.exports = router;