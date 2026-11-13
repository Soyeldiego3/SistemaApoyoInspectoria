const express = require('express');
const db = require('../db/conexion');

const router = express.Router();

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

module.exports = router;
