const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const connectDB = require('./src/config/db');
const path =  require('path');

const bookingRoutes = require('./src/routes/bookingRoutes');
const tableRoutes = require('./src/routes/tableRoutes');
const zoneRoutes = require('./src/routes/zoneRoutes');

dotenv.config();
connectDB();
const app = express();

app.use(cors());
// app.use(
//   cors({
//     origin: ['http://localhost:3000'],
//     methods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS'],
//     credentials: true,
//   })
// );
app.use(express.json());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/bookings', bookingRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/tables', tableRoutes);

app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});