
import zoneConfigModel from '../models/zoneConfigModel.js';

export const getZoneConfigs = async (req, res, next) => {
try {
  const zones = await zoneConfigModel.find();
  res.json(zones);
} catch (error) {
  next(error);
}
};

// สร้างโซนใหม่
export const createZoneConfig = async (req, res, next) => {
  try {
    const { id, name, description, allowIndividualSeatBooking, seatPrice, tablePrice } = req.body;

    // ตรวจสอบข้อมูลที่จำเป็น
    if (!id || !name || !description || seatPrice == null || tablePrice == null) {
      return res.status(400).json({ message: 'Missing required fields: id, name, description, seatPrice, or tablePrice' });
    }

    // ตรวจสอบว่า id ซ้ำหรือไม่
    const existingZone = await zoneConfigModel.findOne({ id });
    if (existingZone) {
      return res.status(409).json({ message: `Zone with ID ${id} already exists` });
    }

    // ตรวจสอบว่า seatPrice และ tablePrice เป็นตัวเลขที่ไม่ติดลบ
    if (seatPrice < 0 || tablePrice < 0) {
      return res.status(400).json({ message: 'seatPrice and tablePrice must be non-negative numbers' });
    }

    const zone = new zoneConfigModel({
      id,
      name,
      description,
      isActive: true, // ค่าเริ่มต้น
      allowIndividualSeatBooking: allowIndividualSeatBooking ?? true,
      seatPrice: Number(seatPrice),
      tablePrice: Number(tablePrice),
    });

    await zone.save();
    res.status(201).json(zone);
  } catch (error) {
    next(error);
  }
};

// อัปเดตโซน
export const updateZoneConfig = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // ตรวจสอบว่า updates มีข้อมูลที่ถูกต้อง
    if (updates.seatPrice != null && updates.seatPrice < 0) {
      return res.status(400).json({ message: 'seatPrice must be a non-negative number' });
    }
    if (updates.tablePrice != null && updates.tablePrice < 0) {
      return res.status(400).json({ message: 'tablePrice must be a non-negative number' });
    }

    const zone = await zoneConfigModel.findOneAndUpdate({ id }, updates, { new: true });
    if (!zone) {
      return res.status(404).json({ message: 'Zone not found' });
    }
    res.json(zone);
  } catch (error) {
    next(error);
  }
};

// ลบโซน
export const deleteZoneConfig = async (req, res, next) => {
  try {
    const { id } = req.params;
    const zone = await zoneConfigModel.findOneAndDelete({ id });
    if (!zone) {
      return res.status(404).json({ message: 'Zone not found' });
    }
    res.json({ message: 'Zone deleted successfully' });
  } catch (error) {
    next(error);
  }
};