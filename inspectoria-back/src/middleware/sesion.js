const { leerToken } = require('../services/auth');
const usuarios = require('../db/usuarios');

// Deja pasar solo las peticiones con "Authorization: Bearer <token>" válido y vigente.
function requerirSesion(req, res, next) {
  const [tipo, token] = (req.get('authorization') || '').split(' ');
  const sesion = tipo === 'Bearer' ? leerToken(token) : null;
  // Además de la firma del token, la cuenta debe seguir existiendo y activa (así se puede dar de baja a alguien).
  const u = sesion && usuarios.buscar(sesion.usuario);
  if (!u || !u.activo) return res.status(401).json({ error: 'Sesión no iniciada o vencida.' });
  req.usuario = u.nombre;
  next();
}

module.exports = { requerirSesion };
