const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'inspectoria.db');
const SEED_PATH = path.join(__dirname, '..', '..', 'data', 'inspectoria.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DB_PATH) && fs.existsSync(SEED_PATH)) {
  fs.copyFileSync(SEED_PATH, DB_PATH);
}

module.exports = { DATA_DIR, DB_PATH };
