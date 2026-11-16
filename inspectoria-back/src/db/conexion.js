const Database = require('better-sqlite3');
const { DB_PATH } = require('./ruta');

const db = new Database(DB_PATH, { readonly: true });

module.exports = db;
