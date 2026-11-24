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
  ASISTENCIA_MINIMA,
  ASISTENCIA_ALERTA,
  RACHA_ALTA,
  RECIENTES_MEDIA,
  ATRASOS_MEDIA,
  ATRASOS_ALTA,
  ALERTAS,
} = require('../config/auditoria');
const configuracion = require('../services/configuracion');
const { obtenerRangosFuentes } = require('../services/incidentes');
const { abrirDb } = require('../services/asistencia');
const {
  detectarAlertas, aplicarGestion, TIPOS_ALERTA, ESTADOS_GESTION,
} = require('../services/alertas');
const auditoriaSistema = require('../services/auditoria_sistema');

const router = express.Router();

const ORDEN_NIVEL = { alta: 0, media: 1, baja: 2 };

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
    faltantes: rango.faltantes,
    coberturaCompleta: rango.coberturaCompleta,
  };
}


function resumirAsistencia(registros) {
  const porAlumno = new Map();
  for (const registro of registros) {
    const clave = `${registro.rut}::${registro.curso}`;
    if (!porAlumno.has(clave)) porAlumno.set(clave, []);
    porAlumno.get(clave).push(registro);
  }
  const resultado = new Map();
  for (const [clave, filas] of porAlumno) {
    let actual = 0;
    let racha = 0;
    let presentes = 0;
    for (const fila of filas) {
      const falta = fila.estado === 'A' || fila.estado === 'F';
      // Igual que la ficha del alumno: todo día registrado que no es falta cuenta como asistido
      if (!falta) presentes += 1;
      if (falta && !fila.justificado) {
        actual += 1;
        racha = Math.max(racha, actual);
      } else {
        actual = 0;
      }
    }
    resultado.set(clave, { dias: filas.length, presentes, racha });
  }
  return resultado;
}

// Nivel de prioridad con reglas explicables. Devuelve el nivel y las razones que lo gatillan.
function calcularNivel(alumno, tipo) {
  const c = alumno.componentes;
  const razones = { alta: [], media: [] };
  const miraInasistencias = tipo !== 'atrasos';
  const miraAtrasos = tipo !== 'inasistencias';
  const asistenciaConfiable = alumno.diasRegistrados >= MIN_DIAS_REGISTRADOS;

  if (miraInasistencias && asistenciaConfiable && alumno.porcentajeAsistencia != null) {
    if (alumno.porcentajeAsistencia < ASISTENCIA_MINIMA) {
      razones.alta.push(`Asistencia del año menor a ${ASISTENCIA_MINIMA}%`);
    } else if (alumno.porcentajeAsistencia < ASISTENCIA_ALERTA) {
      razones.media.push(`Asistencia del año menor a ${ASISTENCIA_ALERTA}%`);
    }
  }
  if (miraInasistencias && c.ausenciasConsecutivas >= RACHA_ALTA) {
    razones.alta.push(`${c.ausenciasConsecutivas} faltas seguidas sin justificar`);
  }
  if (miraAtrasos && c.atrasosSinJustificar >= ATRASOS_ALTA) {
    razones.alta.push(`${c.atrasosSinJustificar} atrasos sin justificar`);
  } else if (miraAtrasos && c.atrasosSinJustificar >= ATRASOS_MEDIA) {
    razones.media.push(`${c.atrasosSinJustificar} atrasos sin justificar`);
  }
  if (c.tendenciaReciente >= RECIENTES_MEDIA) {
    const cuando = DIAS_TENDENCIA_RECIENTE === 7 ? 'en la última semana' : `en los últimos ${DIAS_TENDENCIA_RECIENTE} días`;
    razones.media.push(`${c.tendenciaReciente} faltas o atrasos sin justificar ${cuando}`);
  }

  if (razones.alta.length) return { nivel: 'alta', razonesNivel: razones.alta };
  if (razones.media.length) return { nivel: 'media', razonesNivel: razones.media };
  return { nivel: 'baja', razonesNivel: [] };
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

    // Último día con asistencia por clase (la tabla puede no existir en bases antiguas)
    let ultimaFechaClase = null;
    try {
      ultimaFechaClase = db.prepare('SELECT MAX(fecha) AS fecha FROM asistencia_clase').get()?.fecha || null;
    } catch {
      ultimaFechaClase = null;
    }

    res.json({
      ultimaFechaClase,
      primeraFechaAsistencia: rangos.asistencia.desde || null,
      ultimaFechaAsistencia: rangos.asistencia.hasta || null,
      ultimaFechaAtrasos: rangos.atrasos.hasta || null,
      // Meses (YYYY-MM) con asistencia o atrasos descargados, del más reciente al más antiguo
      mesesConDatos: db.prepare(`
        SELECT substr(fecha, 1, 7) AS mes FROM asistencia
        UNION
        SELECT substr(fecha, 1, 7) AS mes FROM atraso
        ORDER BY mes DESC
      `).all().map((fila) => fila.mes),
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
    const base = {
      ...metadata(rango, tipo),
      // Para que el front explique cómo se ordena la lista
      criterios: {
        pesos: {
          inasistencia: PESO_INASISTENCIA,
          atraso: PESO_ATRASO,
          racha: PESO_RACHA_AUSENCIAS,
          reciente: PESO_TENDENCIA,
        },
        asistenciaMinima: ASISTENCIA_MINIMA,
        asistenciaAlerta: ASISTENCIA_ALERTA,
        rachaAlta: RACHA_ALTA,
        recientesMedia: RECIENTES_MEDIA,
        atrasosMedia: ATRASOS_MEDIA,
        atrasosAlta: ATRASOS_ALTA,
        diasRecientes: DIAS_TENDENCIA_RECIENTE,
        minDiasRegistrados: MIN_DIAS_REGISTRADOS,
      },
    };
    const resumenVacio = {
      incidencias: 0, inasistencias: 0, atrasos: 0, sinJustificar: 0, alumnosAfectados: 0,
      niveles: { alta: 0, media: 0, baja: 0 },
    };
    if (!rango.elegido?.desde || !rango.elegido?.hasta) {
      return res.json({ ...base, resumen: resumenVacio, alumnos: [] });
    }

    const filtros = { ...rango.elegido, curso: req.query.curso, tipo };
    const incidentes = obtenerIncidentes(db, filtros);
    // La racha se mira en el período. El % de asistencia se calcula de dos formas:
    // - del mes: desde el día 1 del mes en que empieza el período (informativo)
    // - del año: desde el 1 de enero hasta el final del período (define la prioridad,
    //   porque el 85% mínimo para la promoción es anual)
    // Así "Hoy" o "Esta semana" no muestran 0% por un solo día.
    const asistenciaPeriodo = resumirAsistencia(obtenerRegistrosAsistencia(db, filtros));
    const inicioMes = `${rango.elegido.desde.slice(0, 7)}-01`;
    const inicioAnio = `${rango.elegido.hasta.slice(0, 4)}-01-01`;
    const asistenciaMes = resumirAsistencia(obtenerRegistrosAsistencia(db, { ...filtros, desde: inicioMes }));
    const asistenciaAnio = resumirAsistencia(obtenerRegistrosAsistencia(db, { ...filtros, desde: inicioAnio }));
    Object.assign(base.criterios, { mesDesde: inicioMes, anioDesde: inicioAnio, hasta: rango.elegido.hasta });
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
      const vacio = { dias: 0, presentes: 0, racha: 0 };
      const clave = `${alumno.rut}::${alumno.curso}`;
      const periodo = asistenciaPeriodo.get(clave) || vacio;
      const mes = asistenciaMes.get(clave) || vacio;
      const anio = asistenciaAnio.get(clave) || vacio;
      const porcentaje = (r) => (r.dias ? Number((r.presentes / r.dias * 100).toFixed(1)) : null);
      alumno.componentes.ausenciasConsecutivas = periodo.racha;
      // porcentajeAsistencia/diasRegistrados = del año (los usa calcularNivel)
      alumno.diasRegistrados = anio.dias;
      alumno.porcentajeAsistencia = porcentaje(anio);
      alumno.diasMes = mes.dias;
      alumno.porcentajeMes = porcentaje(mes);
      const c = alumno.componentes;
      alumno.puntaje = c.inasistenciasSinJustificar * PESO_INASISTENCIA
        + c.atrasosSinJustificar * PESO_ATRASO
        + c.ausenciasConsecutivas * PESO_RACHA_AUSENCIAS
        + c.tendenciaReciente * PESO_TENDENCIA;
      Object.assign(alumno, calcularNivel(alumno, tipo));
      const motivos = [];
      if (c.inasistenciasSinJustificar) motivos.push(`${c.inasistenciasSinJustificar} inasistencia(s) sin justificar`);
      if (c.atrasosSinJustificar) motivos.push(`${c.atrasosSinJustificar} atraso(s) sin justificar`);
      if (c.ausenciasConsecutivas) motivos.push(`racha máxima de ${c.ausenciasConsecutivas} ausencia(s) sin justificar`);
      if (c.tendenciaReciente) motivos.push(`${c.tendenciaReciente} incidencia(s) reciente(s)`);
      alumno.motivo = motivos.join('; ');
      return alumno;
    }).sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]
      || b.puntaje - a.puntaje
      || a.apellidos.localeCompare(b.apellidos));

    const sinJustificar = incidentes.filter((incidente) => !incidente.justificado);
    res.json({
      ...base,
      resumen: {
        incidencias: incidentes.length,
        inasistencias: incidentes.filter((i) => i.tipo === 'inasistencia').length,
        atrasos: incidentes.filter((i) => i.tipo === 'atraso').length,
        sinJustificar: sinJustificar.length,
        alumnosAfectados: new Set(sinJustificar.map((incidente) => incidente.rut)).size,
        niveles: {
          alta: ranking.filter((a) => a.nivel === 'alta').length,
          media: ranking.filter((a) => a.nivel === 'media').length,
          baja: ranking.filter((a) => a.nivel === 'baja').length,
        },
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
      inasistencias: resumenes.reduce((total, curso) => total + curso.ausencias, 0),
      atrasos: resumenes.reduce((total, curso) => total + curso.atrasos, 0),
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

// ---- Alertas de patrones ----

// Conexión escribible solo para la gestión de alertas; también asegura que la tabla exista.
let dbWritable;
function obtenerDbWritable() {
  if (!dbWritable) dbWritable = abrirDb();
  return dbWritable;
}

function leerGestiones() {
  return obtenerDbWritable().prepare('SELECT * FROM alerta_gestion').all();
}

function calcularAlertas(query) {
  const rango = resolverRango(db, { ...query, tipo: 'inasistencias' });
  const { alertas, datosSuficientes, diasConDatos } = rango.elegido?.desde
    ? detectarAlertas(db, { ...rango.elegido, curso: query.curso })
    : { alertas: [], datosSuficientes: false, diasConDatos: 0 };
  return { rango, alertas: aplicarGestion(alertas, leerGestiones()), datosSuficientes, diasConDatos };
}

router.get('/alertas', (req, res) => {
  try {
    const { rango, alertas, datosSuficientes, diasConDatos } = calcularAlertas(req.query);
    const porTipo = Object.fromEntries(TIPOS_ALERTA.map((t) => [t, alertas.filter((a) => a.tipo === t).length]));
    res.json({
      ...metadata(rango, 'inasistencias'),
      datosSuficientes,
      diasConDatos,
      minDiasRango: ALERTAS.minDiasRango,
      resumen: {
        total: alertas.length,
        nuevas: alertas.filter((a) => a.estado === 'nueva').length,
        gestionadas: alertas.filter((a) => a.estado !== 'nueva').length,
        porTipo,
      },
      alertas,
    });
  } catch (error) {
    console.error('Error al calcular alertas:', error.message);
    res.status(500).json({ error: 'No se pudieron calcular las alertas.' });
  }
});

// Alertas nuevas del rango pedido (el menú pide "este mes"); sin rango, todo lo que haya
router.get('/alertas/conteo', (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const { alertas } = calcularAlertas(desde && hasta ? { desde, hasta } : {});
    res.json({ nuevas: alertas.filter((a) => a.estado === 'nueva').length });
  } catch (error) {
    console.error('Error al contar alertas:', error.message);
    res.status(500).json({ error: 'No se pudieron contar las alertas.' });
  }
});

const CLAVE_ALERTA = new RegExp(`^([0-9kK.-]{3,15}):(${TIPOS_ALERTA.join('|')})(?::[0-9]{1,4})?$`);

router.put('/alertas/:clave', (req, res) => {
  try {
    const { clave } = req.params;
    const coincidencia = CLAVE_ALERTA.exec(clave);
    if (!coincidencia) return res.status(400).json({ error: 'Alerta inválida.' });
    const { estado = null, nota = '' } = req.body ?? {};
    if (estado !== null && !ESTADOS_GESTION.includes(estado)) {
      return res.status(400).json({ error: 'Estado de alerta inválido.' });
    }
    if (typeof nota !== 'string' || nota.length > 500) {
      return res.status(400).json({ error: 'La nota debe tener como máximo 500 caracteres.' });
    }
    const conexion = obtenerDbWritable();
    if (estado === null) {
      conexion.prepare('DELETE FROM alerta_gestion WHERE clave = ?').run(clave);
    } else {
      conexion.prepare(`
        INSERT INTO alerta_gestion (clave, rut, estado, nota, actualizado_en, usuario)
        VALUES (@clave, @rut, @estado, @nota, @actualizado_en, @usuario)
        ON CONFLICT(clave) DO UPDATE SET estado = excluded.estado, nota = excluded.nota,
          actualizado_en = excluded.actualizado_en, usuario = excluded.usuario
      `).run({
        clave,
        rut: coincidencia[1],
        estado,
        nota: nota.trim() || null,
        actualizado_en: new Date().toISOString(),
        usuario: req.usuario?.nombre || null,
      });
    }
    try {
      auditoriaSistema.registrar('auditoria.alerta_gestionada', req.usuario?.nombre, { clave, estado });
    } catch (error) {
      console.error('No se pudo registrar la gestión de la alerta:', error.message);
    }
    const gestion = conexion.prepare('SELECT * FROM alerta_gestion WHERE clave = ?').get(clave) || null;
    res.json({ ok: true, gestion });
  } catch (error) {
    console.error('Error al gestionar alerta:', error.message);
    res.status(500).json({ error: 'No se pudo guardar la gestión de la alerta.' });
  }
});

module.exports = router;
