// Justificativos de un alumno.
//
// Regla: cada fecha tiene a lo más UN justificativo por tipo de registro (inasistencia o
// atraso). Al guardar uno nuevo se sobrescriben (recortan o borran) los anteriores del
// mismo tipo que cubren esas fechas. Si el que queda es "NO SE HA JUSTIFICADO" (o no hay
// ninguno), la fecha cuenta como sin justificar. Ese texto se guarda igual que los demás
// para mantener el formato del portal al importar/exportar.
//
// aplica_a NULL = justificativo antiguo que cubre ambos tipos.

const SIN_JUSTIFICAR = 'NO SE HA JUSTIFICADO';
const TIPOS = ['inasistencia', 'atraso'];

// Códigos del "Master de registro" (columna COD). Los textos son los mismos que ofrece la
// app (JustifySheet.jsx); el Excel los escribe con otros acentos, por eso se cruza por código.
const CODIGOS = {
  1: SIN_JUSTIFICAR,
  2: 'EL APODERADO JUSTIFICA CON LICENCIA MÉDICA',
  3: 'EL APODERADO JUSTIFICA PERSONALMENTE',
  4: 'EL APODERADO JUSTIFICA CON CORREO ELECTRÓNICO',
  5: 'EL ALUMNO(A) INGRESA TARDE AL ESTABLECIMIENTO',
  6: 'SUSPENDIDO COMO ACCIÓN DISCIPLINARIA',
};
const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
// Texto de justificativo → código (1 si no tiene o no se reconoce)
function codigoDeTipo(tipo) {
  if (!tipo) return 1;
  const buscado = sinTildes(tipo);
  const par = Object.entries(CODIGOS).find(([, texto]) => sinTildes(texto) === buscado);
  return par ? Number(par[0]) : 1;
}

// tipo_documento del justificativo aprobado que cubre la fecha (o NULL). Si quedara más
// de uno, manda el más reciente. `rut` y `fecha` son expresiones SQL (columnas o
// parámetros con nombre); `tipo` es siempre una constante del código, nunca del usuario.
function sqlUltimoTipo(rut, fecha, tipo, campo = 'tipo_documento') {
  if (!TIPOS.includes(tipo)) throw new Error(`Tipo de registro desconocido: ${tipo}`);
  if (!['tipo_documento', 'observacion'].includes(campo)) throw new Error(`Campo desconocido: ${campo}`);
  return `(SELECT j.${campo} FROM justificativo j
      WHERE j.rut_alumno = ${rut} AND j.estado_documento = 'APROBADO'
        AND (j.aplica_a IS NULL OR j.aplica_a = '${tipo}')
        AND ${fecha} BETWEEN j.fecha_inicio AND j.fecha_fin
      ORDER BY j.id_justificativo DESC LIMIT 1)`;
}

function sqlJustificado(rut, fecha, tipo) {
  return `(COALESCE(${sqlUltimoTipo(rut, fecha, tipo)}, '${SIN_JUSTIFICAR}') <> '${SIN_JUSTIFICAR}')`;
}

// 'YYYY-MM-DD' ± n días
function sumarDias(fecha, n) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

// Quita de los demás justificativos del alumno las fechas [desde, hasta] para los tipos que
// cubre `nuevo`. Lo que queda fuera del rango se conserva; si un justificativo antiguo
// (ambos tipos) se cruza con uno de un solo tipo, en el cruce queda solo para el otro tipo.
// `excluir`: ids que no se tocan (el propio `nuevo` y, en la limpieza, los más nuevos).
function recortarSuperpuestos(db, nuevo, excluir = new Set([nuevo.id_justificativo])) {
  const otros = db.prepare(`
    SELECT * FROM justificativo
    WHERE rut_alumno = @rut AND estado_documento = 'APROBADO'
      AND fecha_inicio <= @hasta AND fecha_fin >= @desde
      AND (@aplica IS NULL OR aplica_a IS NULL OR aplica_a = @aplica)
  `).all({ rut: nuevo.rut_alumno, desde: nuevo.fecha_inicio, hasta: nuevo.fecha_fin, aplica: nuevo.aplica_a });

  const borrar = db.prepare('DELETE FROM justificativo WHERE id_justificativo = ?');
  const actualizar = db.prepare(`
    UPDATE justificativo SET fecha_inicio = @ini, fecha_fin = @fin, aplica_a = @aplica
    WHERE id_justificativo = @id
  `);
  const insertar = db.prepare(`
    INSERT INTO justificativo
      (rut_alumno, tipo_documento, fecha_inicio, fecha_fin, estado_documento, duracion_ms, creado_en, aplica_a, observacion)
    VALUES (@rut_alumno, @tipo_documento, @ini, @fin, @estado_documento, NULL, @creado_en, @aplica, @observacion)
  `);

  let cambios = 0;
  for (const j of otros) {
    if (excluir.has(j.id_justificativo)) continue;
    const partes = [];
    if (j.fecha_inicio < nuevo.fecha_inicio) {
      partes.push({ ini: j.fecha_inicio, fin: sumarDias(nuevo.fecha_inicio, -1), aplica: j.aplica_a });
    }
    if (j.fecha_fin > nuevo.fecha_fin) {
      partes.push({ ini: sumarDias(nuevo.fecha_fin, 1), fin: j.fecha_fin, aplica: j.aplica_a });
    }
    if (j.aplica_a === null && nuevo.aplica_a !== null) {
      partes.push({
        ini: j.fecha_inicio > nuevo.fecha_inicio ? j.fecha_inicio : nuevo.fecha_inicio,
        fin: j.fecha_fin < nuevo.fecha_fin ? j.fecha_fin : nuevo.fecha_fin,
        aplica: TIPOS.find((t) => t !== nuevo.aplica_a),
      });
    }
    // La primera parte conserva la fila original (y su duracion_ms para el KPI RTO)
    if (!partes.length) borrar.run(j.id_justificativo);
    else {
      const [primera, ...resto] = partes;
      actualizar.run({ id: j.id_justificativo, ...primera });
      for (const p of resto) insertar.run({ ...j, ...p });
    }
    cambios += 1;
  }
  return cambios;
}

// Limpieza única de duplicados creados antes de esta regla: procesa los justificativos en
// el orden en que se crearon y cada uno sobrescribe a los anteriores.
function normalizarJustificativos(db) {
  const haySuperpuestos = db.prepare(`
    SELECT 1 FROM justificativo a
    JOIN justificativo b ON b.rut_alumno = a.rut_alumno AND b.id_justificativo > a.id_justificativo
    WHERE a.estado_documento = 'APROBADO' AND b.estado_documento = 'APROBADO'
      AND a.fecha_inicio <= b.fecha_fin AND b.fecha_inicio <= a.fecha_fin
      AND (a.aplica_a IS NULL OR b.aplica_a IS NULL OR a.aplica_a = b.aplica_a)
    LIMIT 1
  `).get();
  if (!haySuperpuestos) return 0;

  const todos = db.prepare(`
    SELECT * FROM justificativo WHERE estado_documento = 'APROBADO' ORDER BY id_justificativo
  `).all();
  const pendientes = new Set(todos.map((j) => j.id_justificativo));
  const porId = db.prepare('SELECT * FROM justificativo WHERE id_justificativo = ?');
  let cambios = 0;
  for (const original of todos) {
    pendientes.delete(original.id_justificativo);
    const actual = porId.get(original.id_justificativo); // pudo haber sido recortado antes
    if (!actual) continue;
    cambios += recortarSuperpuestos(db, actual, new Set([actual.id_justificativo, ...pendientes]));
  }
  return cambios;
}

module.exports = {
  SIN_JUSTIFICAR, CODIGOS, codigoDeTipo, sinTildes,
  sqlJustificado, sqlUltimoTipo, recortarSuperpuestos, normalizarJustificativos,
};
