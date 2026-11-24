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
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];

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

// Los TOP_ALUMNOS alumnos con más registros sin justificar; campo = 'atrasos' | 'inasistencias'
function topSinJustificar(lista, campo) {
  const porAlumno = new Map();
  for (const i of lista) {
    if (i.justificado) continue;
    const alumno = porAlumno.get(i.rut) || { rut: i.rut, nombres: i.nombres, apellidos: i.apellidos, curso: i.curso, [campo]: 0 };
    alumno[campo] += 1;
    porAlumno.set(i.rut, alumno);
  }
  return [...porAlumno.values()]
    .sort((a, b) => b[campo] - a[campo] || a.apellidos.localeCompare(b.apellidos))
    .slice(0, TOP_ALUMNOS);
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
    // Los gráficos por curso muestran siempre todos los cursos (el elegido se resalta en el front);
    // el resto de los gráficos usa solo las filas del curso elegido.
    const delCurso = (lista) => (filtroCurso ? lista.filter((x) => x.curso === filtroCurso) : lista);

    // Asistencia por curso: % de registros "presente" sobre el total del curso
    const registros = obtenerRegistrosAsistencia(db, rangoAsistencia);
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

    const todosAtrasos = obtenerIncidentes(db, { ...rangoAtrasos, tipo: 'atrasos' });
    const inasistencias = delCurso(obtenerIncidentes(db, { ...rangoAsistencia, tipo: 'inasistencias' }));
    const atrasos = delCurso(todosAtrasos);

    // Todos los días con registro de asistencia (aunque tengan 0 inasistencias), ordenados por fecha.
    // Así el calendario distingue "0 inasistencias" de "sin datos ese día". "2026-11-03" -> "03-11"
    const porFecha = contarPor(inasistencias, (i) => i.fecha);
    const fechasConRegistro = [...new Set(delCurso(registros).map((r) => r.fecha))].sort();
    const inasistenciasPorDia = fechasConRegistro.map((fecha) => ({
      fecha,
      dia: `${fecha.slice(8, 10)}-${fecha.slice(5, 7)}`,
      inasistencias: porFecha.get(fecha) || 0,
    }));

    // Total de inasistencias por día de la semana (lunes a viernes); getDay(): 1 = lunes
    const porDiaSemana = contarPor(inasistencias, (i) => new Date(`${i.fecha}T00:00:00`).getDay());
    const inasistenciasPorDiaSemana = DIAS_SEMANA.map((dia, indice) => ({
      dia,
      inasistencias: porDiaSemana.get(indice + 1) || 0,
    }));

    const atrasosPorCurso = [...contarPor(todosAtrasos, (a) => a.curso).entries()]
      .map(([nombre, total]) => ({ curso: nombre, atrasos: total }))
      .sort(ordenCurso);

    const incidentes = [...inasistencias, ...atrasos];
    const justificados = incidentes.filter((i) => i.justificado).length;
    const justificacion = { justificados, sinJustificar: incidentes.length - justificados };

    // % de asistencia de cada alumno, solo con un curso elegido (con todos serían cientos de filas).
    // De menor a mayor: los casos críticos quedan arriba.
    let asistenciaPorAlumno = [];
    if (filtroCurso) {
      const totalesAlumno = new Map();
      for (const registro of delCurso(registros)) {
        const total = totalesAlumno.get(registro.rut) || { registros: 0, presentes: 0 };
        total.registros += 1;
        if (registro.estado === 'P') total.presentes += 1;
        totalesAlumno.set(registro.rut, total);
      }
      const alumnosCurso = db.prepare(`
        SELECT DISTINCT a.rut, a.nombres, a.apellidos
        FROM matricula m
        JOIN alumno a ON a.rut = m.rut_alumno
        JOIN curso c ON c.id_curso = m.id_curso
        WHERE c.nombre = ?
      `).all(filtroCurso);
      asistenciaPorAlumno = alumnosCurso
        .filter((a) => totalesAlumno.has(a.rut))
        .map((a) => {
          const total = totalesAlumno.get(a.rut);
          return { ...a, asistencia: Number((total.presentes / total.registros * 100).toFixed(1)) };
        })
        .sort((a, b) => a.asistencia - b.asistencia || a.apellidos.localeCompare(b.apellidos));
    }

    const topAtrasos = topSinJustificar(atrasos, 'atrasos');
    const topInasistencias = topSinJustificar(inasistencias, 'inasistencias');

    res.json({
      periodo: { asistencia: rangoAsistencia, atrasos: rangoAtrasos },
      disponible: { desde: inicios[0] || null },
      asistenciaPorCurso,
      atrasosPorCurso,
      justificacion,
      inasistenciasPorDia,
      inasistenciasPorDiaSemana,
      asistenciaPorAlumno,
      topAtrasos,
      topInasistencias,
    });
  } catch (error) {
    console.error('Error al consultar datos de gráficos:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los gráficos.' });
  }
});

// Alumnos con inasistencia en un día (panel que se abre al hacer clic en el calendario)
router.get('/dia', (req, res) => {
  const { fecha, curso } = req.query;
  if (!FECHA_OK.test(String(fecha))) {
    return res.status(400).json({ error: 'La fecha indicada no es válida.' });
  }
  if (curso !== undefined && (typeof curso !== 'string' || curso.length > 50)) {
    return res.status(400).json({ error: 'El curso indicado no es válido.' });
  }

  try {
    const alumnos = obtenerIncidentes(db, { desde: fecha, hasta: fecha, curso: curso || undefined, tipo: 'inasistencias' })
      .map((i) => ({
        rut: i.rut,
        nombres: i.nombres,
        apellidos: i.apellidos,
        curso: i.curso,
        justificado: Boolean(i.justificado),
      }))
      .sort((a, b) => ordenCurso(a, b) || a.apellidos.localeCompare(b.apellidos));
    res.json({ fecha, alumnos });
  } catch (error) {
    console.error('Error al consultar inasistencias del día:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar las inasistencias del día.' });
  }
});

module.exports = router;
