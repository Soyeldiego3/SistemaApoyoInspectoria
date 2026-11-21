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

const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const INICIO_ANIO_ESCOLAR = 3; // marzo (1-based)

function fechaCorta(iso) {
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

// Meses del rango elegido (dentro del año escolar y hasta hoy) que no tienen ninguna fila
// de asistencia. Se mira mes a mes porque MIN/MAX no detecta huecos en medio.
function mesesSinAsistencia(db, elegido, hoy = new Date()) {
  if (!elegido?.desde || !elegido?.hasta) return [];
  const conDatos = new Set(db.prepare(`
    SELECT DISTINCT substr(fecha, 1, 7) AS mes FROM asistencia
  `).all().map((fila) => fila.mes));
  const limite = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  let [anio, mes] = elegido.desde.split('-').map(Number);
  const [anioFin, mesFin] = elegido.hasta.split('-').map(Number);
  const faltantes = [];
  while (anio < anioFin || (anio === anioFin && mes <= mesFin)) {
    const clave = `${anio}-${String(mes).padStart(2, '0')}`;
    if (clave > limite) break;
    if (mes >= INICIO_ANIO_ESCOLAR && !conDatos.has(clave)) faltantes.push(clave);
    mes += 1;
    if (mes > 12) { mes = 1; anio += 1; }
  }
  return faltantes;
}

function describirMeses(meses) {
  const nombre = (clave) => NOMBRES_MES[Number(clave.slice(5, 7)) - 1];
  if (meses.length === 1) return nombre(meses[0]);
  return `${nombre(meses[0])} a ${nombre(meses.at(-1))}`;
}

function resolverRango(db, { desde, hasta, tipo }) {
  const tipoNormalizado = normalizarTipo(tipo);
  const fuentes = obtenerRangosFuentes(db);
  const sugerido = rangoPorTipo(fuentes, tipoNormalizado);
  const elegido = desde && hasta ? { desde, hasta } : sugerido;
  const advertencias = [];
  // Datos estructurados para que el front ofrezca descargar lo que falta (asistencia)
  // o explique el límite del portal (atrasos).
  const faltantes = { asistencia: null, atrasos: null };
  const fuentesUsadas = tipoNormalizado === 'ambos'
    ? ['asistencia', 'atrasos']
    : [tipoNormalizado === 'inasistencias' ? 'asistencia' : 'atrasos'];

  for (const fuente of fuentesUsadas) {
    const rangoFuente = fuentes[fuente];
    if (fuente === 'asistencia') {
      const meses = mesesSinAsistencia(db, elegido);
      if (meses.length) {
        faltantes.asistencia = { meses, desde: `${meses[0]}-01`, hasta: elegido.hasta };
        advertencias.push(`Falta descargar la asistencia de ${describirMeses(meses)}.`);
      } else if (!rangoFuente.desde) {
        advertencias.push('No hay datos de asistencia en la base.');
      }
      continue;
    }
    if (!rangoFuente.desde || !rangoFuente.hasta) {
      advertencias.push('No hay datos de atrasos en la base.');
    } else if (elegido?.desde && elegido.desde < rangoFuente.desde) {
      faltantes.atrasos = { desde: elegido.desde, hasta: rangoFuente.desde, disponibleDesde: rangoFuente.desde };
      advertencias.push(`El portal solo entrega atrasos desde el ${fechaCorta(rangoFuente.desde)}; antes de esa fecha solo se analizan inasistencias.`);
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
    faltantes,
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
    SELECT s.fecha, s.estado, a.rut, c.nombre AS curso,
      CASE WHEN s.estado IN ('A', 'F') AND ${sqlJustificado('a.rut', 's.fecha', 'inasistencia')}
        THEN 1 ELSE 0 END AS justificado
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
