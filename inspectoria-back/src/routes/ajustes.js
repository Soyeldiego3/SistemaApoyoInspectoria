const express = require('express');
const configuracion = require('../services/configuracion');
const auditoria = require('../services/auditoria_sistema');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const { navegadorHeadless } = configuracion.leer();
    res.json({ navegadorHeadless });
  } catch (error) {
    console.error('Error al consultar ajustes:', error.message);
    res.status(500).json({ error: 'No se pudieron consultar los ajustes.' });
  }
});

// Modo headless de Playwright (true = navegador oculto al sincronizar)
router.put('/navegador', (req, res) => {
  const headless = req.body?.headless;
  if (typeof headless !== 'boolean') {
    return res.status(400).json({ error: 'El valor del modo de navegador es inválido.' });
  }

  try {
    const { navegadorHeadless } = configuracion.guardar({ navegadorHeadless: headless });
    auditoria.registrar('ajustes.navegador_modificado', req.usuario.nombre, { headless });
    res.json({ navegadorHeadless });
  } catch (error) {
    console.error('Error al guardar ajustes:', error.message);
    res.status(500).json({ error: 'No se pudo guardar el ajuste.' });
  }
});

module.exports = router;
