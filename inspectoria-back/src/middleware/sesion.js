const { leerToken, huella } = require('../services/auth');
const usuarios = require('../db/usuarios');

// Deja pasar solo las peticiones con "Authorization: Bearer <token>" válido y vigente.
function requerirSesion(req, res, next) {
  const [tipo, token] = (req.get('authorization') || '').split(' ');
  const sesion = tipo === 'Bearer' ? leerToken(token) : null;
  // Además de la firma, la cuenta debe seguir existiendo, estar activa y tener la misma contraseña que cuando se creó el token.
  const u = sesion && usuarios.buscarPorId(sesion.id);
  if (!u || !u.activo || huella(u.password_hash) !== sesion.huella) return res.status(401).json({ error: 'Sesión no iniciada o vencida.' });
  req.usuario = { id: u.id, nombre: u.nombre, rol: u.rol, activo: !!u.activo };
  next();
}

module.exports = { requerirSesion };
