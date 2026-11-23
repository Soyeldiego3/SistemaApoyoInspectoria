// Respaldo de información: GET / descarga, POST /restaurar (admin),
// GET /automaticos y GET /automaticos/:archivo (admin, solo desde el PC)
const express = require('express');
const fs = require('fs');
const { abrirDb } = require('../services/asistencia');
const {
  generarRespaldo, restaurarRespaldo, listarAutomaticos, rutaAutomatico, fechaLocal, ErrorRespaldo,
} = require('../services/respaldo');
const { requerirRol } = require('../middleware/roles');
const { requerirLoopback } = require('../middleware/loopback');
const auditoriaSistema = require('../services/auditoria_sistema');

const router = express.Router();
let dbWritable;

function obtenerDbWritable() {
  if (!dbWritable) dbWritable = abrirDb();
  return dbWritable;
}

function enviarJson(res, contenido, nombreArchivo) {
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
    'Access-Control-Expose-Headers': 'Content-Disposition',
  });
  res.send(contenido);
}

function registrar(evento, req, detalle) {
  try {
    auditoriaSistema.registrar(evento, req.usuario?.nombre, detalle);
  } catch (error) {
    console.error('No se pudo registrar el evento de respaldo:', error.message);
  }
}

router.get('/', (req, res) => {
  try {
    const respaldo = generarRespaldo(obtenerDbWritable());
    registrar('respaldo.descargado', req, {
      alertas: respaldo.alerta_gestion.length,
      justificativos: respaldo.justificativos.length,
    });
    enviarJson(res, JSON.stringify(respaldo, null, 2), `respaldo-inspectoria-${fechaLocal()}.json`);
  } catch (error) {
    console.error('Error al generar el respaldo:', error.message);
    res.status(500).json({ error: 'No se pudo generar el respaldo.' });
  }
});

// El archivo llega como bytes (el express.json global solo acepta 100 kb)
router.post('/restaurar', requerirRol('admin'), express.raw({ type: 'application/octet-stream', limit: '5mb' }), (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'Elige un archivo de respaldo.' });
    }
    let datos;
    try {
      datos = JSON.parse(req.body.toString('utf8').replace(/^﻿/, ''));
    } catch {
      return res.status(400).json({ error: 'El archivo no es un respaldo válido.' });
    }
    const resumen = restaurarRespaldo(obtenerDbWritable(), datos);
    registrar('respaldo.restaurado', req, resumen);
    res.json({ ok: true, resumen });
  } catch (error) {
    if (error instanceof ErrorRespaldo) return res.status(error.status).json({ error: error.message });
    console.error('Error al restaurar el respaldo:', error.message);
    res.status(500).json({ error: 'No se pudo restaurar el respaldo.' });
  }
});

router.get('/automaticos', requerirLoopback, requerirRol('admin'), (req, res) => {
  try {
    res.json({ respaldos: listarAutomaticos() });
  } catch (error) {
    console.error('Error al listar respaldos automáticos:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los respaldos automáticos.' });
  }
});

router.get('/automaticos/:archivo', requerirLoopback, requerirRol('admin'), (req, res) => {
  try {
    const ruta = rutaAutomatico(req.params.archivo);
    if (!ruta) return res.status(404).json({ error: 'No se encontró ese respaldo.' });
    enviarJson(res, fs.readFileSync(ruta), req.params.archivo);
  } catch (error) {
    console.error('Error al descargar respaldo automático:', error.message);
    res.status(500).json({ error: 'No se pudo descargar el respaldo.' });
  }
});

module.exports = router;
