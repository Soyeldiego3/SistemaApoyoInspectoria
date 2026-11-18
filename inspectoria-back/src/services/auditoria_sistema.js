const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db/ruta');

const FILE_PATH = path.join(DATA_DIR, 'sistema.log');

function registrar(evento, usuario, detalle = {}) {
  const registro = {
    fecha: new Date().toISOString(),
    evento,
    usuario: usuario || null,
    detalle,
  };
  fs.appendFileSync(FILE_PATH, `${JSON.stringify(registro)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(FILE_PATH, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

module.exports = { registrar, FILE_PATH };
