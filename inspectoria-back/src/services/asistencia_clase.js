const { normalizarRut, normalizarCurso, separarNombre, transaccion, preparadorMatricula } = require('./asistencia');

// "Presente" / "ALUMNO" -> "presente" / "alumno" (sin tildes ni mayúsculas)
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function estadoDesde(texto) {
  const t = norm(texto);
  if (t.startsWith('present')) return 'P';
  if (t.startsWith('ausent')) return 'A';
  if (t.startsWith('atras')) return 'T';
  return null;
}

// "08:00 – 09:30" -> { hora_inicio: '08:00', hora_fin: '09:30' }
function parsearBloque(bloque) {
  const m = String(bloque).match(/(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/);
  if (!m) throw new Error(`Bloque inválido: "${bloque}"`);
  return {
    hora_inicio: `${m[1].padStart(2, '0')}:${m[2]}`,
    hora_fin: `${m[3].padStart(2, '0')}:${m[4]}`,
  };
}

// "20 presentes · 2 ausentes · 0 atrasos" -> { P: 20, A: 2, T: 0 } (null si no se puede leer)
function parsearResumen(resumen) {
  if (!resumen) return null;
  const texto = norm(resumen);
  const contar = (patron) => {
    const m = texto.match(patron);
    return m ? +m[1] : null;
  };
  const conteo = { P: contar(/(\d+)\s+present/), A: contar(/(\d+)\s+ausent/), T: contar(/(\d+)\s+atras/) };
  return Object.values(conteo).every((v) => v === null) ? null : conteo;
}

/**
 * Convierte la tabla HTML extraída por Playwright en objetos.
 * Entrada: { curso, fecha, bloque, headers, filas, resumen } (ver extraer_asistencia_clase.js)
 * Las columnas se buscan por NOMBRE, no por posición.
 */
function parsearAsistenciaClase({ curso, fecha, bloque, headers, filas, resumen = null }) {
  if (!FECHA_ISO.test(fecha || '')) throw new Error(`Fecha inválida: "${fecha}"`);
  const idx = {};
  headers.forEach((h, i) => { idx[norm(h)] = i; });
  const requeridas = ['alumno', 'rut', 'estado'];
  const faltan = requeridas.filter((k) => !(k in idx));
  if (faltan.length) throw new Error('Columnas no encontradas en Asistencia por clase: ' + faltan.join(', '));

  // Una fila de una sola celda es el mensaje "sin alumnos" de la tabla, no un alumno
  const datos = filas.filter((f) => f.length > 1);

  const alumnos = datos.map((f, n) => {
    if (f.length < headers.length) throw new Error(`Fila ${n + 1} incompleta: ${JSON.stringify(f)}`);
    const estado = estadoDesde(f[idx.estado]);
    if (!estado) throw new Error(`Estado desconocido en fila ${n + 1}: "${f[idx.estado]}"`);
    return { rut: normalizarRut(f[idx.rut]), ...separarNombre(f[idx.alumno]), estado };
  });

  // Control de integridad: lo extraído debe cuadrar con el resumen que muestra la página
  const declarado = parsearResumen(resumen);
  if (declarado) {
    for (const [estado, total] of Object.entries(declarado)) {
      if (total === null) continue;
      const contados = alumnos.filter((a) => a.estado === estado).length;
      if (contados !== total) {
        throw new Error(`El resumen declara ${total} "${estado}" pero se extrajeron ${contados} (${curso} ${fecha} ${bloque}).`);
      }
    }
  }

  return { curso: normalizarCurso(curso), fecha, ...parsearBloque(bloque), alumnos };
}

/** Reemplaza el alcance curso + fecha + bloque en una sola transacción. Devuelve las filas guardadas. */
function guardarAsistenciaClase(db, data, { transaccionar = true } = {}) {
  const anio = +data.fecha.slice(0, 4);
  const borrar = db.prepare(`DELETE FROM asistencia_clase
    WHERE fecha = ? AND hora_inicio = ? AND id_matricula IN (
      SELECT m.id_matricula FROM matricula m
      JOIN curso c ON c.id_curso = m.id_curso
      WHERE c.nombre = ? AND m.anio = ?
    )`);
  const ids = preparadorMatricula(db);
  const ins = db.prepare(`INSERT INTO asistencia_clase (id_matricula, fecha, hora_inicio, hora_fin, estado)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id_matricula, fecha, hora_inicio) DO UPDATE SET hora_fin = excluded.hora_fin, estado = excluded.estado`);

  const ejecutar = () => {
    borrar.run(data.fecha, data.hora_inicio, data.curso, anio);
    const idCurso = ids.curso(data.curso);
    for (const al of data.alumnos) {
      const id_matricula = ids.matricula(al, idCurso, anio);
      ins.run(id_matricula, data.fecha, data.hora_inicio, data.hora_fin, al.estado);
    }
    return data.alumnos.length;
  };
  return transaccionar ? transaccion(db, ejecutar) : ejecutar();
}

module.exports = { parsearAsistenciaClase, guardarAsistenciaClase, parsearBloque };
