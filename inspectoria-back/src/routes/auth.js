const express = require('express');
const auth = require('../services/auth');
const codigos = require('../services/codigos');
const usuarios = require('../db/usuarios');
const auditoria = require('../services/auditoria_sistema');
const { ipCliente } = require('../services/red');
const { requerirSesion } = require('../middleware/sesion');
const { requerirLoopback } = require('../middleware/loopback');

const router = express.Router();

const respuestaSesion = (u) => ({
  token: auth.crearToken(u),
  usuario: u.nombre,
  rol: u.rol,
  expiraEnMs: auth.DURACION_MS,
});

router.post('/login', (req, res) => {
  // Por el túnel la URL es pública: solo se entra con el código del QR, nunca con contraseña
  if (req.viaTunel) {
    return res.status(403).json({ error: 'Para entrar desde otra red, escanea el código QR que aparece en Ajustes del PC.' });
  }
  const { usuario, password } = req.body ?? {};
  if (!usuarios.hayUsuarios()) {
    return res.status(500).json({ error: 'No hay usuarios creados. En el servidor ejecuta: npm run usuario -- crear <nombre>' });
  }
  if (typeof usuario !== 'string' || typeof password !== 'string' || !usuario.trim() || !password) {
    return res.status(400).json({ error: 'Ingresa tu usuario y tu contraseña.' });
  }
  const ip = ipCliente(req);
  if (auth.bloqueado(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' });
  }
  const u = auth.verificarCredenciales(usuario, password);
  if (!u) {
    auth.registrarFallo(ip);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  auth.limpiarFallos(ip);
  res.json(respuestaSesion(usuarios.buscar(u.nombre)));
});

// El PC genera un código de un solo uso (60 s) para el QR; el teléfono lo canjea por una sesión.
router.post('/codigo', requerirLoopback, requerirSesion, (req, res) => {
  res.json(codigos.crearCodigo(req.usuario.id));
});

router.post('/canjear', (req, res) => {
  const id = codigos.canjearCodigo(req.body?.codigo);
  const u = id && usuarios.buscarPorId(id);
  if (!u || !u.activo) {
    return res.status(401).json({
      codigo: 'CODIGO_INVALIDO',
      error: 'El código venció o ya fue usado. Genera un QR nuevo en el PC.',
    });
  }
  try {
    auditoria.registrar('auth.login_codigo', u.nombre, { viaTunel: Boolean(req.viaTunel) });
  } catch (error) {
    console.error('No se pudo registrar el inicio de sesión por código:', error.message);
  }
  res.json(respuestaSesion(u));
});

// Sirve para que el front compruebe si su sesión sigue vigente.
router.get('/yo', requerirSesion, (req, res) => res.json({
  usuario: req.usuario.nombre,
  rol: req.usuario.rol,
}));

module.exports = router;
