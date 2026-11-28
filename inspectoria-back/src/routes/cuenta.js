const express = require('express');
const usuarios = require('../db/usuarios');
const auth = require('../services/auth');
const auditoria = require('../services/auditoria_sistema');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ usuario: req.usuario.nombre, rol: req.usuario.rol, activo: req.usuario.activo });
});

router.put('/password', (req, res) => {
  const { actual, nueva } = req.body ?? {};
  if (typeof actual !== 'string' || typeof nueva !== 'string') {
    return res.status(400).json({ ok: false, codigo: 'CLAVE_INVALIDA', mensaje: 'Debes indicar la contraseña actual y la nueva.' });
  }
  if (nueva.length < 8 || nueva.length > 128) {
    return res.status(400).json({ ok: false, codigo: 'CLAVE_INVALIDA', mensaje: 'La contraseña nueva debe tener entre 8 y 128 caracteres.' });
  }
  if (auth.bloqueado(req.ip)) {
    return res.status(429).json({ ok: false, codigo: 'BLOQUEADO', mensaje: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' });
  }
  const usuario = usuarios.buscar(req.usuario.nombre);
  if (!usuario || !auth.passwordValida(actual, usuario.password_hash)) {
    auth.registrarFallo(req.ip);
    return res.status(403).json({ ok: false, codigo: 'CLAVE_ACTUAL_INCORRECTA', mensaje: 'La contraseña actual es incorrecta.' });
  }
  auth.limpiarFallos(req.ip);
  usuarios.cambiarClave(usuario.nombre, auth.hashearPassword(nueva));
  auditoria.registrar('cuenta.clave_cambiada', usuario.nombre, {});
  res.json({ ok: true, mensaje: 'Contraseña actualizada.' });
});

module.exports = router;
