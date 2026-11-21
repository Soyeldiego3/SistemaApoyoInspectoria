// Acceso desde otra red (experimental): Cloudflare Quick Tunnel.
// cloudflared abre una conexión de SALIDA hacia Cloudflare y entrega una URL https temporal
// (https://xxxx.trycloudflare.com). Al desactivarlo se cierra el proceso y la URL deja de existir.
//
// El túnel NO apunta al servidor principal: apunta a un listener propio (127.0.0.1:3006) que marca
// cada petición con req.viaTunel = true. Sin esa marca, todo lo que entra por cloudflared llegaría
// desde 127.0.0.1 y se trataría como si fuera el propio PC.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PUERTO_TUNEL = Number(process.env.TUNEL_PORT || 3006);
const TIMEOUT_MS = 30 * 1000;
const URL_TUNEL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

let estado = { estado: 'apagado', url: null, error: null };
let proceso = null;
let servidor = null;
let arranque = null;
let generacion = 0; // invalida un arranque en curso si se desactiva antes de terminar

const obtenerEstado = () => ({ ...estado, puerto: PUERTO_TUNEL });
// Empaquetado: Electron pasa CLOUDFLARED_PATH. En desarrollo: el binario de desktop/bin
// (npm run prepare:cloudflared en desktop) o, si no está, el cloudflared del PATH.
function rutaBinario() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  const nombre = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const desarrollo = path.join(__dirname, '..', '..', '..', 'desktop', 'bin', nombre);
  return fs.existsSync(desarrollo) ? desarrollo : 'cloudflared';
}

function avisarPid(pid) {
  // El proceso de Electron guarda el PID para cerrarlo al salir (en Windows el hijo no muere con el padre)
  try { process.send?.({ type: 'tunel:pid', pid }); } catch { /* sin canal IPC (modo desarrollo) */ }
}

function abrirListener() {
  const app = require('../app');
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      req.viaTunel = true;
      app(req, res);
    });
    srv.once('error', reject);
    srv.listen(PUERTO_TUNEL, '127.0.0.1', () => {
      srv.off('error', reject);
      resolve(srv);
    });
  });
}

function cerrarListener() {
  if (!servidor) return;
  const srv = servidor;
  servidor = null;
  srv.close();
  srv.closeAllConnections?.();
}

// Última línea de error de cloudflared, para mostrar algo útil si falla al arrancar
function ultimoError(salida) {
  const lineas = salida.split(/\r?\n/).filter((l) => /\bERR\b|error/i.test(l));
  return (lineas.at(-1) || '').replace(/^\S+\s+ERR\s+/, '').trim().slice(0, 300);
}

function lanzarCloudflared(gen) {
  return new Promise((resolve, reject) => {
    const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PUERTO_TUNEL}`];
    const hijo = spawn(rutaBinario(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    proceso = hijo;
    let resuelto = false;
    let salida = '';

    const terminar = (error, url) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(url);
    };
    const timer = setTimeout(() => {
      terminar(new Error('cloudflared no entregó una URL a tiempo. Revisa la conexión a internet del PC.'));
    }, TIMEOUT_MS);

    // Se sigue leyendo la salida después de obtener la URL: si nadie la consume, el proceso se bloquea
    const leer = (chunk) => {
      if (resuelto) return;
      salida = (salida + chunk.toString()).slice(-8000);
      const coincidencia = URL_TUNEL.exec(salida);
      if (coincidencia) terminar(null, coincidencia[0]);
    };
    hijo.stdout.on('data', leer);
    hijo.stderr.on('data', leer);

    hijo.on('error', (error) => {
      terminar(error.code === 'ENOENT'
        ? new Error('No se encontró cloudflared. En desarrollo ejecuta "npm run prepare:cloudflared" en la carpeta desktop.')
        : error);
    });

    hijo.on('exit', (codigo) => {
      if (proceso === hijo) proceso = null;
      avisarPid(null);
      if (!resuelto) {
        const detalle = ultimoError(salida);
        return terminar(new Error(`cloudflared se cerró (código ${codigo}).${detalle ? ` ${detalle}` : ''}`));
      }
      // Se cayó estando activo (sin que nadie lo apagara)
      if (gen === generacion && estado.estado === 'activo') {
        cerrarListener();
        estado = { estado: 'error', url: null, error: 'El túnel se cerró inesperadamente.' };
      }
    });

    if (hijo.pid) avisarPid(hijo.pid);
  });
}

function iniciarTunel() {
  if (estado.estado === 'activo') return Promise.resolve(obtenerEstado());
  if (arranque) return arranque;

  const gen = ++generacion;
  estado = { estado: 'iniciando', url: null, error: null };
  const actual = (async () => {
    try {
      if (!servidor) servidor = await abrirListener();
      if (gen !== generacion) {
        // Se desactivó mientras abría el listener
        if (estado.estado === 'apagado') cerrarListener();
        return obtenerEstado();
      }
      const url = await lanzarCloudflared(gen);
      if (gen === generacion) estado = { estado: 'activo', url, error: null };
    } catch (error) {
      if (gen === generacion) {
        detenerProceso();
        cerrarListener();
        const mensaje = error.code === 'EADDRINUSE'
          ? `El puerto ${PUERTO_TUNEL} del túnel ya está en uso.`
          : error.message;
        estado = { estado: 'error', url: null, error: mensaje };
      }
    } finally {
      if (arranque === actual) arranque = null;
    }
    return obtenerEstado();
  })();
  arranque = actual;
  return actual;
}

function detenerProceso() {
  const hijo = proceso;
  proceso = null;
  if (hijo && hijo.exitCode === null && !hijo.killed) hijo.kill();
}

function detenerTunel() {
  generacion += 1;
  arranque = null;
  estado = { estado: 'apagado', url: null, error: null };
  detenerProceso();
  cerrarListener();
  return obtenerEstado();
}

const tunelActivo = () => estado.estado === 'activo';

// Último recurso si el backend termina normalmente con el túnel encendido
process.on('exit', detenerProceso);

module.exports = { iniciarTunel, detenerTunel, obtenerEstado, tunelActivo };
