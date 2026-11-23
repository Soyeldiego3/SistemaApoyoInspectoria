const express = require('express');
const { obtenerInfo, cambiarRed } = require('../services/red');
const { reiniciarServidor } = require('../services/servidor');
const { requerirLoopback } = require('../middleware/loopback');
const auditoria = require('../services/auditoria_sistema');
const usuarios = require('../db/usuarios');
const { generarCodigo } = require('../services/qr_login');

const router = express.Router();

router.get('/info', (req, res) => {
  try {
    res.json(obtenerInfo());
  } catch (error) {
    console.error('Error al consultar configuración de red:', error.message);
    res.status(500).json({ error: 'No se pudo consultar la configuración de red.' });
  }
});

// Código de un solo uso para el QR: el teléfono inicia sesión como el usuario del PC.
// Solo desde el PC, así un teléfono con sesión no puede generar más códigos.
router.post('/qr-login', requerirLoopback, (req, res) => {
  try {
    const info = obtenerInfo();
    if (!info.habilitada || !info.principal) {
      return res.status(409).json({ error: 'Activa el acceso en red para iniciar sesión desde el teléfono.' });
    }
    const usuario = usuarios.buscarPorId(req.usuario.id);
    const { codigo, expiraEnMs, renovarEnMs } = generarCodigo(usuario);
    res.json({
      codigo,
      url: `${info.principal}/#/login?qr=${codigo}`,
      expiraEnMs,
      renovarEnMs,
      usuario: req.usuario.nombre,
    });
  } catch (error) {
    console.error('Error al generar el código QR:', error.message);
    res.status(500).json({ error: 'No se pudo generar el código de inicio de sesión.' });
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
