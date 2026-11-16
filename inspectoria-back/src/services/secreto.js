const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db/ruta');

const SECRET_PATH = path.join(DATA_DIR, 'secret.key');

function leerOCrearSecreto() {
  if (fs.existsSync(SECRET_PATH)) {
    const valor = fs.readFileSync(SECRET_PATH, 'utf8').trim();
    if (valor) return valor;
  }

  const generado = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(SECRET_PATH, generado, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const valor = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  if (!valor) throw new Error(`No se pudo inicializar ${SECRET_PATH}`);
  try {
    fs.chmodSync(SECRET_PATH, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
  return valor;
}

const secretoPersistente = leerOCrearSecreto();

function obtenerSecreto() {
  return process.env.AUTH_SECRET || secretoPersistente;
}

module.exports = { obtenerSecreto, SECRET_PATH };
