const express = require('express');
const { obtenerInfo, cambiarRed } = require('../services/red');
const { reiniciarServidor } = require('../services/servidor');
const { requerirLoopback } = require('../middleware/loopback');
const auditoria = require('../services/auditoria_sistema');
const tunel = require('../services/tunel');

const router = express.Router();

router.get('/info', (req, res) => {
  try {
    res.json(obtenerInfo());
  } catch (error) {
    console.error('Error al consultar configuración de red:', error.message);
    res.status(500).json({ error: 'No se pudo consultar la configuración de red.' });
  }
});

router.put('/config', requerirLoopback, (req, res) => {
  if (typeof req.body?.habilitada !== 'boolean') {
    return res.status(400).json({ error: 'La configuración de red es inválida.' });
  }

  try {
    const info = cambiarRed(req.body.habilitada);
    auditoria.registrar('red.acceso_modificado', req.usuario.nombre, { habilitada: req.body.habilitada });
    res.json(info);
    setImmediate(() => reiniciarServidor().catch((error) => {
      console.error('Error al reiniciar el servidor de red:', error.message);
    }));
  } catch (error) {
    console.error('Error al guardar configuración de red:', error.message);
    res.status(500).json({ error: 'No se pudo guardar la configuración de red.' });
  }
});

// Acceso desde otra red (experimental): túnel de Cloudflare, independiente del acceso en red local
router.get('/tunel', requerirLoopback, (req, res) => {
  res.json(tunel.obtenerEstado());
});

router.put('/tunel', requerirLoopback, async (req, res) => {
  if (typeof req.body?.activo !== 'boolean') {
    return res.status(400).json({ error: 'La configuración del túnel es inválida.' });
  }
  try {
    const info = req.body.activo ? await tunel.iniciarTunel() : tunel.detenerTunel();
    auditoria.registrar(req.body.activo ? 'red.tunel_activado' : 'red.tunel_desactivado', req.usuario.nombre, {
      estado: info.estado,
    });
    res.json(info);
  } catch (error) {
    console.error('Error al cambiar el túnel:', error.message);
    res.status(500).json({ error: 'No se pudo cambiar el acceso desde otra red.' });
  }
});

module.exports = router;
