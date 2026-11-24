const express = require('express');
const db = require('../db/conexion');
const { abrirDb, normalizarRut, transaccion } = require('../services/asistencia');
const { sqlJustificado, sqlUltimoTipo, recortarSuperpuestos } = require('../services/justificativos');

const router = express.Router();
let dbWritable;

function obtenerDbWritable() {
  if (!dbWritable) dbWritable = abrirDb();
  return dbWritable;
}

// Un justificativo cubre inasistencias, atrasos o ambos (aplica_a NULL = justificativos antiguos)
const APLICA_A = ['inasistencia', 'atraso'];

router.get('/alumnos', (req, res) => {
  try {
    const alumnos = db.prepare(`
      SELECT a.rut, a.nombres, a.apellidos, c.nombre AS curso,
        (SELECT COUNT(*) FROM atraso t
          WHERE t.id_matricula = m.id_matricula
            AND t.justificado_portal = 0
            AND NOT ${sqlJustificado('a.rut', 't.fecha', 'atraso')}
        ) AS atrasos,
        (SELECT COUNT(*) FROM asistencia s
          WHERE s.id_matricula = m.id_matricula
            AND s.estado IN ('A', 'F')
            AND NOT ${sqlJustificado('a.rut', 's.fecha', 'inasistencia')}
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
    const rut = normalizarRut(req.params.rut);
    const alumno = db.prepare(`
      SELECT a.rut, a.nombres, a.apellidos, c.nombre AS curso, m.anio, m.id_matricula
      FROM alumno a
      JOIN matricula m ON m.rut_alumno = a.rut
      JOIN curso c ON c.id_curso = m.id_curso
      WHERE a.rut = ? AND m.anio = (SELECT MAX(anio) FROM matricula)
      LIMIT 1
    `).get(rut);

    if (!alumno) return res.status(404).json({ error: 'No se encontró el alumno.' });
    const parametros = { rut: alumno.rut, id_matricula: alumno.id_matricula };

    // Solo los días con inasistencia (A o F); los días presentes no se listan
    const inasistencias = db.prepare(`
      SELECT s.fecha, s.estado,
        ${sqlJustificado('@rut', 's.fecha', 'inasistencia')} AS justificado,
        ${sqlUltimoTipo('@rut', 's.fecha', 'inasistencia')} AS motivo
      FROM asistencia s
      WHERE s.id_matricula = @id_matricula AND s.estado IN ('A', 'F')
      ORDER BY s.fecha DESC
    `).all(parametros);

    // Cada atraso por separado (puede haber más de uno el mismo día)
    const atrasos = db.prepare(`
      SELECT id_atraso, fecha, hora_llegada, justificado_portal, justificado_doc, motivo,
        CASE WHEN justificado_portal = 1 OR justificado_doc = 1 THEN 1 ELSE 0 END AS justificado
      FROM (
        SELECT t.id_atraso, t.fecha, t.hora_llegada, t.justificado_portal,
          ${sqlJustificado('@rut', 't.fecha', 'atraso')} AS justificado_doc,
          ${sqlUltimoTipo('@rut', 't.fecha', 'atraso')} AS motivo
        FROM atraso t
        WHERE t.id_matricula = @id_matricula
      )
      ORDER BY fecha DESC, hora_llegada DESC
    `).all(parametros);

    const { diasRegistrados } = db.prepare(
      'SELECT COUNT(*) AS diasRegistrados FROM asistencia WHERE id_matricula = @id_matricula',
    ).get(parametros);

    const resumen = {
      diasRegistrados,
      inasistencias: inasistencias.length,
      inasistenciasSinJustificar: inasistencias.filter((d) => !d.justificado).length,
      atrasos: atrasos.length,
      atrasosSinJustificar: atrasos.filter((t) => !t.justificado).length,
      porcentajeAsistencia: diasRegistrados
        ? (diasRegistrados - inasistencias.length) / diasRegistrados
        : null,
    };

    delete alumno.id_matricula;
    res.json({ alumno, resumen, inasistencias, atrasos });
  } catch (error) {
    console.error('Error al consultar detalle del alumno:', error.message);
    res.status(500).json({ error: 'No se pudo cargar el detalle del alumno.' });
  }
});

router.post('/alumnos/:rut/justificativos', (req, res) => {
  try {
    const { tipo, desde, hasta, duracionMs, aplicaA } = req.body ?? {};
    if (typeof tipo !== 'string' || !tipo.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(desde) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || hasta < desde) {
      return res.status(400).json({ error: 'Tipo y rango de fechas inválidos.' });
    }
    if (duracionMs !== undefined && duracionMs !== null && (!Number.isSafeInteger(duracionMs) || duracionMs < 0)) {
      return res.status(400).json({ error: 'La duración del registro no es válida.' });
    }
    if (aplicaA !== undefined && aplicaA !== null && !APLICA_A.includes(aplicaA)) {
      return res.status(400).json({ error: 'El justificativo debe aplicar a inasistencias o atrasos.' });
    }

    const rut = normalizarRut(req.params.rut);
    const alumno = db.prepare('SELECT rut FROM alumno WHERE rut = ?').get(rut);
    if (!alumno) return res.status(404).json({ error: 'No se encontró el alumno.' });

    // El nuevo justificativo sobrescribe a los anteriores del mismo tipo en esas fechas
    const dbw = obtenerDbWritable();
    const id = transaccion(dbw, () => {
      const { lastInsertRowid } = dbw.prepare(`
        INSERT INTO justificativo
          (rut_alumno, tipo_documento, fecha_inicio, fecha_fin, estado_documento, duracion_ms, creado_en, aplica_a)
        VALUES (?, ?, ?, ?, 'APROBADO', ?, ?, ?)
      `).run(alumno.rut, tipo.trim(), desde, hasta, duracionMs ?? null, new Date().toISOString(), aplicaA ?? null);
      const nuevo = dbw.prepare('SELECT * FROM justificativo WHERE id_justificativo = ?').get(lastInsertRowid);
      recortarSuperpuestos(dbw, nuevo);
      return lastInsertRowid;
    });
    res.status(201).json({ id });
  } catch (error) {
    console.error('Error al crear justificativo:', error.message);
    res.status(500).json({ error: 'No se pudo guardar el justificativo.' });
  }
});

// Agrupa filas (ordenadas por hora_inicio) en bloques: [{ hora_inicio, hora_fin, alumnos }]
function agruparBloques(filas) {
  const bloques = [];
  for (const { hora_inicio, hora_fin, ...alumno } of filas) {
    let bloque = bloques.at(-1);
    if (!bloque || bloque.hora_inicio !== hora_inicio) {
      bloque = { hora_inicio, hora_fin, alumnos: [] };
      bloques.push(bloque);
    }
    bloque.alumnos.push(alumno);
  }
  return bloques;
}

// Asistencia por clase guardada, agrupada por bloque.
// ?curso=7°A&fecha=2026-11-25 -> { curso, fecha, bloques }
// ?fecha=2026-11-25 (todos los cursos) -> { fecha, cursos: [{ curso, bloques }] }
router.get('/clase', (req, res) => {
  const curso = typeof req.query.curso === 'string' ? req.query.curso.trim() : '';
  const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Indica la fecha (YYYY-MM-DD).' });
  }
  try {
    const filas = db.prepare(`
      SELECT c.nombre AS curso, ac.hora_inicio, ac.hora_fin, al.rut, al.apellidos, al.nombres, ac.estado
      FROM asistencia_clase ac
      JOIN matricula m ON m.id_matricula = ac.id_matricula
      JOIN alumno al   ON al.rut = m.rut_alumno
      JOIN curso c     ON c.id_curso = m.id_curso
      WHERE ac.fecha = ? AND (? = '' OR c.nombre = ?)
      ORDER BY c.nombre, ac.hora_inicio, al.apellidos, al.nombres
    `).all(fecha, curso, curso);

    if (curso) {
      return res.json({ curso, fecha, bloques: agruparBloques(filas.map(({ curso: _c, ...fila }) => fila)) });
    }
    const porCurso = new Map();
    for (const { curso: nombre, ...fila } of filas) {
      if (!porCurso.has(nombre)) porCurso.set(nombre, []);
      porCurso.get(nombre).push(fila);
    }
    res.json({
      fecha,
      cursos: [...porCurso].map(([nombre, filasCurso]) => ({ curso: nombre, bloques: agruparBloques(filasCurso) })),
    });
  } catch (error) {
    console.error('Error al consultar asistencia por clase:', error.message);
    res.status(500).json({ error: 'No se pudo cargar la asistencia por clase.' });
  }
});

module.exports = router;
