const express = require('express');
const auth = require('../services/auth');
const usuarios = require('../db/usuarios');
const { requerirSesion } = require('../middleware/sesion');

const router = express.Router();

router.post('/login', (req, res) => {
  const { usuario, password } = req.body ?? {};
  if (!usuarios.hayUsuarios()) {
    return res.status(500).json({ error: 'No hay usuarios creados. En el servidor ejecuta: npm run usuario -- crear <nombre>' });
  }
  if (typeof usuario !== 'string' || typeof password !== 'string' || !usuario.trim() || !password) {
    return res.status(400).json({ error: 'Ingresa tu usuario y tu contraseña.' });
  }
  if (auth.bloqueado(req.ip)) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' });
  }
  const u = auth.verificarCredenciales(usuario, password);
  if (!u) {
    auth.registrarFallo(req.ip);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  auth.limpiarFallos(req.ip);
  res.json({ token: auth.crearToken(u.nombre), usuario: u.nombre, expiraEnMs: auth.DURACION_MS });
});

// Sirve para que el front compruebe si su sesión sigue vigente.
router.get('/yo', requerirSesion, (req, res) => res.json({ usuario: req.usuario }));

module.exports = router;
