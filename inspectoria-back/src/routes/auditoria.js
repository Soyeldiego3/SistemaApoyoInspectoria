const express = require('express');
const db = require('../db/conexion');
const {
  normalizarTipo,
  resolverRango,
  obtenerIncidentes,
  obtenerRegistrosAsistencia,
} = require('../services/incidentes');
const {
  MIN_DIAS_REGISTRADOS,
  DIAS_TENDENCIA_RECIENTE,
  PESO_INASISTENCIA,
  PESO_ATRASO,
  PESO_RACHA_AUSENCIAS,
  PESO_TENDENCIA,
} = require('../config/auditoria');
const configuracion = require('../services/configuracion');
const { obtenerRangosFuentes } = require('../services/incidentes');

const router = express.Router();

function sumarDias(fecha, dias) {
  const valor = new Date(`${fecha}T00:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
}

function metadata(rango, tipo) {
  return {
    tipo: normalizarTipo(tipo),
    rango: rango.elegido,
    rangoSugerido: rango.sugerido,
    rangosFuentes: rango.fuentes,
    advertencias: rango.advertencias,
    coberturaCompleta: rango.coberturaCompleta,
  };
}

function calcularRachaAusencias(registros) {
  const porAlumno = new Map();
  for (const registro of registros) {
    const clave = `${registro.rut}::${registro.curso}`;
    if (!porAlumno.has(clave)) porAlumno.set(clave, []);
    porAlumno.get(clave).push(registro);
  }
  const resultado = new Map();
  for (const [clave, filas] of porAlumno) {
    // La racha usa filas consecutivas con registro del curso; no se comparan
    // fechas calendario, por lo que fines de semana, feriados y días sin fila
    // no interrumpen la secuencia. Se cuentan A/F, aunque estén justificadas.
    let actual = 0;
    let maxima = 0;
    for (const fila of filas) {
      if (fila.estado === 'A' || fila.estado === 'F') {
        actual += 1;
        maxima = Math.max(maxima, actual);
      } else {
        actual = 0;
      }
    }
    resultado.set(clave, maxima);
  }
  return resultado;
}

router.get('/estado', (req, res) => {
  try {
    const rangos = obtenerRangosFuentes(db);
    let ultimaSincronizacionExitosa = null;
    try {
      ultimaSincronizacionExitosa = configuracion.leer().ultimaSincronizacionExitosa || null;
    } catch (error) {
      console.error('No se pudo leer la fecha de sincronización:', error.message);
    }

    if (!ultimaSincronizacionExitosa) {
      const ultimaExitosa = db.prepare(`
        SELECT fecha
        FROM sync_ejecucion
        WHERE exitosa = 1
        ORDER BY fecha DESC
        LIMIT 1
      `).get();
      if (ultimaExitosa) ultimaSincronizacionExitosa = `${ultimaExitosa.fecha}T00:00:00.000Z`;
    }

    res.json({
      ultimaFechaAsistencia: rangos.asistencia.hasta || null,
      ultimaFechaAtrasos: rangos.atrasos.hasta || null,
      ultimaSincronizacionExitosa,
    });
  } catch (error) {
    console.error('Error al consultar estado de auditoría:', error.message);
    res.status(500).json({ error: 'No se pudo consultar el estado de los datos.' });
  }
});

router.get('/prioridad', (req, res) => {
  try {
    const tipo = normalizarTipo(req.query.tipo);
    const rango = resolverRango(db, req.query);
    const base = metadata(rango, tipo);
    if (!rango.elegido?.desde || !rango.elegido?.hasta) {
      return res.json({
        ...base,
        resumen: { incidencias: 0, sinJustificar: 0, alumnosAfectados: 0 },
        alumnos: [],
      });
    }

    const filtros = { ...rango.elegido, curso: req.query.curso, tipo };
    const incidentes = obtenerIncidentes(db, filtros);
    const registros = obtenerRegistrosAsistencia(db, filtros);
    const rachas = calcularRachaAusencias(registros);
    const alumnos = new Map();
    const recienteDesde = sumarDias(rango.elegido.hasta, -(DIAS_TENDENCIA_RECIENTE - 1));

    for (const incidente of incidentes) {
      if (!alumnos.has(incidente.rut)) {
        alumnos.set(incidente.rut, {
          rut: incidente.rut,
          nombres: incidente.nombres,
          apellidos: incidente.apellidos,
          curso: incidente.curso,
          componentes: {
            inasistenciasSinJustificar: 0,
            atrasosSinJustificar: 0,
            ausenciasConsecutivas: 0,
            tendenciaReciente: 0,
          },
        });
      }
      const alumno = alumnos.get(incidente.rut);
      if (!incidente.justificado && incidente.tipo === 'inasistencia') {
        alumno.componentes.inasistenciasSinJustificar += 1;
      }
      if (!incidente.justificado && incidente.tipo === 'atraso') {
        alumno.componentes.atrasosSinJustificar += 1;
      }
      if (!incidente.justificado && incidente.fecha >= recienteDesde) {
        alumno.componentes.tendenciaReciente += 1;
      }
    }

    const ranking = [...alumnos.values()].map((alumno) => {
      alumno.componentes.ausenciasConsecutivas = rachas.get(`${alumno.rut}::${alumno.curso}`) || 0;
      const c = alumno.componentes;
      alumno.puntaje = c.inasistenciasSinJustificar * PESO_INASISTENCIA
        + c.atrasosSinJustificar * PESO_ATRASO
        + c.ausenciasConsecutivas * PESO_RACHA_AUSENCIAS
        + c.tendenciaReciente * PESO_TENDENCIA;
      const motivos = [];
      if (c.inasistenciasSinJustificar) motivos.push(`${c.inasistenciasSinJustificar} inasistencia(s) sin justificar`);
      if (c.atrasosSinJustificar) motivos.push(`${c.atrasosSinJustificar} atraso(s) sin justificar`);
      if (c.ausenciasConsecutivas) motivos.push(`racha máxima de ${c.ausenciasConsecutivas} ausencia(s)`);
      if (c.tendenciaReciente) motivos.push(`${c.tendenciaReciente} incidencia(s) reciente(s)`);
      alumno.motivo = motivos.join('; ');
      return alumno;
    }).sort((a, b) => b.puntaje - a.puntaje || a.apellidos.localeCompare(b.apellidos));

    res.json({
      ...base,
      resumen: {
        incidencias: incidentes.length,
        sinJustificar: incidentes.filter((incidente) => !incidente.justificado).length,
        alumnosAfectados: new Set(incidentes.filter((incidente) => !incidente.justificado).map((incidente) => incidente.rut)).size,
      },
      alumnos: ranking,
    });
  } catch (error) {
    console.error('Error en auditoría de prioridad:', error.message);
    res.status(500).json({ error: 'No se pudo calcular la prioridad.' });
  }
});

router.get('/cursos', (req, res) => {
  try {
    const tipo = normalizarTipo(req.query.tipo);
    const rango = resolverRango(db, req.query);
    const base = metadata(rango, tipo);
    if (!rango.elegido?.desde || !rango.elegido?.hasta) {
      return res.json({
        ...base,
        resumen: { incidencias: 0, sinJustificar: 0, alumnosAfectados: 0 },
        cursos: [],
      });
    }

    const filtros = { ...rango.elegido, tipo };
    const incidentes = obtenerIncidentes(db, filtros);
    const registros = obtenerRegistrosAsistencia(db, filtros);
    const cursos = db.prepare(`
      SELECT c.nombre AS curso, COUNT(DISTINCT m.rut_alumno) AS alumnosMatriculados
      FROM curso c
      JOIN matricula m ON m.id_curso = c.id_curso
      WHERE m.anio = (SELECT MAX(anio) FROM matricula)
      GROUP BY c.id_curso, c.nombre
      ORDER BY c.nombre
    `).all();
    const porCurso = new Map(cursos.map((curso) => [curso.curso, {
      ...curso,
      diasRegistrados: new Set(),
      incidentes: [],
    }]));

    for (const registro of registros) porCurso.get(registro.curso)?.diasRegistrados.add(registro.fecha);
    for (const incidente of incidentes) {
      if (!porCurso.has(incidente.curso)) continue;
      porCurso.get(incidente.curso).incidentes.push(incidente);
    }

    const resumenes = [...porCurso.values()].map((curso) => {
      const diasRegistrados = curso.diasRegistrados.size;
      const denominador = diasRegistrados * curso.alumnosMatriculados;
      const ausencias = curso.incidentes.filter((i) => i.tipo === 'inasistencia').length;
      const atrasos = curso.incidentes.filter((i) => i.tipo === 'atraso').length;
      const sinJustificar = curso.incidentes.filter((i) => !i.justificado).length;
      const porcentaje = (valor) => denominador ? Number((valor / denominador * 100).toFixed(1)) : null;
      return {
        curso: curso.curso,
        alumnosMatriculados: curso.alumnosMatriculados,
        diasRegistrados,
        denominador,
        pocosDatos: diasRegistrados < MIN_DIAS_REGISTRADOS,
        ausencias,
        atrasos,
        incidencias: curso.incidentes.length,
        sinJustificar,
        alumnosAfectados: new Set(curso.incidentes.filter((i) => !i.justificado).map((i) => i.rut)).size,
        porcentajeInasistencia: porcentaje(ausencias),
        porcentajeAtrasos: porcentaje(atrasos),
        porcentajeSinJustificar: curso.incidentes.length
          ? Number((sinJustificar / curso.incidentes.length * 100).toFixed(1))
          : null,
      };
    });

    const totalDenominador = resumenes.reduce((total, curso) => total + curso.denominador, 0);
    const totalAusencias = resumenes.reduce((total, curso) => total + curso.ausencias, 0);
    const promedioGeneral = totalDenominador ? totalAusencias / totalDenominador * 100 : null;
    for (const curso of resumenes) {
      curso.desviacionPromedio = promedioGeneral == null || curso.porcentajeInasistencia == null
        ? null
        : Number((curso.porcentajeInasistencia - promedioGeneral).toFixed(1));
    }

    const resumenGeneral = {
      incidencias: resumenes.reduce((total, curso) => total + curso.incidencias, 0),
      sinJustificar: resumenes.reduce((total, curso) => total + curso.sinJustificar, 0),
      alumnosAfectados: new Set(incidentes.filter((i) => !i.justificado).map((i) => i.rut)).size,
    };

    res.json({
      ...base,
      umbralDiasRegistrados: MIN_DIAS_REGISTRADOS,
      promedioGeneralInasistencia: promedioGeneral == null ? null : Number(promedioGeneral.toFixed(1)),
      resumen: resumenGeneral,
      cursos: resumenes,
    });
  } catch (error) {
    console.error('Error en comparación de cursos:', error.message);
    res.status(500).json({ error: 'No se pudo comparar los cursos.' });
  }
});

module.exports = router;
