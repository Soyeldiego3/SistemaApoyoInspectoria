const { esLoopback } = require('../services/red');

function requerirLoopback(req, res, next) {
  // Lo que entra por el túnel también llega desde 127.0.0.1, pero viene de fuera del PC
  if (req.viaTunel || !esLoopback(req.socket.remoteAddress)) {
    return res.status(403).json({
      ok: false,
      codigo: 'SOLO_PC',
      mensaje: 'Esta acción solo puede realizarse desde el PC.',
    });
  }
  next();
}

module.exports = { requerirLoopback };
