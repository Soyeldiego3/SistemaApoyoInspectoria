const express = require('express');
const { obtenerInfo, cambiarRed } = require('../services/red');
const { reiniciarServidor } = require('../services/servidor');
const { requerirLoopback } = require('../middleware/loopback');
const auditoria = require('../services/auditoria_sistema');

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

module.exports = router;
