const test = require('node:test');
const assert = require('node:assert/strict');
const zoneConfigModel = require('../src/models/zoneConfigModel');

const validZone = (color) => new zoneConfigModel({
  id: 'A',
  name: 'Zone A',
  description: 'A',
  seatPrice: 100,
  tablePrice: 900,
  color,
});

test('zone model accepts a six-digit hex color', () => {
  assert.equal(validZone('#12ABEF').validateSync(), undefined);
});

test('zone model rejects an invalid color', () => {
  assert.ok(validZone('red').validateSync()?.errors.color);
});
