const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db/ruta');

const FILE_PATH = path.join(DATA_DIR, 'app.config.json');
const DEFAULTS = { redHabilitada: false, limpiarAlCerrar: true };

function leer() {
  if (!fs.existsSync(FILE_PATH)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE_PATH, 'utf8')) };
  } catch (error) {
    error.code = 'CONFIGURACION_INVALIDA';
    throw error;
  }
}

function guardar(cambios) {
  const actual = leer();
  fs.writeFileSync(FILE_PATH, JSON.stringify({ ...actual, ...cambios }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(FILE_PATH, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
  return leer();
}

module.exports = { leer, guardar, FILE_PATH };
