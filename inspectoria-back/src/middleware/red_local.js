const { esRedPermitida } = require('../services/red');

function requerirRedLocal(req, res, next) {
  const ip = req.socket.remoteAddress;
  if (!esRedPermitida(ip)) return res.status(403).json({ error: 'Acceso permitido solo desde la red local.' });
  next();
}

module.exports = { requerirRedLocal };
