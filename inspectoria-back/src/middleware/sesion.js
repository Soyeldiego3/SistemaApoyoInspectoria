const { leerToken } = require('../services/auth');

// Deja pasar solo las peticiones con "Authorization: Bearer <token>" válido y vigente.
function requerirSesion(req, res, next) {
  const [tipo, token] = (req.get('authorization') || '').split(' ');
  const sesion = tipo === 'Bearer' ? leerToken(token) : null;
  if (!sesion) return res.status(401).json({ error: 'Sesión no iniciada o vencida.' });
  req.usuario = sesion.usuario;
  next();
}

module.exports = { requerirSesion };
