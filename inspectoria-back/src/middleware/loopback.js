const { esLoopback } = require('../services/red');

function requerirLoopback(req, res, next) {
  if (!esLoopback(req.socket.remoteAddress)) {
    return res.status(403).json({
      ok: false,
      codigo: 'SOLO_PC',
      mensaje: 'Esta acción solo puede realizarse desde el PC.',
    });
  }
  next();
}

module.exports = { requerirLoopback };
