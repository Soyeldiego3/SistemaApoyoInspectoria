const express = require('express');
const db = require('../db/conexion');
const { abrirDb } = require('../services/asistencia');

const router = express.Router();
let dbWritable;

function obtenerDbWritable() {
  if (!dbWritable) dbWritable = abrirDb();
  return dbWritable;
}

router.get('/alumnos', (req, res) => {
  try {
    const alumnos = db.prepare(`
      SELECT a.rut, a.nombres, a.apellidos, c.nombre AS curso,
        (SELECT COUNT(*) FROM atraso t
          WHERE t.id_matricula = m.id_matricula
            AND t.justificado_portal = 0
            AND NOT EXISTS (SELECT 1 FROM justificativo j
                            WHERE j.rut_alumno = a.rut
                              AND t.fecha BETWEEN j.fecha_inicio AND j.fecha_fin)
        ) AS atrasos,
        (SELECT COUNT(*) FROM asistencia s
          WHERE s.id_matricula = m.id_matricula
            AND s.estado = 'A'
            AND NOT EXISTS (SELECT 1 FROM justificativo j
                            WHERE j.rut_alumno = a.rut
                              AND s.fecha BETWEEN j.fecha_inicio AND j.fecha_fin)
        ) AS pendientes
      FROM alumno a
      JOIN matricula m ON m.rut_alumno = a.rut
      JOIN curso c ON c.id_curso = m.id_curso
      WHERE m.anio = (SELECT MAX(anio) FROM matricula)
      ORDER BY c.nombre, a.apellidos, a.nombres
    `).all();

    res.json({ alumnos });
  } catch (error) {
    console.error('Error al consultar alumnos:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los alumnos.' });
  }
});

router.get('/alumnos/:rut', (req, res) => {
  try {
    const alumno = db.prepare(`
      SELECT a.rut, a.nombres, a.apellidos, c.nombre AS curso, m.anio
      FROM alumno a
      JOIN matricula m ON m.rut_alumno = a.rut
      JOIN curso c ON c.id_curso = m.id_curso
      WHERE a.rut = ? AND m.anio = (SELECT MAX(anio) FROM matricula)
      LIMIT 1
    `).get(req.params.rut);

    if (!alumno) return res.status(404).json({ error: 'No se encontró el alumno.' });

    const dias = db.prepare(`
      WITH fechas AS (
        SELECT fecha FROM asistencia WHERE id_matricula = (
          SELECT m.id_matricula FROM matricula m
          WHERE m.rut_alumno = ? AND m.anio = ?
          LIMIT 1
        )
        UNION
        SELECT fecha FROM atraso WHERE id_matricula = (
          SELECT m.id_matricula FROM matricula m
          WHERE m.rut_alumno = ? AND m.anio = ?
          LIMIT 1
        )
      )
      SELECT f.fecha,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM asistencia s
            JOIN matricula m ON m.id_matricula = s.id_matricula
            WHERE m.rut_alumno = ? AND m.anio = ? AND s.fecha = f.fecha
              AND s.estado IN ('A', 'F')
          ) THEN 'ausente'
          WHEN EXISTS (
            SELECT 1 FROM atraso t
            JOIN matricula m ON m.id_matricula = t.id_matricula
            WHERE m.rut_alumno = ? AND m.anio = ? AND t.fecha = f.fecha
          ) THEN 'atraso'
          ELSE 'presente'
        END AS estado,
        CASE WHEN EXISTS (
          SELECT 1 FROM justificativo j
          WHERE j.rut_alumno = ? AND j.estado_documento = 'APROBADO'
            AND f.fecha BETWEEN j.fecha_inicio AND j.fecha_fin
        ) THEN 1 ELSE 0 END AS justificado,
        (SELECT t.hora_llegada FROM atraso t
          JOIN matricula m ON m.id_matricula = t.id_matricula
          WHERE m.rut_alumno = ? AND m.anio = ? AND t.fecha = f.fecha
          ORDER BY t.hora_llegada LIMIT 1) AS hora_llegada
      FROM fechas f
      ORDER BY f.fecha DESC
    `).all(
      alumno.rut, alumno.anio,
      alumno.rut, alumno.anio,
      alumno.rut, alumno.anio,
      alumno.rut, alumno.anio,
      alumno.rut,
      alumno.rut, alumno.anio,
    );

    res.json({ alumno, dias });
  } catch (error) {
    console.error('Error al consultar detalle del alumno:', error.message);
    res.status(500).json({ error: 'No se pudo cargar el detalle del alumno.' });
  }
});

router.post('/alumnos/:rut/justificativos', (req, res) => {
  try {
    const { tipo, desde, hasta } = req.body ?? {};
    if (typeof tipo !== 'string' || !tipo.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(desde) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || hasta < desde) {
      return res.status(400).json({ error: 'Tipo y rango de fechas inválidos.' });
    }

    const alumno = db.prepare('SELECT rut FROM alumno WHERE rut = ?').get(req.params.rut);
    if (!alumno) return res.status(404).json({ error: 'No se encontró el alumno.' });

    const insert = obtenerDbWritable().prepare(`
      INSERT INTO justificativo
        (rut_alumno, tipo_documento, fecha_inicio, fecha_fin, estado_documento)
      VALUES (?, ?, ?, ?, 'APROBADO')
    `);
    const resultado = insert.run(alumno.rut, tipo.trim(), desde, hasta);
    res.status(201).json({ id: resultado.lastInsertRowid });
  } catch (error) {
    console.error('Error al crear justificativo:', error.message);
    res.status(500).json({ error: 'No se pudo guardar el justificativo.' });
  }
});

module.exports = router;
