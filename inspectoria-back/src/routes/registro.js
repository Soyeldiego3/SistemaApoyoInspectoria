// Importar / exportar el "Master de registro inasistencia justificadas" (Excel por curso)
const express = require('express');
const db = require('../db/conexion');
const { abrirDb, transaccion } = require('../services/asistencia');
const { ErrorRegistro, exportarMaster, importarMaster } = require('../services/registroMaster');

const router = express.Router();
let dbWritable;

function obtenerDbWritable() {
  if (!dbWritable) dbWritable = abrirDb();
  return dbWritable;
}

function cursoValido(curso) {
  return typeof curso === 'string' && curso.trim().length > 0 && curso.length <= 40;
}

function responderError(res, error, contexto) {
  if (error instanceof ErrorRegistro) {
    return res.status(error.status).json({ error: error.message, cursoArchivo: error.cursoArchivo });
  }
  console.error(`${contexto}:`, error.message);
  return res.status(500).json({ error: 'No se pudo procesar el registro de inasistencias.' });
}

// Rango de fechas con asistencia cargada (para avisar qué cubre la exportación)
router.get('/rango', (req, res) => {
  try {
    const rango = db.prepare('SELECT MIN(fecha) AS desde, MAX(fecha) AS hasta, COUNT(DISTINCT fecha) AS dias FROM asistencia').get();
    res.json(rango);
  } catch (error) {
    responderError(res, error, 'Error al consultar el rango de datos');
  }
});

router.get('/exportar', async (req, res) => {
  const { curso } = req.query;
  if (!cursoValido(curso)) return res.status(400).json({ error: 'Elige un curso para exportar.' });
  try {
    const { buffer, nombreArchivo, advertencias } = await exportarMaster(db, curso.trim());
    const ascii = nombreArchivo.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/"/g, '');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`,
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Advertencias',
    });
    if (advertencias.length) res.set('X-Advertencias', encodeURIComponent(JSON.stringify(advertencias)));
    res.send(buffer);
  } catch (error) {
    responderError(res, error, 'Error al exportar el registro');
  }
});

router.post('/importar', express.raw({ type: 'application/octet-stream', limit: '10mb' }), (req, res) => {
  const { curso } = req.query;
  if (!cursoValido(curso)) return res.status(400).json({ error: 'Elige el curso del archivo a importar.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'No se recibió ningún archivo.' });
  }
  try {
    const resumen = importarMaster(obtenerDbWritable(), curso.trim(), req.body, { transaccion });
    res.json(resumen);
  } catch (error) {
    responderError(res, error, 'Error al importar el registro');
  }
});

module.exports = router;
