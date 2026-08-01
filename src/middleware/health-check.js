const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const healthCheck = (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  const status = databaseConnected ? 'healthy' : 'unhealthy';

  res.status(databaseConnected ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    dependencies: {
      database: databaseConnected ? 'up' : 'down',
    },
  });
};

router.get('/health-check', healthCheck);
router.get('/health', healthCheck);

module.exports = router;