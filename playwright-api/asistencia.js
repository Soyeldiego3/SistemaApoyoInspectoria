const xlsx = require('xlsx');
const { DatabaseSync } = require('node:sqlite'); // SQLite integrado en Node: no requiere compilar nada

const MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12 };
// Helpers compartidos con atrasos.js: ambas fuentes deben normalizar IGUAL
const normalizarRut = r => String(r).replace(/\./g, '').trim();          // 25.534.846-9 -> 25534846-9
const normalizarCurso = c => String(c).replace(/\s+/g, ' ').trim();
function separarNombre(n) {                                              // "Aravena Ruiz, Trinidad"
  const [apellidos, ...resto] = String(n).split(',');
  return { apellidos: apellidos.trim(), nombres: resto.join(',').trim() };
}

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
    const rut = normalizarRut(f[1]);
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
    alumnos.push({ rut, ...separarNombre(f[0]), registros });
  }
  return { curso: normalizarCurso(curso), anio: +anio, mes, etapa: etapa?.trim() ?? null, alumnos };
}

/** Ejecuta fn() dentro de una transacción: todo o nada. Devuelve lo que devuelva fn. */
function transaccion(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function abrirDb(ruta = 'asistencia.db') {
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS curso (
      id_curso INTEGER PRIMARY KEY,
      nombre   TEXT NOT NULL UNIQUE                 -- ej. '7°A'
    );

    CREATE TABLE IF NOT EXISTS alumno (
      rut       TEXT PRIMARY KEY,                   -- sin puntos: 25534846-9
      nombres   TEXT NOT NULL,
      apellidos TEXT NOT NULL
    );

    -- Un alumno puede estar en cursos distintos en años distintos
    CREATE TABLE IF NOT EXISTS matricula (
      id_matricula INTEGER PRIMARY KEY,
      rut_alumno   TEXT    NOT NULL REFERENCES alumno(rut),
      id_curso     INTEGER NOT NULL REFERENCES curso(id_curso),
      anio         INTEGER NOT NULL,
      UNIQUE (rut_alumno, id_curso, anio)
    );

    CREATE TABLE IF NOT EXISTS asistencia (
      id_asistencia INTEGER PRIMARY KEY,
      id_matricula  INTEGER NOT NULL REFERENCES matricula(id_matricula),
      fecha         TEXT    NOT NULL,               -- YYYY-MM-DD
      estado        TEXT    NOT NULL CHECK (estado IN ('P','A','F')),
      UNIQUE (id_matricula, fecha)
    );
    CREATE INDEX IF NOT EXISTS idx_asistencia_fecha ON asistencia(fecha);

    -- No se llena con el importador: lo usarás cuando tengas los justificativos
    CREATE TABLE IF NOT EXISTS justificativo (
      id_justificativo INTEGER PRIMARY KEY,
      rut_alumno       TEXT NOT NULL REFERENCES alumno(rut),
      tipo_documento   TEXT NOT NULL,
      fecha_inicio     TEXT NOT NULL,
      fecha_fin        TEXT NOT NULL,
      estado_documento TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado_documento IN ('PENDIENTE','APROBADO','RECHAZADO')),
      CHECK (fecha_fin >= fecha_inicio)
    );
    CREATE INDEX IF NOT EXISTS idx_just_alumno ON justificativo(rut_alumno, fecha_inicio, fecha_fin);

    -- Vista cómoda: cada fila de asistencia con su alumno, curso y si la ausencia está justificada
    CREATE VIEW IF NOT EXISTS v_asistencia AS
    SELECT a.id_asistencia, al.rut, al.apellidos, al.nombres, c.nombre AS curso,
           m.anio, a.fecha, a.estado,
           CASE WHEN a.estado = 'A' AND EXISTS (
                  SELECT 1 FROM justificativo j
                  WHERE j.rut_alumno = al.rut AND j.estado_documento = 'APROBADO'
                    AND a.fecha BETWEEN j.fecha_inicio AND j.fecha_fin)
                THEN 1 ELSE 0 END AS justificada
    FROM asistencia a
    JOIN matricula m ON m.id_matricula = a.id_matricula
    JOIN alumno al   ON al.rut = m.rut_alumno
    JOIN curso c     ON c.id_curso = m.id_curso;

    -- Atrasos marcados en portería; se extraen de la tabla HTML del portal
    CREATE TABLE IF NOT EXISTS atraso (
      id_atraso          INTEGER PRIMARY KEY,
      id_matricula       INTEGER NOT NULL REFERENCES matricula(id_matricula),
      fecha              TEXT    NOT NULL,          -- YYYY-MM-DD
      hora_llegada       TEXT    NOT NULL,          -- HH:MM
      justificado_portal INTEGER NOT NULL CHECK (justificado_portal IN (0,1)),
      UNIQUE (id_matricula, fecha, hora_llegada)
    );
    CREATE INDEX IF NOT EXISTS idx_atraso_fecha ON atraso(fecha);

    -- Cada atraso con: estado de asistencia ese día, justificado según el portal
    -- y justificado según TUS justificativos aprobados (para detectar desacuerdos)
    CREATE VIEW IF NOT EXISTS v_atraso AS
    SELECT t.id_atraso, al.rut, al.apellidos, al.nombres, c.nombre AS curso, m.anio,
           t.fecha, t.hora_llegada, t.justificado_portal,
           EXISTS (SELECT 1 FROM justificativo j
                   WHERE j.rut_alumno = al.rut AND j.estado_documento = 'APROBADO'
                     AND t.fecha BETWEEN j.fecha_inicio AND j.fecha_fin) AS justificado_doc,
           (SELECT s.estado FROM asistencia s
            WHERE s.id_matricula = m.id_matricula AND s.fecha = t.fecha) AS estado_dia
    FROM atraso t
    JOIN matricula m ON m.id_matricula = t.id_matricula
    JOIN alumno al   ON al.rut = m.rut_alumno
    JOIN curso c     ON c.id_curso = m.id_curso;
  `);
  return db;
}

function guardar(db, data) {
  const upCurso = db.prepare(`INSERT INTO curso (nombre) VALUES (?) ON CONFLICT(nombre) DO NOTHING`);
  const getCurso = db.prepare(`SELECT id_curso FROM curso WHERE nombre = ?`);
  const upAlumno = db.prepare(`INSERT INTO alumno (rut, nombres, apellidos) VALUES (@rut, @nombres, @apellidos)
    ON CONFLICT(rut) DO UPDATE SET nombres = excluded.nombres, apellidos = excluded.apellidos`);
  const upMat = db.prepare(`INSERT INTO matricula (rut_alumno, id_curso, anio) VALUES (?, ?, ?)
    ON CONFLICT(rut_alumno, id_curso, anio) DO NOTHING`);
  const getMat = db.prepare(`SELECT id_matricula FROM matricula WHERE rut_alumno = ? AND id_curso = ? AND anio = ?`);
  const upAsis = db.prepare(`INSERT INTO asistencia (id_matricula, fecha, estado) VALUES (?, ?, ?)
    ON CONFLICT(id_matricula, fecha) DO UPDATE SET estado = excluded.estado`);

  return transaccion(db, () => {
    upCurso.run(data.curso);
    const { id_curso } = getCurso.get(data.curso);
    let n = 0;
    for (const al of data.alumnos) {
      upAlumno.run({ rut: al.rut, nombres: al.nombres, apellidos: al.apellidos });
      upMat.run(al.rut, id_curso, data.anio);
      const { id_matricula } = getMat.get(al.rut, id_curso, data.anio);
      for (const r of al.registros) { upAsis.run(id_matricula, r.fecha, r.estado); n++; }
    }
    return n;
  });
}

module.exports = { parsearAsistencia, abrirDb, guardar, transaccion, normalizarRut, normalizarCurso, separarNombre };