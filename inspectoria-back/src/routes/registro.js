// Importar el "Master de registro inasistencia justificadas" (Excel por curso)
const express = require('express');
const db = require('../db/conexion');
const { abrirDb, transaccion } = require('../services/asistencia');
const { ErrorRegistro, importarMaster } = require('../services/registroMaster');

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

// La exportación está en routes/exportar.js (asistencia, atrasos y Master)

// ?curso= es opcional: sin él, el curso se detecta desde el archivo (MASTER!B2)
router.post('/importar', express.raw({ type: 'application/octet-stream', limit: '10mb' }), (req, res) => {
  const { curso } = req.query;
  if (curso != null && !cursoValido(curso)) return res.status(400).json({ error: 'Curso no válido.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'No se recibió ningún archivo.' });
  }
  try {
    const resumen = importarMaster(obtenerDbWritable(), curso ? curso.trim() : null, req.body, { transaccion });
    res.json(resumen);
  } catch (error) {
    responderError(res, error, 'Error al importar el registro');
  }
});

module.exports = router;
