const express = require('express');
const configuracion = require('../services/configuracion');
const auditoria = require('../services/auditoria_sistema');
const inicioWindows = require('../services/inicio_windows');
const { requerirRol } = require('../middleware/roles');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { navegadorHeadless } = configuracion.leer();
    res.json({ navegadorHeadless, inicioWindows: await inicioWindows.estado() });
  } catch (error) {
    console.error('Error al consultar ajustes:', error.message);
    res.status(500).json({ error: 'No se pudieron consultar los ajustes.' });
  }
});

// Modo headless de Playwright (true = navegador oculto al sincronizar). Es de depuración: solo admin.
router.put('/navegador', requerirRol('admin'), (req, res) => {
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

// Abrir la app al iniciar Windows ({ activo: boolean }); responde { inicioWindows: { disponible, activo } }
router.put('/inicio-windows', async (req, res) => {
  const activo = req.body?.activo;
  if (typeof activo !== 'boolean') {
    return res.status(400).json({ error: 'El valor de inicio con Windows es inválido.' });
  }
  try {
    const estado = await inicioWindows.cambiar(activo);
    if (!estado.disponible) {
      return res.status(409).json({ error: 'El inicio con Windows solo se puede configurar en la app instalada en Windows.' });
    }
    auditoria.registrar('ajustes.inicio_windows_modificado', req.usuario.nombre, { activo: estado.activo });
    res.json({ inicioWindows: estado });
  } catch (error) {
    console.error('Error al cambiar el inicio con Windows:', error.message);
    res.status(500).json({ error: 'No se pudo cambiar el inicio con Windows.' });
  }
});

module.exports = router;
