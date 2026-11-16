const express = require('express');
const credenciales = require('../services/credenciales_portal');
const { probarConexion } = require('../extractores/sesion_portal');
const { esLoopback } = require('../services/red');

const router = express.Router();
const CODIGOS_PORTAL = new Set([
  'LOGIN_RECHAZADO',
  'PORTAL_INACCESIBLE',
  'NAVEGADOR_NO_DISPONIBLE',
  'ESTRUCTURA_CAMBIADA',
]);

function respuestaError(res, error) {
  const codigo = CODIGOS_PORTAL.has(error.code) ? error.code : 'PORTAL_INACCESIBLE';
  const mensajes = {
    LOGIN_RECHAZADO: 'El portal rechazó las credenciales.',
    PORTAL_INACCESIBLE: 'No se pudo conectar con el portal.',
    NAVEGADOR_NO_DISPONIBLE: 'No se encontró Microsoft Edge disponible.',
    ESTRUCTURA_CAMBIADA: 'El portal cambió y no se pudo completar la operación.',
  };
  return res.status(codigo === 'LOGIN_RECHAZADO' ? 401 : 502)
    .json({ ok: false, codigo, mensaje: mensajes[codigo] });
}

router.use((req, res, next) => {
  if (!esLoopback(req.socket.remoteAddress)) {
    return res.status(403).json({
      ok: false,
      codigo: 'ACCESO_DENEGADO',
      mensaje: 'Las credenciales del portal solo se administran desde el PC.',
    });
  }
  next();
});

router.get('/credenciales', (req, res) => {
  try {
    const disco = credenciales.leer();
    const memoria = credenciales.leerEnMemoria();
    const disponibles = memoria || disco;
    res.json({
      guardadas: Boolean(disco),
      usuario: disponibles?.usuario || null,
      urlPortal: disponibles?.urlPortal || null,
      invalidas: Boolean(disponibles?.invalidas),
      enMemoria: Boolean(memoria),
    });
  } catch (error) {
    console.error('Error al leer credenciales del portal:', error.message);
    res.status(500).json({ ok: false, codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'No se pudieron leer las credenciales guardadas.' });
  }
});

router.post('/probar', async (req, res) => {
  const body = req.body ?? {};
  const proporcionadas = body.usuario !== undefined || body.pass !== undefined || body.urlPortal !== undefined;
  let datos;
  try {
    datos = proporcionadas
      ? { usuario: body.usuario, pass: body.pass, urlPortal: body.urlPortal }
      : credenciales.leerDisponibles();
  } catch (error) {
    console.error('Error al leer credenciales para prueba:', error.message);
    return res.status(500).json({
      ok: false,
      codigo: 'CREDENCIALES_INVALIDAS',
      mensaje: 'No se pudieron leer las credenciales guardadas.',
    });
  }
  if (!datos || typeof datos.usuario !== 'string' || !datos.usuario.trim()
    || typeof datos.pass !== 'string' || !datos.pass) {
    return res.status(400).json({
      ok: false,
      codigo: 'CREDENCIALES_REQUERIDAS',
      mensaje: 'Ingresa las credenciales del portal.',
    });
  }

  try {
    await probarConexion({ ...datos, usuario: datos.usuario.trim() });
    credenciales.registrarExito(datos);
    return res.json({ ok: true, mensaje: 'Conexión al portal verificada.' });
  } catch (error) {
    if (error.code === 'LOGIN_RECHAZADO' && !proporcionadas) credenciales.registrarFallo(datos);
    return respuestaError(res, error);
  }
});

router.put('/credenciales', (req, res) => {
  const { usuario, pass, urlPortal } = req.body ?? {};
  if (typeof usuario !== 'string' || !usuario.trim() || typeof pass !== 'string' || !pass) {
    return res.status(400).json({
      ok: false,
      codigo: 'CREDENCIALES_REQUERIDAS',
      mensaje: 'Usuario y contraseña del portal son obligatorios.',
    });
  }

  probarConexion({ usuario: usuario.trim(), pass, urlPortal })
    .then(() => {
      credenciales.guardar({ usuario: usuario.trim(), pass, urlPortal });
      res.json({ ok: true, mensaje: 'Credenciales guardadas.' });
    })
    .catch((error) => respuestaError(res, error));
});

router.delete('/credenciales', (req, res) => {
  try {
    credenciales.borrar();
    res.json({ ok: true, mensaje: 'Credenciales eliminadas.' });
  } catch (error) {
    console.error('Error al borrar credenciales del portal:', error.message);
    res.status(500).json({ ok: false, codigo: 'CREDENCIALES_ERROR', mensaje: 'No se pudieron borrar las credenciales del portal.' });
  }
});

module.exports = router;
