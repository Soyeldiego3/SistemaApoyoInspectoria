const express = require('express');
const auth = require('../services/auth');
const { requerirSesion } = require('../middleware/sesion');

const router = express.Router();

router.post('/login', (req, res) => {
  const { usuario, password } = req.body ?? {};
  if (!process.env.AUTH_USER || !process.env.AUTH_PASSWORD_HASH) {
    return res.status(500).json({ error: 'El servidor no tiene un usuario configurado (revisa AUTH_USER y AUTH_PASSWORD_HASH en .env).' });
  }
  if (typeof usuario !== 'string' || typeof password !== 'string' || !usuario.trim() || !password) {
    return res.status(400).json({ error: 'Ingresa tu usuario y tu contraseña.' });
  }
  if (auth.bloqueado(req.ip)) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' });
  }
  if (!auth.credencialesValidas(usuario, password)) {
    auth.registrarFallo(req.ip);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  auth.limpiarFallos(req.ip);
  const nombre = usuario.trim().toLowerCase();
  res.json({ token: auth.crearToken(nombre), usuario: nombre, expiraEnMs: auth.DURACION_MS });
});
router.get('/yo', requerirSesion, (req, res) => res.json({ usuario: req.usuario }));

module.exports = router;