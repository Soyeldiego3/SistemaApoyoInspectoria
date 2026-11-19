const { sqlJustificado } = require('./justificativos');

const TIPOS = new Set(['inasistencias', 'atrasos', 'ambos']);

function normalizarTipo(tipo) {
  return TIPOS.has(tipo) ? tipo : 'ambos';
}

function obtenerRangosFuentes(db) {
  return {
    asistencia: db.prepare(`
      SELECT MIN(fecha) AS desde, MAX(fecha) AS hasta, COUNT(*) AS registros
      FROM asistencia
    `).get(),
    atrasos: db.prepare(`
      SELECT MIN(fecha) AS desde, MAX(fecha) AS hasta, COUNT(*) AS registros
      FROM atraso
    `).get(),
  };
}

function interseccion(rangos) {
  const validos = rangos.filter((rango) => rango.desde && rango.hasta);
  if (!validos.length) return { desde: null, hasta: null };
  const desde = validos.reduce((max, rango) => (rango.desde > max ? rango.desde : max), validos[0].desde);
  const hasta = validos.reduce((min, rango) => (rango.hasta < min ? rango.hasta : min), validos[0].hasta);
  return desde <= hasta ? { desde, hasta } : { desde: null, hasta: null };
}

function rangoPorTipo(rangos, tipo) {
  if (tipo === 'inasistencias') return rangos.asistencia;
  if (tipo === 'atrasos') return rangos.atrasos;
  return interseccion([rangos.asistencia, rangos.atrasos]);
}

function resolverRango(db, { desde, hasta, tipo }) {
  const tipoNormalizado = normalizarTipo(tipo);
  const fuentes = obtenerRangosFuentes(db);
  const sugerido = rangoPorTipo(fuentes, tipoNormalizado);
  const elegido = desde && hasta ? { desde, hasta } : sugerido;
  const advertencias = [];
  const fuentesUsadas = tipoNormalizado === 'ambos'
    ? ['asistencia', 'atrasos']
    : [tipoNormalizado === 'inasistencias' ? 'asistencia' : 'atrasos'];

  for (const fuente of fuentesUsadas) {
    const rangoFuente = fuentes[fuente];
    if (!rangoFuente.desde || !rangoFuente.hasta) {
      advertencias.push(`No hay datos de ${fuente} en la base.`);
    } else if (elegido?.desde && elegido?.hasta &&
      (elegido.desde < rangoFuente.desde || elegido.hasta > rangoFuente.hasta)) {
      advertencias.push(`El rango elegido excede la cobertura disponible de ${fuente} (${rangoFuente.desde} a ${rangoFuente.hasta}).`);
    }
  }

  if (!elegido?.desde || !elegido?.hasta) {
    advertencias.push('No existe un rango común con datos suficientes para este tipo de análisis.');
  }

  return {
    tipo: tipoNormalizado,
    fuentes,
    sugerido,
    elegido,
    advertencias,
    coberturaCompleta: advertencias.length === 0,
  };
}

function obtenerIncidentes(db, { desde, hasta, curso, tipo }) {
  if (!desde || !hasta) return [];
  const condiciones = ['incidente.fecha BETWEEN @desde AND @hasta'];
  const parametros = { desde, hasta };
  if (curso) {
    condiciones.push('incidente.curso = @curso');
    parametros.curso = curso;
  }
  if (tipo && tipo !== 'ambos') {
    condiciones.push('incidente.tipo = @tipo');
    parametros.tipo = tipo === 'inasistencias' ? 'inasistencia' : 'atraso';
  }

  return db.prepare(`
    WITH incidentes AS (
      SELECT
        'inasistencia' AS tipo,
        s.fecha,
        s.estado,
        a.rut,
        a.nombres,
        a.apellidos,
        c.nombre AS curso,
        m.id_matricula,
        NULL AS hora_llegada,
        CASE WHEN ${sqlJustificado('a.rut', 's.fecha', 'inasistencia')} THEN 1 ELSE 0 END AS justificado
      FROM asistencia s
      JOIN matricula m ON m.id_matricula = s.id_matricula
      JOIN alumno a ON a.rut = m.rut_alumno
      JOIN curso c ON c.id_curso = m.id_curso
      WHERE s.estado IN ('A', 'F')

      UNION ALL

      SELECT
        'atraso' AS tipo,
        t.fecha,
        'T' AS estado,
        a.rut,
        a.nombres,
        a.apellidos,
        c.nombre AS curso,
        m.id_matricula,
        t.hora_llegada,
        CASE WHEN t.justificado_portal = 1 OR ${sqlJustificado('a.rut', 't.fecha', 'atraso')}
          THEN 1 ELSE 0 END AS justificado
      FROM atraso t
      JOIN matricula m ON m.id_matricula = t.id_matricula
      JOIN alumno a ON a.rut = m.rut_alumno
      JOIN curso c ON c.id_curso = m.id_curso
    )
    SELECT *
    FROM incidentes incidente
    WHERE ${condiciones.join(' AND ')}
    ORDER BY incidente.fecha, incidente.apellidos, incidente.nombres
  `).all(parametros);
}

function obtenerRegistrosAsistencia(db, { desde, hasta, curso }) {
  if (!desde || !hasta) return [];
  const condiciones = ['s.fecha BETWEEN @desde AND @hasta'];
  const parametros = { desde, hasta };
  if (curso) {
    condiciones.push('c.nombre = @curso');
    parametros.curso = curso;
  }
  return db.prepare(`
    SELECT s.fecha, s.estado, a.rut, c.nombre AS curso
    FROM asistencia s
    JOIN matricula m ON m.id_matricula = s.id_matricula
    JOIN alumno a ON a.rut = m.rut_alumno
    JOIN curso c ON c.id_curso = m.id_curso
    WHERE ${condiciones.join(' AND ')}
    ORDER BY s.fecha, a.rut
  `).all(parametros);
}

module.exports = {
  normalizarTipo,
  obtenerRangosFuentes,
  resolverRango,
  obtenerIncidentes,
  obtenerRegistrosAsistencia,
};
