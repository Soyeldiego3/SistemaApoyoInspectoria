const { esRedPermitida } = require('../services/red');

function requerirRedLocal(req, res, next) {
  // El listener del túnel solo existe mientras el acceso desde otra red está activado
  if (req.viaTunel) return next();
  const ip = req.socket.remoteAddress;
  if (!esRedPermitida(ip)) return res.status(403).json({ error: 'Acceso permitido solo desde la red local.' });
  next();
}

module.exports = { requerirRedLocal };
