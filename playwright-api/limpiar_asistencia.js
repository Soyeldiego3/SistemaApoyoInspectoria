const xlsx = require('xlsx');
const Database = require('better-sqlite3');

const MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12 };
const ESTADOS = { '●': 'P', '✕': 'A', '✗': 'A', '×': 'A', 'X': 'A', 'x': 'A', 'F': 'F' };

/** Convierte el Buffer del xlsx en un objeto estructurado. */
function parsearAsistencia(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // header:1 -> matriz de filas; el archivo es un reporte, NO una tabla plana
  const filas = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  // Fila 2: "Curso 7°A · Julio 2026 · Etapa: Cerrada"
  const meta = String(filas[1]?.[0] ?? '').match(/Curso\s+(.+?)\s*·\s*(\p{L}+)\s+(\d{4})(?:\s*·\s*Etapa:\s*(.+))?/u);
  if (!meta) throw new Error('No pude leer curso/mes/año en A2: ' + filas[1]?.[0]);
  const [, curso, mesNombre, anio, etapa] = meta;
  const mes = MESES[mesNombre.toLowerCase()];
  if (!mes) throw new Error('Mes desconocido: ' + mesNombre);

  // Encabezado: la fila cuya primera celda es "Alumno" (no asumimos que sea la 3)
  const iHead = filas.findIndex(f => f[0] === 'Alumno');
  if (iHead < 0) throw new Error('No encontré la fila de encabezado');
  const head = filas[iHead];

  // Columnas de días: "M 1", "J 2", ... -> número de día
  const dias = [];
  head.forEach((h, col) => {
    const m = typeof h === 'string' && h.trim().match(/^[LMJVSD]\s+(\d{1,2})$/);
    if (m) dias.push({ col, dia: +m[1] });
  });
  const colPresentes = head.indexOf('Presentes');
  const colAusentes = head.indexOf('Ausentes');

  const alumnos = [];
  for (let i = iHead + 1; i < filas.length; i++) {
    const f = filas[i];
    if (!f[0] || !f[1]) break; // fin de la tabla (después vienen leyenda y notas)
    const rut = String(f[1]).replace(/\./g, '').trim();
    const registros = dias.map(({ col, dia }) => {
      const raw = String(f[col] ?? '').trim();
      const estado = ESTADOS[raw];
      if (!estado) throw new Error(`Símbolo desconocido "${raw}" (${f[0]}, día ${dia})`);
      return { fecha: `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, estado };
    });
    // Control de integridad contra los totales del propio reporte
    const p = registros.filter(r => r.estado === 'P').length;
    const a = registros.filter(r => r.estado === 'A').length;
    if (p !== f[colPresentes] || a !== f[colAusentes])
      throw new Error(`Totales no cuadran para ${f[0]}: calculado ${p}/${a}, reporte ${f[colPresentes]}/${f[colAusentes]}`);
    alumnos.push({ nombre: String(f[0]).trim(), rut, registros });
  }
  return { curso, anio: +anio, mes, etapa: etapa?.trim() ?? null, alumnos };
}

function abrirDb(ruta = 'asistencia.db') {
  const db = new Database(ruta);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS alumno (
      rut TEXT PRIMARY KEY, nombre TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS asistencia (
      rut    TEXT NOT NULL REFERENCES alumno(rut),
      curso  TEXT NOT NULL,
      fecha  TEXT NOT NULL,               -- YYYY-MM-DD
      estado TEXT NOT NULL CHECK (estado IN ('P','A','F')),
      PRIMARY KEY (rut, fecha)
    );
    CREATE INDEX IF NOT EXISTS idx_asistencia_curso_fecha ON asistencia(curso, fecha);
  `);
  return db;
}

/** Idempotente: se puede importar el mismo mes N veces sin duplicar. */
function guardar(db, data) {
  const upAlumno = db.prepare(`INSERT INTO alumno (rut, nombre) VALUES (@rut, @nombre)
    ON CONFLICT(rut) DO UPDATE SET nombre = excluded.nombre`);
  const upAsis = db.prepare(`INSERT INTO asistencia (rut, curso, fecha, estado)
    VALUES (@rut, @curso, @fecha, @estado)
    ON CONFLICT(rut, fecha) DO UPDATE SET estado = excluded.estado, curso = excluded.curso`);
  db.transaction(() => {
    for (const al of data.alumnos) {
      upAlumno.run({ rut: al.rut, nombre: al.nombre });
      for (const r of al.registros) upAsis.run({ rut: al.rut, curso: data.curso, ...r });
    }
  })();
  return data.alumnos.reduce((n, a) => n + a.registros.length, 0);
}

module.exports = { parsearAsistencia, abrirDb, guardar };
