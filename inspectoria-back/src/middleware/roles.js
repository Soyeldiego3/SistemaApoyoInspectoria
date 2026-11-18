function requerirRol(rol) {
  return (req, res, next) => {
    if (req.usuario?.rol !== rol) {
      return res.status(403).json({
        ok: false,
        codigo: 'SIN_PERMISO',
        mensaje: 'No tienes permiso para esta acción.',
      });
    }
    next();
  };
}

module.exports = { requerirRol };
