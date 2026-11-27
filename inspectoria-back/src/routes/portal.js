const express = require('express');
const credenciales = require('../services/credenciales_portal');
const { probarConexion, URL_PORTAL_POR_DEFECTO } = require('../extractores/sesion_portal');
const auditoria = require('../services/auditoria_sistema');

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
    NAVEGADOR_NO_DISPONIBLE: 'No se encontró Microsoft Edge.',
    ESTRUCTURA_CAMBIADA: 'El portal cambió y no se pudo completar la operación.',
  };
  const estado = codigo === 'LOGIN_RECHAZADO' ? 422
    : codigo === 'NAVEGADOR_NO_DISPONIBLE' ? 503
    : codigo === 'ESTRUCTURA_CAMBIADA' ? 502
    : 502;
  return res.status(estado)
    .json({ ok: false, codigo, mensaje: mensajes[codigo] });
}

router.get('/credenciales', (req, res) => {
  try {
    const disco = credenciales.leer();
    const memoria = credenciales.leerEnMemoria();
    const disponibles = memoria || disco;
    res.json({
      guardadas: Boolean(disco),
      usuario: disponibles?.usuario || null,
      urlPortal: disponibles?.urlPortal || null,
      // URL que se abre en el navegador para comprobar que el portal responde
      urlAbrir: disponibles?.urlPortal || process.env.PORTAL_URL || URL_PORTAL_POR_DEFECTO,
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
    return respuestaError(res, error);
  }
});

router.put('/credenciales', async (req, res) => {
  const { usuario, pass, urlPortal } = req.body ?? {};
  if (typeof usuario !== 'string' || !usuario.trim() || typeof pass !== 'string' || !pass) {
    return res.status(400).json({
      ok: false,
      codigo: 'CREDENCIALES_REQUERIDAS',
      mensaje: 'Usuario y contraseña del portal son obligatorios.',
    });
  }

  try {
    const datos = { usuario: usuario.trim(), pass, urlPortal };
    await probarConexion(datos);
    // Si estaban solo en memoria, siguen solo en memoria
    if (!credenciales.existe() && credenciales.leerEnMemoria()) credenciales.guardarEnMemoria(datos);
    else credenciales.guardar(datos);
    auditoria.registrar('portal.credenciales_modificadas', req.usuario.nombre, {});
    return res.json({ ok: true, mensaje: 'Credenciales guardadas.' });
  } catch (error) {
    return respuestaError(res, error);
  }
});

router.delete('/credenciales', (req, res) => {
  try {
    credenciales.borrar();
    auditoria.registrar('portal.credenciales_eliminadas', req.usuario.nombre, {});
    res.json({ ok: true, mensaje: 'Credenciales eliminadas.' });
  } catch (error) {
    console.error('Error al borrar credenciales del portal:', error.message);
    res.status(500).json({ ok: false, codigo: 'CREDENCIALES_ERROR', mensaje: 'No se pudieron borrar las credenciales del portal.' });
  }
});

module.exports = router;
