const express = require('express');
const { esLoopback, obtenerInfo, cambiarRed } = require('../services/red');
const { reiniciarServidor } = require('../services/servidor');

const router = express.Router();

router.get('/info', (req, res) => {
  try {
    res.json(obtenerInfo());
  } catch (error) {
    console.error('Error al consultar configuración de red:', error.message);
    res.status(500).json({ error: 'No se pudo consultar la configuración de red.' });
  }
});

router.put('/config', (req, res) => {
  if (!esLoopback(req.socket.remoteAddress)) {
    return res.status(403).json({ error: 'Esta configuración solo puede cambiarse desde el PC.' });
  }
  if (typeof req.body?.habilitada !== 'boolean') {
    return res.status(400).json({ error: 'La configuración de red es inválida.' });
  }

  try {
    const info = cambiarRed(req.body.habilitada);
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
