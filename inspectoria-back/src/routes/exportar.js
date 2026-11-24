// Exportar datos: GET /api/exportar?documento=asistencia|asistenciaMensual|atrasos|master&curso=&formato=excel|pdf&desde=&hasta=
const express = require('express');
const db = require('../db/conexion');
const { ErrorRegistro } = require('../services/registroMaster');
const { exportarDocumento, DOCUMENTOS } = require('../services/exportar');

const router = express.Router();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function enviarArchivo(res, { buffer, nombreArchivo, tipo, advertencias = [] }) {
  const ascii = nombreArchivo.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/"/g, '');
  res.set({
    'Content-Type': tipo,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`,
    'Access-Control-Expose-Headers': 'Content-Disposition, X-Advertencias',
  });
  if (advertencias.length) res.set('X-Advertencias', encodeURIComponent(JSON.stringify(advertencias)));
  res.send(buffer);
}

router.get('/', async (req, res) => {
  const { documento, formato = 'excel' } = req.query;
  const curso = typeof req.query.curso === 'string' ? req.query.curso.trim() : '';
  const desde = req.query.desde || '';
  const hasta = req.query.hasta || '';
  if (!Object.hasOwn(DOCUMENTOS, documento)) return res.status(400).json({ error: 'Elige qué documento exportar.' });
  if (!['excel', 'pdf'].includes(formato)) return res.status(400).json({ error: 'El formato debe ser Excel o PDF.' });
  if (curso.length > 40) return res.status(400).json({ error: 'Curso no válido.' });
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta)) || (desde && hasta && desde > hasta)) {
    return res.status(400).json({ error: 'El período no es válido.' });
  }
  try {
    const archivo = await exportarDocumento(db, { documento, curso, formato, desde, hasta });
    enviarArchivo(res, archivo);
  } catch (error) {
    if (error instanceof ErrorRegistro) return res.status(error.status).json({ error: error.message });
    console.error('Error al exportar:', error);
    res.status(500).json({ error: 'No se pudo generar el archivo.' });
  }
});

module.exports = router;
