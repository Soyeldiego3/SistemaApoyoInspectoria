// Importar Excel por curso: el "Master de registro inasistencia justificadas" o la
// asistencia mensual (formato del reporte del portal, o el Excel que descarga la sincronización)
const express = require('express');
const XLSX = require('xlsx');
const db = require('../db/conexion');
const { abrirDb, transaccion } = require('../services/asistencia');
const { ErrorRegistro, importarMaster } = require('../services/registroMaster');
const { importarAsistencia } = require('../services/asistenciaMensual');

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

// ?curso= es opcional: sin él, el curso se detecta desde el archivo (MASTER!B2 o el título)
router.post('/importar', express.raw({ type: 'application/octet-stream', limit: '10mb' }), (req, res) => {
  const { curso } = req.query;
  if (curso != null && !cursoValido(curso)) return res.status(400).json({ error: 'Curso no válido.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'No se recibió ningún archivo.' });
  }
  // PR-07: un .xlsx es un ZIP (empieza con "PK\x03\x04"). Así no se intenta leer un CSV, HTML
  // u otro archivo renombrado, que XLSX.read también aceptaría.
  if (req.body.length < 4 || req.body.readUInt32BE(0) !== 0x504B0304) {
    return res.status(400).json({ error: 'El archivo debe ser un Excel (.xlsx).' });
  }
  try {
    let wb;
    try {
      wb = XLSX.read(req.body, { type: 'buffer' });
    } catch {
      throw new ErrorRegistro(400, 'No se pudo leer el archivo. Debe ser un Excel (.xlsx).');
    }
    const cursoElegido = curso ? curso.trim() : null;
    const conexion = obtenerDbWritable();
    const resumen = wb.Sheets.MASTER
      ? importarMaster(conexion, cursoElegido, req.body, { transaccion })
      : importarAsistencia(conexion, wb, req.body, cursoElegido, { transaccion });
    if (!resumen) {
      throw new ErrorRegistro(400, 'El archivo no es un Master de inasistencias justificadas ni un reporte de Asistencia mensual.');
    }
    res.json(resumen);
  } catch (error) {
    responderError(res, error, 'Error al importar el registro');
  }
});

module.exports = router;
