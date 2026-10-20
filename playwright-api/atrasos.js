const { normalizarRut, normalizarCurso, separarNombre, transaccion } = require('./asistencia');

// "HORA DE LLEGADA" / "Sí" -> "hora de llegada" / "si" (sin tildes ni mayúsculas)
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Convierte la tabla HTML ya extraída por Playwright en objetos.
 * Entrada: { headers: string[], filas: string[][], totalDeclarado?: number }
 * Las columnas se buscan por NOMBRE, no por posición.
 */
function parsearAtrasos({ headers, filas, totalDeclarado = null }) {
  const idx = {};
  headers.forEach((h, i) => { idx[norm(h)] = i; });
  const requeridas = ['fecha', 'alumno', 'rut', 'curso', 'hora de llegada', 'justificado'];
  const faltan = requeridas.filter(k => !(k in idx));
  if (faltan.length) throw new Error('Columnas no encontradas en Atrasos: ' + faltan.join(', '));

  // Control de integridad: lo extraído debe coincidir con "N registros" que muestra la página
  if (totalDeclarado !== null && filas.length !== totalDeclarado)
    throw new Error(`La página declara ${totalDeclarado} registros pero se extrajeron ${filas.length} (¿paginación o scroll?)`);

  return filas.map((f, n) => {
    if (f.length < headers.length) throw new Error(`Fila ${n + 1} incompleta: ${JSON.stringify(f)}`);
    const fecha = String(f[idx.fecha]).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!fecha) throw new Error(`Fecha inválida en fila ${n + 1}: "${f[idx.fecha]}"`);
    const hora = String(f[idx['hora de llegada']]).trim();
    if (!/^\d{1,2}:\d{2}$/.test(hora)) throw new Error(`Hora inválida en fila ${n + 1}: "${hora}"`);
    const just = norm(f[idx.justificado]);
    if (just !== 'si' && just !== 'no') throw new Error(`Valor "justificado" desconocido en fila ${n + 1}: "${f[idx.justificado]}"`);
    return {
      fecha: `${fecha[3]}-${fecha[2]}-${fecha[1]}`,
      hora_llegada: hora.padStart(5, '0'),
      rut: normalizarRut(f[idx.rut]),
      ...separarNombre(f[idx.alumno]),
      curso: normalizarCurso(f[idx.curso]),
      justificado_portal: just === 'si' ? 1 : 0,
    };
  });
}

/**
 * La tabla del portal no trae un id estable, así que se REEMPLAZA el alcance pedido
 * (rango de fechas, y opcionalmente un curso) en una sola transacción. Es idempotente.
 */
function guardarAtrasos(db, atrasos, { desde, hasta, curso = null }) {
  const cursoN = curso ? normalizarCurso(curso) : null;
  const enAlcance = atrasos.filter(a =>
    a.fecha >= desde && a.fecha <= hasta && (!cursoN || a.curso === cursoN));

  const borrar = cursoN
    ? db.prepare(`DELETE FROM atraso WHERE fecha BETWEEN ? AND ? AND id_matricula IN (
        SELECT m.id_matricula FROM matricula m JOIN curso c ON c.id_curso = m.id_curso WHERE c.nombre = ?)`)
    : db.prepare(`DELETE FROM atraso WHERE fecha BETWEEN ? AND ?`);
  const upCurso = db.prepare(`INSERT INTO curso (nombre) VALUES (?) ON CONFLICT(nombre) DO NOTHING`);
  const getCurso = db.prepare(`SELECT id_curso FROM curso WHERE nombre = ?`);
  const upAlumno = db.prepare(`INSERT INTO alumno (rut, nombres, apellidos) VALUES (@rut, @nombres, @apellidos)
    ON CONFLICT(rut) DO UPDATE SET nombres = excluded.nombres, apellidos = excluded.apellidos`);
  const upMat = db.prepare(`INSERT INTO matricula (rut_alumno, id_curso, anio) VALUES (?, ?, ?)
    ON CONFLICT(rut_alumno, id_curso, anio) DO NOTHING`);
  const getMat = db.prepare(`SELECT id_matricula FROM matricula WHERE rut_alumno = ? AND id_curso = ? AND anio = ?`);
  const ins = db.prepare(`INSERT INTO atraso (id_matricula, fecha, hora_llegada, justificado_portal)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id_matricula, fecha, hora_llegada) DO UPDATE SET justificado_portal = excluded.justificado_portal`);

  return transaccion(db, () => {
    cursoN ? borrar.run(desde, hasta, cursoN) : borrar.run(desde, hasta);
    for (const a of enAlcance) {
      upCurso.run(a.curso);
      const { id_curso } = getCurso.get(a.curso);
      upAlumno.run({ rut: a.rut, nombres: a.nombres, apellidos: a.apellidos });
      const anio = +a.fecha.slice(0, 4);
      upMat.run(a.rut, id_curso, anio);
      const { id_matricula } = getMat.get(a.rut, id_curso, anio);
      ins.run(id_matricula, a.fecha, a.hora_llegada, a.justificado_portal);
    }
    return enAlcance.length;
  });
}

module.exports = { parsearAtrasos, guardarAtrasos };