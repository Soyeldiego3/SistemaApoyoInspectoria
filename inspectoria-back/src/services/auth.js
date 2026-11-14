// Autenticación usuario/contraseña (informe 5.2): usuarios en SQLite, contraseña con scrypt y sesión con token firmado (HMAC-SHA256).
const crypto = require('crypto');
const usuarios = require('../db/usuarios');

const DURACION_MS = 8 * 60 * 60 * 1000; // la sesión dura una jornada
const MAX_FALLOS = 5;                   // intentos fallidos seguidos por IP
const BLOQUEO_MS = 15 * 60 * 1000;

let secretoAleatorio; // si no hay AUTH_SECRET en .env, las sesiones se invalidan al reiniciar el servidor
const secreto = () => process.env.AUTH_SECRET || (secretoAleatorio ||= crypto.randomBytes(32).toString('hex'));

const b64 = (b) => Buffer.from(b).toString('base64url');
const firmar = (texto) => crypto.createHmac('sha256', secreto()).update(texto).digest('base64url');

// Formato guardado: scrypt$<sal en hex>$<hash en hex>
function hashearPassword(password) {
  const sal = crypto.randomBytes(16);
  return `scrypt$${sal.toString('hex')}$${crypto.scryptSync(password, sal, 64).toString('hex')}`;
}

function passwordValida(password, guardado) {
  const [tipo, salHex, hashHex] = String(guardado || '').split('$');
  if (tipo !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const obtenido = crypto.scryptSync(password, Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(obtenido, esperado);
}

// Hash de relleno: si el usuario no existe igual se calcula un scrypt, para que la respuesta tarde lo mismo.
const HASH_FALSO = hashearPassword('relleno');

// Devuelve el usuario si el nombre y la contraseña son correctos y la cuenta está activa; si no, null.
function verificarCredenciales(nombre, password) {
  const u = usuarios.buscar(nombre);
  const ok = passwordValida(String(password), u ? u.password_hash : HASH_FALSO);
  return u && u.activo && ok ? { id: u.id, nombre: u.nombre } : null;
}

function crearToken(usuario) {
  const cuerpo = b64(JSON.stringify({ u: usuario, exp: Date.now() + DURACION_MS }));
  return `${cuerpo}.${firmar(cuerpo)}`;
}

function leerToken(token) {
  const [cuerpo, firma] = String(token || '').split('.');
  if (!cuerpo || !firma) return null;
  const esperada = Buffer.from(firmar(cuerpo)), recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    return datos.exp > Date.now() ? { usuario: datos.u } : null;
  } catch { return null; }
}

// Bloqueo simple por IP tras varios intentos fallidos.
const fallos = new Map();
const bloqueado = (ip) => (fallos.get(ip)?.hasta ?? 0) > Date.now();
function registrarFallo(ip) {
  const f = fallos.get(ip) || { n: 0, hasta: 0 };
  f.n += 1;
  if (f.n >= MAX_FALLOS) { f.hasta = Date.now() + BLOQUEO_MS; f.n = 0; }
  fallos.set(ip, f);
}
const limpiarFallos = (ip) => fallos.delete(ip);

module.exports = { hashearPassword, verificarCredenciales, crearToken, leerToken, bloqueado, registrarFallo, limpiarFallos, DURACION_MS };
