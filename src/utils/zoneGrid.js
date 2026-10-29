const DEFAULT_GRID_SIZE = 10;
const MIN_GRID_SIZE = 5;
const MAX_GRID_SIZE = 20;

const isValidGridSize = (value) => Number.isInteger(value) && value >= MIN_GRID_SIZE && value <= MAX_GRID_SIZE;

// คืนข้อความ error เมื่อขนาดผังไม่ถูกต้อง หรือมีโต๊ะที่จะหลุดออกนอกผังใหม่
const validateGridUpdate = ({ gridRows, gridCols }, tables = []) => {
  if (gridRows !== undefined && !isValidGridSize(gridRows)) {
    return `gridRows must be an integer between ${MIN_GRID_SIZE} and ${MAX_GRID_SIZE}`;
  }
  if (gridCols !== undefined && !isValidGridSize(gridCols)) {
    return `gridCols must be an integer between ${MIN_GRID_SIZE} and ${MAX_GRID_SIZE}`;
  }
  const outOfBounds = tables.filter((table) =>
    (gridCols !== undefined && table.x >= gridCols) || (gridRows !== undefined && table.y >= gridRows));
  if (outOfBounds.length > 0) {
    return `${outOfBounds.length} table(s) would be outside the new grid`;
  }
  return null;
};

module.exports = { DEFAULT_GRID_SIZE, MIN_GRID_SIZE, MAX_GRID_SIZE, isValidGridSize, validateGridUpdate };
