const express = require('express');
const rateLimit = require('express-rate-limit').rateLimit;
const usuarios = require('../db/usuarios');
const auth = require('../services/auth');
const auditoria = require('../services/auditoria_sistema');

const router = express.Router();
const NOMBRE_OK = /^[a-z0-9._-]{3,30}$/i;

const setupLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'legacy',
  legacyHeaders: false,
});

router.use(setupLimit);

router.get('/estado', (req, res) => {
  if (usuarios.hayAdmins()) {
    return res.status(403).json({
      ok: false,
      codigo: 'SETUP_FINALIZADO',
      mensaje: 'La configuración inicial ya fue completada.',
    });
  }
  res.json({ requiereAdmin: !usuarios.hayAdmins() });
});

router.post('/admin', (req, res) => {
  if (usuarios.hayAdmins()) {
    return res.status(403).json({
      ok: false,
      codigo: 'SETUP_FINALIZADO',
      mensaje: 'La configuración inicial ya fue completada.',
    });
  }
  const { usuario, password, confirmar } = req.body ?? {};
  if (typeof usuario !== 'string' || !NOMBRE_OK.test(usuario.trim())) {
    return res.status(400).json({ ok: false, codigo: 'USUARIO_INVALIDO', mensaje: 'El usuario administrador no es válido.' });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ ok: false, codigo: 'CLAVE_INVALIDA', mensaje: 'La contraseña debe tener entre 8 y 128 caracteres.' });
  }
  if (password !== confirmar) {
    return res.status(400).json({ ok: false, codigo: 'CLAVE_NO_COINCIDE', mensaje: 'Las contraseñas no coinciden.' });
  }
  if (usuarios.buscar(usuario.trim())) {
    return res.status(409).json({ ok: false, codigo: 'USUARIO_EXISTE', mensaje: 'Ese usuario ya existe.' });
  }
  const nombre = usuario.trim();
  usuarios.crear(nombre, auth.hashearPassword(password), 'admin');
  auditoria.registrar('administrador.inicial_creado', nombre, {});
  res.status(201).json({ ok: true, usuario: nombre, rol: 'admin' });
});

module.exports = router;
