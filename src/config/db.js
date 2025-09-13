const mongoose = require('mongoose')
const dotenv = require('dotenv');
dotenv.config();

const connectDB = async () => {
    // try {
    //     await mongoose.connect(process.env.MONGODB_URI)
    //     console.log('Mongodb is connected...')
    // } catch (error) {
    //     console.log('Mongodb error')
    // }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        console.error('❌ MONGODB_URI is not set in environment variables');
        // โยน error เพื่อให้ app.js หยุด start server
        throw new Error('MONGODB_URI missing');
    }

    try {
        await mongoose.connect(uri, {
            // ช่วยลดโอกาส server selection ช้า/ค้าง
            serverSelectionTimeoutMS: 30000, // 30s เลือก primary/secondary ไม่ได้ภายในเวลานี้ให้ error
            socketTimeoutMS: 45000,          // ตัดการเชื่อมต่อถ้า idle นานเกินไป
            // ถ้าเป็น Atlas และอยากปิด autoIndex ในโปรดักชัน:
            // autoIndex: false,
            // maxPoolSize: 10, // ปรับตามโหลด
        });

        console.log('✅ MongoDB connected');

        // Log เหตุการณ์สำคัญไว้ตามรอยง่าย
        mongoose.connection.on('error', (err) => {
            console.error('Mongoose connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('⚠️  MongoDB disconnected');
        });

        // ปิดเชื่อมต่อให้เรียบร้อยเมื่อ process ถูก kill
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('MongoDB connection closed due to app termination');
            process.exit(0);
        });

        return mongoose.connection; // เผื่ออยากเช็ค readyState ที่ฝั่ง caller
    } catch (error) {
        // โยน error ออกไป ให้ app.js ตัดสินใจไม่ start server
        console.error('❌ MongoDB connection failed:', error?.message || error);
        throw error;
    }
}

module.exports = connectDB;