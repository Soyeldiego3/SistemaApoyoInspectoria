const path = require('path');
const Database = require('better-sqlite3');

const rutaBaseDatos = path.join(__dirname, '..', '..', 'data', 'asistencia.db');
const db = new Database(rutaBaseDatos, { readonly: true });

module.exports = db;
