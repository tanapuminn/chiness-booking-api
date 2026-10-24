const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./src/config/db');
const path = require('path');
const { startBookingScheduler } = require('./src/utils/bookingScheduler.js');
const ApiError = require('./src/utils/ApiError.js');
const { apiLimiter } = require('./src/middleware/rateLimiters');
const logger = require('./src/utils/logger');

const bookingRoutes = require('./src/routes/bookingRoutes');
const tableRoutes = require('./src/routes/tableRoutes');
const zoneRoutes = require('./src/routes/zoneRoutes');
const authRoutes = require('./src/routes/authRoutes');
const settingsRoutes = require('./src/routes/settingsRoutes');
const healthRoutes = require('./src/middleware/health-check.js');

dotenv.config();
const app = express();

if (process.env.VERCEL || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin is not allowed'));
  },
  methods: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(helmet());
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  const startedAt = process.hrtime.bigint();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('http_request', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  });
  next();
});
app.use(apiLimiter);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '100kb' }));
app.use(express.urlencoded({
  extended: true,
  limit: process.env.URLENCODED_BODY_LIMIT || '50kb',
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Vercel invokes the exported Express app directly, so it does not enter
// startServer(). Connect lazily before handling API requests in that runtime.
let databaseConnectionPromise;
if (process.env.VERCEL) {
  app.use(async (req, res, next) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        databaseConnectionPromise ??= connectDB().catch((error) => {
          databaseConnectionPromise = undefined;
          throw error;
        });
        await databaseConnectionPromise;
      }
      next();
    } catch (error) {
      next(error);
    }
  });
}

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/tables', tableRoutes);

// Error-handling middleware (must be last)
app.use((error, req, res, next) => {
  const isUploadError = error.name === 'MulterError' || error.message?.includes('Only images');
  const statusCode = error.statusCode || (error.type === 'entity.too.large' ? 413 : isUploadError ? 400 : 500);
  const isExpectedClientError = statusCode >= 400 && statusCode < 500;
  const message = isExpectedClientError
    ? error.message || 'Request failed'
    : process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : error.message || 'Internal server error';

  logger.error('request_failed', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    statusCode,
    message: error.message,
    error: logger.serializeError(error),
  });

  res.status(statusCode).json({
    error: {
      message,
      statusCode,
      requestId: req.requestId,
    },
  });
});

const PORT = process.env.PORT || 8080;
let httpServer;
let schedulerTask;

const startServer = async () => {
  try {
    await connectDB();
    httpServer = app.listen(PORT, () => {
      logger.info('server_started', { port: PORT });
      schedulerTask = startBookingScheduler?.();
    });
    return httpServer;
  } catch (err) {
    logger.error('server_start_failed', { error: logger.serializeError(err) });
    throw err;
  }
};

const shutdown = async (signal) => {
  logger.info('server_shutdown_started', { signal });
  schedulerTask?.stop?.();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
  logger.info('server_shutdown_completed');
};

if (require.main === module) {
  startServer().catch(() => process.exit(1));
  process.once('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)));
  process.once('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));
}

// Export the Express application itself for Vercel's Node runtime. Attach the
// named properties to preserve the existing CommonJS imports used by tests.
app.startServer = startServer;
app.shutdown = shutdown;
module.exports = app;



process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason: logger.serializeError(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', { error: logger.serializeError(err) });
  process.exit(1);
});
