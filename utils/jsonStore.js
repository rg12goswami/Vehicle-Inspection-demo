const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');
const DEFAULT_DATA = { vehicles: [], inspections: [] };

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

function readData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  if (!raw.trim()) return { vehicles: [], inspections: [] };
  const data = JSON.parse(raw);
  if (!Array.isArray(data.inspections)) data.inspections = [];
  if (!Array.isArray(data.vehicles)) data.vehicles = [];
  return data;
}

function writeData(data) {
  ensureDataFile();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}

module.exports = { readData, writeData, DATA_FILE };
