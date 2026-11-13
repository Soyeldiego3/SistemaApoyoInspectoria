const express = require('express');
const dbReadOnly = require('../db/conexion');
const { abrirSesion } = require('../extractores/sesion_portal');
const { descargarAsistencia } = require('../extractores/extraer_asistencia');
const { extraerTablaAtrasos } = require('../extractores/extraer_atrasos');
const { extraerCursos } = require('../extractores/extraer_cursos');
const { parsearAsistencia, abrirDb, guardar } = require('../services/asistencia');
const { parsearAtrasos, guardarAtrasos } = require('../services/atrasos');

const router = express.Router();
let dbWritable;
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function obtenerDbWritable() {
  if (!dbWritable) dbWritable = abrirDb();
  return dbWritable;
}

router.get('/cursos', (req, res) => {
  try {
    const cursos = dbReadOnly
      .prepare('SELECT nombre FROM curso ORDER BY nombre')
      .all()
      .map((curso) => curso.nombre);

    res.json({ cursos });
  } catch (error) {
    console.error('Error al consultar cursos:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los cursos.' });
  }
});

router.post('/descargar-e-importar', async (req, res) => {
  let sesion;
  try {
    // TODO: convertir a job asíncrono
    const mes = MESES[new Date().getMonth()];
    sesion = await abrirSesion();
    const cursos = await extraerCursos(sesion.page);
    if (!cursos.length) {
      return res.status(404).json({ error: 'No se encontraron cursos para sincronizar.' });
    }

    const db = obtenerDbWritable();
    const errores = [];
    let totalAlumnos = 0;
    let filasAsistencia = 0;
    let filasAtrasos = 0;
    let cursosProcesados = 0;

    for (const curso of cursos) {
      try {
        const buffer = await descargarAsistencia(sesion.page, curso, mes);
        const data = parsearAsistencia(buffer);
        filasAsistencia += guardar(db, data);
        totalAlumnos += data.alumnos.length;

        const mm = String(data.mes).padStart(2, '0');
        const ultimoDia = new Date(data.anio, data.mes, 0).getDate();
        const atrasos = parsearAtrasos(await extraerTablaAtrasos(sesion.page, curso));
        filasAtrasos += guardarAtrasos(db, atrasos, {
          desde: `${data.anio}-${mm}-01`,
          hasta: `${data.anio}-${mm}-${ultimoDia}`,
          curso: data.curso,
        });
        cursosProcesados++;
      } catch (error) {
        console.error(`Error al sincronizar ${curso}:`, error.message);
        errores.push({ curso, mensaje: 'No se pudo sincronizar este curso.' });
      }
    }

    res.status(200).json({
      mensaje: 'Proceso completado',
      mes,
      totalCursos: cursos.length,
      cursosProcesados,
      totalAlumnos,
      filasAsistencia,
      filasAtrasos,
      errores,
    });
  } catch (error) {
    console.error('Error en sincronización:', error.message);
    res.status(500).json({ error: 'No se pudo completar la sincronización.' });
  } finally {
    await sesion?.cerrar();
  }
});

module.exports = router;
