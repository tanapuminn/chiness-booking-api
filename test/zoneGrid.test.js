const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGridUpdate, DEFAULT_GRID_SIZE } = require('../src/utils/zoneGrid');
const zoneConfigModel = require('../src/models/zoneConfigModel');

test('zone grid defaults to 10 x 10 for zones saved before grid size existed', () => {
  const zone = new zoneConfigModel({ id: 'A', name: 'A', description: 'A', seatPrice: 1, tablePrice: 9 });
  assert.equal(zone.gridRows, DEFAULT_GRID_SIZE);
  assert.equal(zone.gridCols, DEFAULT_GRID_SIZE);
});

test('grid size must be an integer from 5 to 20', () => {
  assert.equal(validateGridUpdate({ gridRows: 12, gridCols: 8 }), null);
  assert.match(validateGridUpdate({ gridRows: 4 }), /gridRows/);
  assert.match(validateGridUpdate({ gridCols: 21 }), /gridCols/);
  assert.match(validateGridUpdate({ gridCols: 7.5 }), /gridCols/);
});

test('grid cannot shrink past existing tables', () => {
  const tables = [{ x: 7, y: 2 }, { x: 1, y: 9 }];
  assert.equal(validateGridUpdate({ gridRows: 10, gridCols: 8 }, tables), null);
  assert.match(validateGridUpdate({ gridCols: 7 }, tables), /1 table/);
  assert.match(validateGridUpdate({ gridRows: 9, gridCols: 7 }, tables), /2 table/);
});
