const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const connectDB = require('./src/config/db');
const path = require('path');
const { startBookingScheduler } = require('./src/utils/bookingScheduler.js');
const ApiError = require('./src/utils/ApiError.js');

const bookingRoutes = require('./src/routes/bookingRoutes');
const tableRoutes = require('./src/routes/tableRoutes');
const zoneRoutes = require('./src/routes/zoneRoutes');
const healthRoutes = require('./src/middleware/health-check.js');

dotenv.config();
connectDB();
const app = express();

// app.use(cors());
app.use(
  cors({
    origin: '*',
    methods: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
);
app.use(express.json());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api', healthRoutes.default);
app.use('/api/bookings', bookingRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/tables', tableRoutes);

// Error-handling middleware (must be last)
app.use((error, req, res, next) => {
  console.error('Error:', error); // Log for debugging
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    });
  }
  // Handle unexpected errors
  res.status(500).json({
    error: {
      message: error.message || 'Internal server error',
      statusCode: 500,
    },
  });
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
  // เริ่มต้น booking scheduler
  startBookingScheduler();
});