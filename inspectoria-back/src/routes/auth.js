const express = require('express');
const auth = require('../services/auth');
const usuarios = require('../db/usuarios');
const { requerirSesion } = require('../middleware/sesion');
const { canjearCodigo } = require('../services/qr_login');
const auditoriaSistema = require('../services/auditoria_sistema');
const { esLoopback } = require('../services/red');

const router = express.Router();

router.post('/login', (req, res) => {
  // En red la conexión no va cifrada: el teléfono entra solo con el QR, así la contraseña no sale del PC
  if (!esLoopback(req.socket.remoteAddress)) {
    return res.status(403).json({ error: 'Desde el teléfono inicia sesión escaneando el código QR del PC.' });
  }
  const { usuario, password } = req.body ?? {};
  if (!usuarios.hayUsuarios()) {
    return res.status(500).json({ error: 'No hay usuarios creados.' });
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
  res.json({ token: auth.crearToken(usuarios.buscar(u.nombre)), usuario: u.nombre, rol: u.rol, expiraEnMs: auth.DURACION_MS });
});

// Canje del código del QR (teléfono): un solo uso, dura 60 s. Responde igual que /login.
router.post('/qr', (req, res) => {
  if (auth.bloqueado(req.ip)) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' });
  }
  const canje = canjearCodigo(req.body?.codigo);
  // La cuenta debe seguir activa y con la misma contraseña que cuando se generó el código
  const u = canje && usuarios.buscarPorId(canje.usuarioId);
  if (!u || !u.activo || auth.huella(u.password_hash) !== canje.huella) {
    auth.registrarFallo(req.ip);
    return res.status(401).json({ error: 'El código QR venció o ya se usó.' });
  }
  auth.limpiarFallos(req.ip);
  try {
    auditoriaSistema.registrar('auth.login_qr', u.nombre, { ip: req.ip });
  } catch (error) {
    console.error('No se pudo registrar el inicio de sesión por QR:', error.message);
  }
  res.json({ token: auth.crearToken(u), usuario: u.nombre, rol: u.rol, expiraEnMs: auth.DURACION_MS });
});

// Sirve para que el front compruebe si su sesión sigue vigente.
router.get('/yo', requerirSesion, (req, res) => res.json({
  usuario: req.usuario.nombre,
  rol: req.usuario.rol,
}));

module.exports = router;
