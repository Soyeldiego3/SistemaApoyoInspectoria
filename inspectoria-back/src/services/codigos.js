// Códigos de acceso de un solo uso para iniciar sesión en el teléfono escaneando el QR del PC.
// Viven solo en memoria: duran 60 s, se borran al usarse y se pierden al cerrar la app.
const crypto = require('crypto');

const DURACION_MS = 60 * 1000;
const MAX_CODIGOS = 50;
const codigos = new Map(); // codigo -> { usuarioId, exp }

function purgar() {
  const ahora = Date.now();
  for (const [codigo, datos] of codigos) {
    if (datos.exp <= ahora) codigos.delete(codigo);
  }
}

function crearCodigo(usuarioId) {
  purgar();
  // Evita que la tabla crezca sin límite si alguien pide códigos en bucle desde el PC
  while (codigos.size >= MAX_CODIGOS) codigos.delete(codigos.keys().next().value);
  const codigo = crypto.randomBytes(24).toString('base64url');
  codigos.set(codigo, { usuarioId, exp: Date.now() + DURACION_MS });
  return { codigo, expiraEnMs: DURACION_MS };
}

// Devuelve el id del usuario si el código existe y no venció; en cualquier caso lo invalida.
function canjearCodigo(codigo) {
  if (typeof codigo !== 'string' || !codigo) return null;
  const datos = codigos.get(codigo);
  codigos.delete(codigo);
  return datos && datos.exp > Date.now() ? datos.usuarioId : null;
}

module.exports = { crearCodigo, canjearCodigo, DURACION_MS };
