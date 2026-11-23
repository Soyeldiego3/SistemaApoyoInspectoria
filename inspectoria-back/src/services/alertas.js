// Alertas de patrones de inasistencia (Auditar → Alertas).
//
// Detecta, por alumno y dentro de un rango:
// - mismo_dia: falta casi siempre el mismo día de la semana
// - fin_de_semana: sus faltas se pegan a fines de semana o días sin clases ("puentes")
// - licencias: muchas licencias médicas aprobadas (o varias de un solo día)
// - caida: su asistencia de las últimas semanas cayó respecto al resto del rango
//
// Las faltas justificadas también cuentan para los patrones de calendario: el patrón
// existe igual; en el detalle se indica cuántas están justificadas.

const { obtenerRegistrosAsistencia } = require('./incidentes');
const { codigoDeTipo, CODIGOS } = require('./justificativos');
const { ALERTAS } = require('../config/auditoria');

const TIPOS_ALERTA = ['mismo_dia', 'fin_de_semana', 'licencias', 'caida'];
const ESTADOS_GESTION = ['revisada', 'citado', 'descartada'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
const CODIGO_LICENCIA = Number(Object.entries(CODIGOS).find(([, texto]) => texto.includes('LICENCIA'))[0]);

// 'YYYY-MM-DD' utilidades en UTC (sin desfases de zona horaria)
function aFecha(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
const aIso = (fecha) => fecha.toISOString().slice(0, 10);
function sumarDias(iso, n) {
  const fecha = aFecha(iso);
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return aIso(fecha);
}
const diaSemana = (iso) => aFecha(iso).getUTCDay();
const esFalta = (registro) => registro.estado === 'A' || registro.estado === 'F';
const pct = (parte, total) => (total ? Math.round(parte / total * 100) : 0);
const maxFecha = (fechas) => fechas.reduce((max, f) => (f > max ? f : max), '');

function clave(rut, tipo, variante) {
  return variante == null ? `${rut}:${tipo}` : `${rut}:${tipo}:${variante}`;
}

// Días de clase del colegio: días con alguna fila de asistencia (cualquier curso).
// Un día de semana sin filas, dentro del período con datos, se toma como "sin clases"
// (feriado o interferiado). Fuera del período con datos no se sabe, así que se asume
// que hubo clases para no inventar puentes en los bordes.
function calendarioClases(db) {
  const dias = new Set(db.prepare('SELECT DISTINCT fecha FROM asistencia').all().map((f) => f.fecha));
  const fechas = [...dias].sort();
  const primero = fechas[0];
  const ultimo = fechas.at(-1);
  const hayClases = (iso) => {
    const dia = diaSemana(iso);
    if (dia === 0 || dia === 6) return false;
    if (!primero || iso < primero || iso > ultimo) return true;
    return dias.has(iso);
  };
  return { dias, hayClases, ultimo };
}

function nombreAlumno(alumnos, rut) {
  return alumnos.get(rut) || { nombres: '', apellidos: rut };
}

function detectarMismoDia(rut, filas) {
  const umbral = ALERTAS.mismoDia;
  const faltas = filas.filter(esFalta);
  if (faltas.length < umbral.minFaltas) return null;
  const registrosPorDia = new Map();
  const faltasPorDia = new Map();
  for (const fila of filas) {
    const dia = diaSemana(fila.fecha);
    registrosPorDia.set(dia, (registrosPorDia.get(dia) || 0) + 1);
    if (esFalta(fila)) {
      if (!faltasPorDia.has(dia)) faltasPorDia.set(dia, []);
      faltasPorDia.get(dia).push(fila);
    }
  }
  const [dia, delDia] = [...faltasPorDia.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const n = delDia.length;
  if (n < umbral.minEseDia || n / faltas.length < umbral.proporcion) return null;
  const tasaDia = n / registrosPorDia.get(dia);
  const otrosRegistros = filas.length - registrosPorDia.get(dia);
  const tasaOtros = otrosRegistros ? (faltas.length - n) / otrosRegistros : 0;
  if (tasaOtros > 0 && tasaDia < umbral.factor * tasaOtros) return null;
  const justificadas = delDia.filter((f) => f.justificado).length;
  return {
    clave: clave(rut, 'mismo_dia', dia),
    tipo: 'mismo_dia',
    prioridad: n >= umbral.alta ? 'alta' : 'media',
    titulo: `${n} de sus ${faltas.length} faltas fueron un ${DIAS[dia]}`,
    detalle: `Faltó el ${pct(n, registrosPorDia.get(dia))}% de los ${DIAS_PLURAL[dia]} con clases`
      + ` y el ${pct(faltas.length - n, otrosRegistros)}% del resto de los días.`
      + (justificadas ? ` ${justificadas} de esas faltas están justificadas.` : ''),
    evidencia: delDia.map((f) => f.fecha),
  };
}

function detectarFinDeSemana(rut, filas, calendario, fechasMismoDia) {
  const umbral = ALERTAS.finDeSemana;
  const faltas = filas.filter(esFalta);
  if (faltas.length < umbral.minFaltas) return null;
  const pegadas = faltas.filter((f) => !calendario.hayClases(sumarDias(f.fecha, -1))
    || !calendario.hayClases(sumarDias(f.fecha, 1)));
  if (pegadas.length < umbral.minFaltas || pegadas.length / faltas.length < umbral.proporcion) return null;
  // Si todas ya las explica "falta siempre el mismo día" (p. ej. solo lunes), no se repite
  if (pegadas.every((f) => fechasMismoDia.has(f.fecha))) return null;
  const feriados = pegadas.filter((f) => {
    const dia = diaSemana(f.fecha);
    return dia !== 1 && dia !== 5;
  }).length;
  const justificadas = pegadas.filter((f) => f.justificado).length;
  return {
    clave: clave(rut, 'fin_de_semana'),
    tipo: 'fin_de_semana',
    prioridad: 'media',
    titulo: `${pegadas.length} de sus ${faltas.length} faltas fueron justo antes o después de un fin de semana o feriado`,
    detalle: (feriados ? `${feriados} junto a feriados o interferiados. ` : '')
      + (justificadas ? `${justificadas} de esas faltas están justificadas.` : 'Ninguna está justificada.'),
    evidencia: pegadas.map((f) => f.fecha),
  };
}

function detectarCaida(rut, filas, referencia) {
  const umbral = ALERTAS.caida;
  if (filas.length < umbral.minDiasRango) return null;
  const desdeReciente = sumarDias(referencia, -(umbral.diasRecientes - 1));
  const recientes = filas.filter((f) => f.fecha >= desdeReciente && f.fecha <= referencia);
  const anteriores = filas.filter((f) => f.fecha < desdeReciente);
  if (recientes.length < umbral.minDiasRecientes || anteriores.length < umbral.minDiasRecientes) return null;
  const asistencia = (lista) => lista.filter((f) => f.estado === 'P').length / lista.length * 100;
  const antes = asistencia(anteriores);
  const ahora = asistencia(recientes);
  if (antes - ahora < umbral.puntos) return null;
  const semanas = Math.round(umbral.diasRecientes / 7);
  return {
    clave: clave(rut, 'caida'),
    tipo: 'caida',
    prioridad: 'alta',
    titulo: `Su asistencia bajó de ${Math.round(antes)}% a ${Math.round(ahora)}% en las últimas ${semanas} semanas`,
    detalle: `${recientes.filter(esFalta).length} faltas en los últimos ${umbral.diasRecientes} días`
      + ` (hasta el ${referencia.split('-').reverse().join('-')}).`,
    evidencia: recientes.filter(esFalta).map((f) => f.fecha),
  };
}

// Licencias médicas aprobadas que se cruzan con el rango (persisten aunque se borre la asistencia)
function detectarLicencias(db, { desde, hasta, curso }) {
  const umbral = ALERTAS.licencias;
  const filas = db.prepare(`
    SELECT j.rut_alumno AS rut, j.tipo_documento, j.fecha_inicio, j.fecha_fin,
      a.nombres, a.apellidos,
      (SELECT c.nombre FROM matricula m JOIN curso c ON c.id_curso = m.id_curso
        WHERE m.rut_alumno = j.rut_alumno ORDER BY m.anio DESC LIMIT 1) AS curso
    FROM justificativo j
    JOIN alumno a ON a.rut = j.rut_alumno
    WHERE j.estado_documento = 'APROBADO'
      AND (j.aplica_a IS NULL OR j.aplica_a = 'inasistencia')
      AND j.fecha_inicio <= @hasta AND j.fecha_fin >= @desde
    ORDER BY j.fecha_inicio
  `).all({ desde, hasta });

  const porAlumno = new Map();
  for (const fila of filas) {
    if (codigoDeTipo(fila.tipo_documento) !== CODIGO_LICENCIA) continue;
    if (!fila.curso || (curso && fila.curso !== curso)) continue;
    if (!porAlumno.has(fila.rut)) porAlumno.set(fila.rut, []);
    porAlumno.get(fila.rut).push(fila);
  }

  const alertas = [];
  for (const [rut, licencias] of porAlumno) {
    const duracion = (l) => Math.round((aFecha(l.fecha_fin) - aFecha(l.fecha_inicio)) / 86400000) + 1;
    const cortas = licencias.filter((l) => duracion(l) <= umbral.diasCorta).length;
    if (licencias.length < umbral.minLicencias && cortas < umbral.minCortas) continue;
    const dias = licencias.reduce((total, l) => total + duracion(l), 0);
    const { nombres, apellidos, curso: cursoAlumno } = licencias[0];
    alertas.push({
      clave: clave(rut, 'licencias', hasta.slice(0, 4)),
      tipo: 'licencias',
      prioridad: licencias.length >= umbral.alta ? 'alta' : 'media',
      rut, nombres, apellidos, curso: cursoAlumno,
      titulo: `${licencias.length} licencia${licencias.length === 1 ? '' : 's'} médica${licencias.length === 1 ? '' : 's'}`
        + (cortas ? ` (${cortas} de ${umbral.diasCorta === 1 ? '1 día' : `hasta ${umbral.diasCorta} días`})` : ''),
      detalle: `Cubren ${dias} día${dias === 1 ? '' : 's'} en total.`
        + (cortas >= umbral.minCortas ? ' Varias licencias cortas pueden merecer una conversación con el apoderado.' : ''),
      evidencia: licencias.map((l) => l.fecha_inicio),
    });
  }
  return alertas;
}

// Devuelve { alertas, datosSuficientes, diasConDatos }
function detectarAlertas(db, { desde, hasta, curso }) {
  if (!desde || !hasta) return { alertas: [], datosSuficientes: false, diasConDatos: 0 };
  const calendario = calendarioClases(db);
  const diasConDatos = [...calendario.dias].filter((d) => d >= desde && d <= hasta).length;
  const datosSuficientes = diasConDatos >= ALERTAS.minDiasRango;
  const alumnos = new Map(db.prepare('SELECT rut, nombres, apellidos FROM alumno').all().map((a) => [a.rut, a]));
  const alertas = [];

  if (datosSuficientes) {
    const referencia = hasta < calendario.ultimo ? hasta : calendario.ultimo;
    const porAlumno = new Map();
    for (const registro of obtenerRegistrosAsistencia(db, { desde, hasta, curso })) {
      const k = `${registro.rut}::${registro.curso}`;
      if (!porAlumno.has(k)) porAlumno.set(k, { rut: registro.rut, curso: registro.curso, filas: [] });
      porAlumno.get(k).filas.push(registro);
    }
    for (const { rut, curso: cursoAlumno, filas } of porAlumno.values()) {
      const base = { rut, curso: cursoAlumno, ...nombreAlumno(alumnos, rut) };
      const mismoDia = detectarMismoDia(rut, filas);
      const fechasMismoDia = new Set(mismoDia?.evidencia || []);
      for (const alerta of [
        mismoDia,
        detectarFinDeSemana(rut, filas, calendario, fechasMismoDia),
        detectarCaida(rut, filas, referencia),
      ]) {
        if (alerta) alertas.push({ ...base, ...alerta });
      }
    }
  }
  // Las licencias no dependen del calendario de asistencia
  alertas.push(...detectarLicencias(db, { desde, hasta, curso }));

  for (const alerta of alertas) {
    alerta.evidencia.sort();
    alerta.ultimaEvidencia = maxFecha(alerta.evidencia);
    alerta.nombres = alerta.nombres ?? '';
  }
  return { alertas, datosSuficientes, diasConDatos };
}

// Cruza las alertas con su gestión. Una alerta gestionada vuelve a "nueva" si aparece
// evidencia posterior a la fecha en que se gestionó.
function aplicarGestion(alertas, gestiones) {
  const porClave = new Map(gestiones.map((g) => [g.clave, g]));
  const orden = { alta: 0, media: 1 };
  return alertas.map((alerta) => {
    const gestion = porClave.get(alerta.clave) || null;
    if (!gestion) return { ...alerta, estado: 'nueva', gestion: null, casosNuevos: 0 };
    // Fecha local del PC (actualizado_en está en UTC; de noche en Chile ya sería "mañana")
    const momento = new Date(gestion.actualizado_en);
    const desdeGestion = `${momento.getFullYear()}-${String(momento.getMonth() + 1).padStart(2, '0')}-${String(momento.getDate()).padStart(2, '0')}`;
    const casosNuevos = alerta.evidencia.filter((fecha) => fecha > desdeGestion).length;
    return {
      ...alerta,
      estado: casosNuevos ? 'nueva' : gestion.estado,
      gestion,
      casosNuevos,
    };
  }).sort((a, b) => (a.estado === 'nueva' ? 0 : 1) - (b.estado === 'nueva' ? 0 : 1)
    || orden[a.prioridad] - orden[b.prioridad]
    || b.ultimaEvidencia.localeCompare(a.ultimaEvidencia));
}

module.exports = { detectarAlertas, aplicarGestion, TIPOS_ALERTA, ESTADOS_GESTION };
