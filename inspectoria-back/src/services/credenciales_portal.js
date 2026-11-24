const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db/ruta');
const { obtenerSecreto } = require('./secreto');
const { cifrar, descifrar } = require('./cifrado');

const FILE_PATH = path.join(DATA_DIR, 'portal.cred.json');
const SALT_LABEL = 'apoyo-inspectoria-portal';
let credencialesMemoria = null;

function escribir({ usuario, pass, urlPortal, invalidas = false, fallosConsecutivos = 0 }) {
  const contenido = JSON.stringify({
    usuario,
    pass,
    urlPortal: urlPortal || null,
    invalidas: Boolean(invalidas),
    fallosConsecutivos: Number(fallosConsecutivos) || 0,
  });
  const registro = { version: 1, ...cifrar(contenido, obtenerSecreto(), SALT_LABEL) };

  fs.writeFileSync(FILE_PATH, JSON.stringify(registro), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(FILE_PATH, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

function guardar(credenciales) {
  credencialesMemoria = null;
  escribir({ ...credenciales, invalidas: false, fallosConsecutivos: 0 });
}

function leer() {
  if (!fs.existsSync(FILE_PATH)) return null;

  try {
    const registro = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    if (registro.version !== 1) throw new Error('Versión de credenciales no soportada');
    const contenido = descifrar(registro, obtenerSecreto(), SALT_LABEL).toString('utf8');
    const credenciales = JSON.parse(contenido);
    if (typeof credenciales.usuario !== 'string' || typeof credenciales.pass !== 'string') {
      throw new Error('Credenciales incompletas');
    }
    return {
      ...credenciales,
      invalidas: Boolean(credenciales.invalidas),
      fallosConsecutivos: Number(credenciales.fallosConsecutivos) || 0,
    };
  } catch (error) {
    error.code = 'CREDENCIALES_INVALIDAS';
    throw error;
  }
}

function guardarEnMemoria(credenciales) {
  credencialesMemoria = {
    usuario: credenciales.usuario,
    pass: credenciales.pass,
    urlPortal: credenciales.urlPortal || null,
    invalidas: false,
    fallosConsecutivos: 0,
  };
}

function leerEnMemoria() {
  return credencialesMemoria ? { ...credencialesMemoria } : null;
}

function leerDisponibles() {
  return leerEnMemoria() || leer();
}

function coincide(a, b) {
  return Boolean(a && b && a.usuario === b.usuario
    && a.pass === b.pass
    && (a.urlPortal || null) === (b.urlPortal || null));
}

function registrarFallo(credenciales) {
  const memoria = leerEnMemoria();
  if (coincide(memoria, credenciales)) {
    memoria.fallosConsecutivos += 1;
    memoria.invalidas = memoria.fallosConsecutivos >= 2;
    credencialesMemoria = memoria;
  }

  const guardadas = leer();
  if (coincide(guardadas, credenciales)) {
    const fallosConsecutivos = guardadas.fallosConsecutivos + 1;
    escribir({
      ...guardadas,
      fallosConsecutivos,
      invalidas: fallosConsecutivos >= 2,
    });
  }
}

function registrarExito(credenciales) {
  const memoria = leerEnMemoria();
  if (coincide(memoria, credenciales)) {
    credencialesMemoria = { ...memoria, invalidas: false, fallosConsecutivos: 0 };
  }
  const guardadas = leer();
  if (coincide(guardadas, credenciales) && (guardadas.invalidas || guardadas.fallosConsecutivos)) {
    escribir({ ...guardadas, invalidas: false, fallosConsecutivos: 0 });
  }
}

function borrar() {
  if (fs.existsSync(FILE_PATH)) fs.unlinkSync(FILE_PATH);
  credencialesMemoria = null;
}

function existe() {
  return fs.existsSync(FILE_PATH);
}

module.exports = {
  guardar,
  guardarEnMemoria,
  leer,
  leerEnMemoria,
  leerDisponibles,
  registrarFallo,
  registrarExito,
  borrar,
  existe,
  FILE_PATH,
};
