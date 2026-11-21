const os = require('os');
const { leer, guardar } = require('./configuracion');

const PUERTO = Number(process.env.PORT || 3005);
const VIRTUAL_ADAPTER = /virtualbox|vmware|hyper-v|wsl|docker|vethernet|default switch|loopback|tunnel/i;

function normalizarIp(ip) {
  const valor = String(ip || '').replace(/^::ffff:/i, '');
  return valor === '::1' ? '127.0.0.1' : valor;
}

function esLoopback(ip) {
  const valor = normalizarIp(ip);
  return valor === '127.0.0.1' || valor === '0.0.0.0';
}

function esPrivada(ip) {
  const valor = normalizarIp(ip);
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(valor)) return false;
  const octetos = valor.split('.').map(Number);
  if (octetos.some((octeto) => octeto > 255)) return false;
  return octetos[0] === 10
    || (octetos[0] === 172 && octetos[1] >= 16 && octetos[1] <= 31)
    || (octetos[0] === 192 && octetos[1] === 168);
}

function esRedPermitida(ip) {
  return esLoopback(ip) || esPrivada(ip);
}

// IP real del cliente. Por el túnel todo llega desde 127.0.0.1, así que se usa la que informa Cloudflare
// (solo se confía en ese header en el listener del túnel, que no es accesible desde la red).
function ipCliente(req) {
  if (req.viaTunel) {
    const ip = String(req.headers['cf-connecting-ip'] || '').trim();
    if (ip) return ip;
  }
  return normalizarIp(req.socket.remoteAddress);
}

function origenPermitido(origen) {
  if (!origen || origen === 'null') return true;
  try {
    const url = new URL(origen);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (esLoopback(url.hostname) || esPrivada(url.hostname));
  } catch {
    return false;
  }
}

function interfacesPrivadas() {
  const candidatas = [];
  for (const [nombre, interfaces] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_ADAPTER.test(nombre)) continue;
    for (const interfaz of interfaces || []) {
      if (interfaz.family !== 'IPv4' || interfaz.internal || !esPrivada(interfaz.address)) continue;
      candidatas.push({ nombre, address: interfaz.address });
    }
  }
  candidatas.sort((a, b) => {
    const prioridad = (nombre) => /wi-?fi|ethernet/i.test(nombre) ? 0 : 1;
    return prioridad(a.nombre) - prioridad(b.nombre) || a.nombre.localeCompare(b.nombre);
  });
  return candidatas;
}

function obtenerInfo() {
  const configuracion = leer();
  const interfaces = interfacesPrivadas();
  const urls = interfaces.map(({ address }) => `http://${address}:${PUERTO}`);
  return {
    habilitada: Boolean(configuracion.redHabilitada),
    puerto: PUERTO,
    urls,
    principal: urls[0] || null,
    interfaces,
  };
}

function redHabilitada() {
  return Boolean(leer().redHabilitada);
}

function cambiarRed(habilitada) {
  guardar({ redHabilitada: Boolean(habilitada) });
  return obtenerInfo();
}

module.exports = {
  normalizarIp,
  esLoopback,
  esPrivada,
  esRedPermitida,
  ipCliente,
  origenPermitido,
  obtenerInfo,
  redHabilitada,
  cambiarRed,
};
