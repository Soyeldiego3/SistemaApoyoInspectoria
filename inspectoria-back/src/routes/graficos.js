const express = require('express');
const db = require('../db/conexion');
const {
  obtenerRangosFuentes,
  obtenerIncidentes,
  obtenerRegistrosAsistencia,
} = require('../services/incidentes');

const router = express.Router();
const TOP_ALUMNOS = 5;
const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;

// Recorta el rango de una fuente al período pedido; sin cruce -> sin datos
function recortar(fuente, desde, hasta) {
  if (!fuente.desde) return { desde: null, hasta: null };
  const d = desde && desde > fuente.desde ? desde : fuente.desde;
  const h = hasta && hasta < fuente.hasta ? hasta : fuente.hasta;
  return d <= h ? { desde: d, hasta: h } : { desde: null, hasta: null };
}

// Orden escolar: básica (7°, 8°) antes que media (1°M … 4°M), luego por letra.
// Un nombre con otro formato queda al final, en orden alfabético.
function ordenCurso(a, b) {
  const nivel = (nombre) => {
    const m = /^(\d+)\s*[°º]\s*(M)?\s*([A-Z])$/i.exec(nombre.trim());
    return m ? [m[2] ? 100 + Number(m[1]) : Number(m[1]), m[3].toUpperCase()] : [999, nombre];
  };
  const [na, la] = nivel(a.curso);
  const [nb, lb] = nivel(b.curso);
  return na - nb || la.localeCompare(lb);
}

// Cuenta elementos agrupados por una clave, conservando el orden en que aparecen.
function contarPor(lista, clave) {
  const conteo = new Map();
  for (const elemento of lista) conteo.set(clave(elemento), (conteo.get(clave(elemento)) || 0) + 1);
  return conteo;
}

// Datos para la sección Gráficos. Cada gráfico usa el período de su propia fuente
// (asistencia y atrasos tienen rangos distintos en la base).
router.get('/', (req, res) => {
  const { curso, desde, hasta } = req.query;
  if (curso !== undefined && (typeof curso !== 'string' || curso.length > 50)) {
    return res.status(400).json({ error: 'El curso indicado no es válido.' });
  }
  // Período opcional (semana o mes elegido en el front): deben venir ambas fechas y en orden
  if ((desde !== undefined || hasta !== undefined)
    && (!FECHA_OK.test(String(desde)) || !FECHA_OK.test(String(hasta)) || desde > hasta)) {
    return res.status(400).json({ error: 'El período indicado no es válido.' });
  }

  try {
    const fuentes = obtenerRangosFuentes(db);
    const rangoAsistencia = recortar(fuentes.asistencia, desde, hasta);
    const rangoAtrasos = recortar(fuentes.atrasos, desde, hasta);
    // Fecha más antigua de la base: hasta dónde se puede retroceder en el front
    const inicios = [fuentes.asistencia.desde, fuentes.atrasos.desde].filter(Boolean).sort();
    const filtroCurso = curso || undefined;

    // Asistencia por curso: % de registros "presente" sobre el total del curso
    const registros = obtenerRegistrosAsistencia(db, { ...rangoAsistencia, curso: filtroCurso });
    const totalesCurso = new Map();
    for (const registro of registros) {
      const total = totalesCurso.get(registro.curso) || { registros: 0, presentes: 0 };
      total.registros += 1;
      if (registro.estado === 'P') total.presentes += 1;
      totalesCurso.set(registro.curso, total);
    }
    const asistenciaPorCurso = [...totalesCurso.entries()]
      .map(([nombre, total]) => ({
        curso: nombre,
        asistencia: Number((total.presentes / total.registros * 100).toFixed(1)),
      }))
      .sort(ordenCurso);

    const inasistencias = obtenerIncidentes(db, { ...rangoAsistencia, curso: filtroCurso, tipo: 'inasistencias' });
    const atrasos = obtenerIncidentes(db, { ...rangoAtrasos, curso: filtroCurso, tipo: 'atrasos' });

    // obtenerIncidentes ya viene ordenado por fecha; "2026-11-03" -> "03-11"
    const inasistenciasPorDia = [...contarPor(inasistencias, (i) => i.fecha).entries()]
      .map(([fecha, total]) => ({ dia: `${fecha.slice(8, 10)}-${fecha.slice(5, 7)}`, inasistencias: total }));

    const atrasosPorCurso = [...contarPor(atrasos, (a) => a.curso).entries()]
      .map(([nombre, total]) => ({ curso: nombre, atrasos: total }))
      .sort(ordenCurso);

    const incidentes = [...inasistencias, ...atrasos];
    const justificados = incidentes.filter((i) => i.justificado).length;
    const justificacion = { justificados, sinJustificar: incidentes.length - justificados };

    const porAlumno = new Map();
    for (const atraso of atrasos) {
      if (atraso.justificado) continue;
      const alumno = porAlumno.get(atraso.rut) || {
        rut: atraso.rut,
        nombres: atraso.nombres,
        apellidos: atraso.apellidos,
        curso: atraso.curso,
        atrasos: 0,
      };
      alumno.atrasos += 1;
      porAlumno.set(atraso.rut, alumno);
    }
    const topAtrasos = [...porAlumno.values()]
      .sort((a, b) => b.atrasos - a.atrasos || a.apellidos.localeCompare(b.apellidos))
      .slice(0, TOP_ALUMNOS);

    res.json({
      periodo: { asistencia: rangoAsistencia, atrasos: rangoAtrasos },
      disponible: { desde: inicios[0] || null },
      asistenciaPorCurso,
      atrasosPorCurso,
      justificacion,
      inasistenciasPorDia,
      topAtrasos,
    });
  } catch (error) {
    console.error('Error al consultar datos de gráficos:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los gráficos.' });
  }
});

module.exports = router;
