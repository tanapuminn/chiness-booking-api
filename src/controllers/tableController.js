import tablePositionModel from '../models/tablePositionModel.js';

// ดึงโต๊ะทั้งหมด
export const getTables = async (req, res, next) => {
  try {
    const tables = await tablePositionModel.find().sort({ zone: 1, id: 1 });
    res.json(tables);
  } catch (error) {
    next(error);
  }
};

// สร้างโต๊ะใหม่
export const createTable = async (req, res, next) => {
  try {
    const { id, zone, name, x, y } = req.body;

    // Validate required fields
    if (!id || !zone || !name) {
      return res.status(400).json({ message: 'Missing required fields: id, zone, or name' });
    }

    // Check for duplicate id in the same zone (enforced by composite index { id: 1, zone: 1 })
    const existingTable = await tablePositionModel.findOne({ id, zone });
    if (existingTable) {
      return res.status(409).json({ message: `Table with id ${id} already exists in zone ${zone}` });
    }

    // Create new table document
    const table = new tablePositionModel({
      id,
      zone,
      name,
      x: x || 0,
      y: y || 0,
      isActive: true,
      seats: Array.from({ length: 9 }, (_, i) => ({
        seatNumber: i + 1,
        zone,
        isBooked: false,
      })),
    });

    // Save to database
    await table.save();
    res.status(201).json(table);
  } catch (error) {
    next(error);
  }
};

// ดึงโต๊ะทั้งหมดหรือตามโซน
export const getTablePositions = async (req, res, next) => {
  try {
    const { zone } = req.query;
    const query = zone ? { zone } : {};
    const tables = await tablePositionModel.find(query).sort({ zone: 1, id: 1 });
    res.json(tables);
  } catch (error) {
    next(error);
  }
};

export const updateTablePosition = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { x, y } = req.body;
    const table = await tablePositionModel.findOneAndUpdate(
      { id },
      { x, y },
      { new: true }
    );
    if (!table) {
      return res.status(404).json({ message: 'Table not found' });
    }
    res.json(table);
  } catch (error) {
    next(error);
  }
};

export const deleteTable = async (req, res, next) => {
  try {
    const { id } = req.params;
    const table = await tablePositionModel.findOneAndDelete({ id });
    if (!table) {
      return res.status(404).json({ message: 'Table not found' });
    }
    res.json({ message: 'Table deleted' });
  } catch (error) {
    next(error);
  }
};

export const toggleTableActive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const table = await tablePositionModel.findOne({ id });
    if (!table) {
      return res.status(404).json({ message: 'Table not found' });
    }
    table.isActive = !table.isActive;
    await table.save();
    res.json(table);
  } catch (error) {
    next(error);
  }
};