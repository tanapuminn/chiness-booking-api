const mongoose = require('mongoose')
const dns = require('node:dns');
const dotenv = require('dotenv');
const logger = require('../utils/logger');
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
        // Atlas mongodb+srv URIs require DNS SRV lookups. Some local DNS
        // resolvers work with nslookup but refuse Node's SRV requests.
        const dnsServers = (process.env.MONGODB_DNS_SERVERS || '')
            .split(',')
            .map((server) => server.trim())
            .filter(Boolean);
        if (uri.startsWith('mongodb+srv://') && dnsServers.length > 0) {
            dns.setServers(dnsServers);
            logger.info('mongodb_dns_servers_configured', { count: dnsServers.length });
        }

        const maxAttempts = Math.max(1, Number(process.env.MONGODB_CONNECT_RETRIES || 3));
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 45000 });
                lastError = null;
                break;
            } catch (error) {
                lastError = error;
                logger.warn('mongodb_connect_retry', { attempt, maxAttempts, error: logger.serializeError(error) });
                if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * (2 ** (attempt - 1)), 5000)));
            }
        }
        if (lastError) throw lastError;

        console.log('✅ MongoDB connected');

        // Drop legacy username_1 index if it still exists after schema migration
        try {
            await mongoose.connection.collection('users').dropIndex('username_1');
            console.log('🧹 Dropped legacy index: username_1');
        } catch (e) {
            // index ไม่มีแล้ว ข้ามได้เลย
        }

        // Log เหตุการณ์สำคัญไว้ตามรอยง่าย
        mongoose.connection.on('error', (err) => {
            logger.error('mongodb_connection_error', { error: logger.serializeError(err) });
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('⚠️  MongoDB disconnected');
        });

        // ปิดเชื่อมต่อให้เรียบร้อยเมื่อ process ถูก kill
        return mongoose.connection; // เผื่ออยากเช็ค readyState ที่ฝั่ง caller
    } catch (error) {
        // โยน error ออกไป ให้ app.js ตัดสินใจไม่ start server
        console.error('❌ MongoDB connection failed:', error?.message || error);
        throw error;
    }
}

module.exports = connectDB;
