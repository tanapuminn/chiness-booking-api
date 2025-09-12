import express from 'express';
const router = express.Router();

router.get('/health-check', (req, res) => {
  try {
    // Add any additional health checks here (e.g. database connection)
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

export default router;