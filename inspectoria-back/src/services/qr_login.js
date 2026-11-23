// Códigos de inicio de sesión para el QR de "Conectar desde el teléfono".
// No se pone el token de sesión (8 h) en el QR: se pone un código aleatorio de un solo uso
// que dura poco y que el teléfono canjea por una sesión normal. Solo vive en memoria.
const crypto = require('crypto');
const { huella } = require('./auth');

// El PC muestra cada código RENOVAR_QR_MS y lo cambia antes de que venza, así quien lo
// escanea justo antes del cambio todavía tiene al menos 15 s para abrirlo.
const DURACION_QR_MS = 60 * 1000;
const RENOVAR_QR_MS = 45 * 1000;
const MAX_POR_USUARIO = 2; // el que se muestra y el anterior (todavía vigente)
const FORMATO = /^[A-Za-z0-9_-]{43}$/; // 32 bytes en base64url

const codigos = new Map(); // codigo -> { usuarioId, huella, exp } (en orden de creación)

function limpiar(usuarioId) {
  const ahora = Date.now();
  for (const [codigo, datos] of codigos) {
    if (datos.exp <= ahora) codigos.delete(codigo);
  }
  const delUsuario = [...codigos].filter(([, datos]) => datos.usuarioId === usuarioId);
  for (const [codigo] of delUsuario.slice(0, Math.max(0, delUsuario.length - (MAX_POR_USUARIO - 1)))) {
    codigos.delete(codigo);
  }
}

// Recibe la fila del usuario (id y password_hash).
function generarCodigo(usuario) {
  limpiar(usuario.id);
  const codigo = crypto.randomBytes(32).toString('base64url');
  codigos.set(codigo, { usuarioId: usuario.id, huella: huella(usuario.password_hash), exp: Date.now() + DURACION_QR_MS });
  return { codigo, expiraEnMs: DURACION_QR_MS, renovarEnMs: RENOVAR_QR_MS };
}

// Un solo uso: el código se borra siempre, sirva o no. Devuelve { usuarioId, huella } o null.
function canjearCodigo(codigo) {
  if (typeof codigo !== 'string' || !FORMATO.test(codigo)) return null;
  const datos = codigos.get(codigo);
  codigos.delete(codigo);
  if (!datos || datos.exp <= Date.now()) return null;
  return { usuarioId: datos.usuarioId, huella: datos.huella };
}

module.exports = { generarCodigo, canjearCodigo, DURACION_QR_MS, RENOVAR_QR_MS };
