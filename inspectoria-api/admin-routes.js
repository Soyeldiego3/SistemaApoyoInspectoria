const express = require('express');

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function createAdminRouter(db) {
  const router = express.Router();

  const tableNames = () => db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);

  const getTable = name => {
    if (typeof name !== 'string' || !IDENTIFIER.test(name) || !tableNames().includes(name)) {
      const error = new Error('Tabla no válida.');
      error.statusCode = 400;
      throw error;
    }
    return name;
  };

  const getSchema = table => {
    const quoted = quoteIdentifier(table);
    const columns = db.prepare(`PRAGMA table_info(${quoted})`).all();
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quoted})`).all();
    return {
      columns,
      foreignKeys,
      primaryKey: columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name)
    };
  };

  const getColumn = (table, name) => {
    const { columns } = getSchema(table);
    const column = columns.find(item => item.name === name);
    if (!column) {
      const error = new Error('Columna no válida.');
      error.statusCode = 400;
      throw error;
    }
    return column;
  };

  const sendError = (res, error) => {
    const status = error.statusCode || 500;
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor.' : error.message });
  };

  router.get('/tablas', (req, res) => {
    try {
      const result = tableNames().map(name => ({
        name,
        count: db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get().count
      }));
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/tablas/:tabla/esquema', (req, res) => {
    try {
      const table = getTable(req.params.tabla);
      res.json({ table, ...getSchema(table) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/tablas/:tabla', (req, res) => {
    try {
      const table = getTable(req.params.tabla);
      const { columns } = getSchema(table);
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const order = typeof req.query.orden === 'string' && req.query.orden
        ? req.query.orden
        : (columns[0] && columns[0].name);
      const direction = String(req.query.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

      if (order && !columns.some(column => column.name === order)) {
        const error = new Error('Orden no válido.');
        error.statusCode = 400;
        throw error;
      }

      const conditions = [];
      const params = [];
      if (q) {
        conditions.push(`(${columns.map(column => `CAST(${quoteIdentifier(column.name)} AS TEXT) LIKE ?`).join(' OR ')})`);
        params.push(...columns.map(() => `%${q}%`));
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const quoted = quoteIdentifier(table);
      const total = db.prepare(`SELECT COUNT(*) AS count FROM ${quoted} ${where}`).get(...params).count;
      const offset = (page - 1) * limit;
      const primaryKey = columns.filter(column => column.pk > 0);
      const selectedColumns = columns.map(column => quoteIdentifier(column.name));
      if (!primaryKey.length) selectedColumns.push('rowid AS "__rowid"');
      const rows = db.prepare(`
        SELECT ${selectedColumns.join(', ')}
        FROM ${quoted}
        ${where}
        ORDER BY ${quoteIdentifier(order)} ${direction}
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      res.json({ table, columns, primaryKey: primaryKey.map(column => column.name), rows, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/tablas/:tabla/columna/:col/valores', (req, res) => {
    try {
      const table = getTable(req.params.tabla);
      const column = getColumn(table, req.params.col);
      const quotedTable = quoteIdentifier(table);
      const quotedColumn = quoteIdentifier(column.name);
      const values = db.prepare(`
        SELECT DISTINCT ${quotedColumn} AS value
        FROM ${quotedTable}
        WHERE ${quotedColumn} IS NOT NULL
        ORDER BY ${quotedColumn}
      `).all().map(row => row.value);
      res.json({ table, column: column.name, values });
    } catch (error) {
      sendError(res, error);
    }
  });

  const normalizeData = (table, data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      const error = new Error('El cuerpo debe contener un objeto de datos.');
      error.statusCode = 400;
      throw error;
    }
    const { columns } = getSchema(table);
    const allowed = new Set(columns.map(column => column.name));
    const unknown = Object.keys(data).filter(name => !allowed.has(name));
    if (unknown.length) {
      const error = new Error(`Columnas no válidas: ${unknown.join(', ')}.`);
      error.statusCode = 400;
      throw error;
    }
    return data;
  };

  const primaryKeyWhere = (table, keyValues) => {
    const { columns } = getSchema(table);
    const primaryKey = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk);
    if (!primaryKey.length) {
      if (!keyValues || keyValues.__rowid === undefined) {
        const error = new Error('La fila requiere __rowid porque la tabla no tiene clave primaria.');
        error.statusCode = 400;
        throw error;
      }
      return { clause: 'rowid = ?', values: [keyValues.__rowid] };
    }
    if (!keyValues || primaryKey.some(column => keyValues[column.name] === undefined)) {
      const error = new Error(`Debe indicar toda la clave primaria: ${primaryKey.map(column => column.name).join(', ')}.`);
      error.statusCode = 400;
      throw error;
    }
    return {
      clause: primaryKey.map(column => `${quoteIdentifier(column.name)} = ?`).join(' AND '),
      values: primaryKey.map(column => keyValues[column.name])
    };
  };

  const sqliteError = error => {
    const message = String(error.message || '');
    if (/SQLITE_CONSTRAINT|UNIQUE constraint|FOREIGN KEY constraint|NOT NULL constraint|CHECK constraint/i.test(message)) {
      const result = new Error(`No se pudo guardar: ${message.replace(/^SQLITE_CONSTRAINT:\s*/i, '')}`);
      result.statusCode = 400;
      return result;
    }
    return error;
  };

  router.post('/tablas/:tabla', (req, res) => {
    try {
      const table = getTable(req.params.tabla);
      const data = normalizeData(table, req.body && req.body.data ? req.body.data : req.body);
      const names = Object.keys(data);
      if (!names.length) {
        const error = new Error('Debe indicar al menos una columna.');
        error.statusCode = 400;
        throw error;
      }
      const quotedTable = quoteIdentifier(table);
      const statement = db.prepare(`INSERT INTO ${quotedTable} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`);
      const result = statement.run(...names.map(name => data[name]));
      res.status(201).json({ changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid });
    } catch (error) {
      sendError(res, sqliteError(error));
    }
  });

  router.put('/tablas/:tabla', (req, res) => {
    try {
      const table = getTable(req.params.tabla);
      const body = req.body || {};
      const data = normalizeData(table, body.data);
      const { columns } = getSchema(table);
      const names = Object.keys(data);
      if (!names.length) {
        const error = new Error('No hay columnas editables.');
        error.statusCode = 400;
        throw error;
      }
      const where = primaryKeyWhere(table, body.pk);
      const result = db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${names.map(name => `${quoteIdentifier(name)} = ?`).join(', ')} WHERE ${where.clause}`).run(...names.map(name => data[name]), ...where.values);
      if (!Number(result.changes)) {
        const error = new Error('No se encontró el registro indicado.');
        error.statusCode = 404;
        throw error;
      }
      res.json({ changes: Number(result.changes) });
    } catch (error) {
      sendError(res, sqliteError(error));
    }
  });

  router.delete('/tablas/:tabla', (req, res) => {
    try {
      const table = getTable(req.params.tabla);
      const where = primaryKeyWhere(table, req.body && (req.body.pk || req.body));
      const result = db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE ${where.clause}`).run(...where.values);
      if (!Number(result.changes)) {
        const error = new Error('No se encontró el registro indicado.');
        error.statusCode = 404;
        throw error;
      }
      res.json({ changes: Number(result.changes) });
    } catch (error) {
      sendError(res, sqliteError(error));
    }
  });

  router.post('/tablas/:tabla/eliminar-multiple', (req, res) => {
    try {
      const table = getTable(req.params.tabla);
      if (!Array.isArray(req.body && req.body.keys) || !req.body.keys.length) {
        const error = new Error('Debe seleccionar al menos un registro.');
        error.statusCode = 400;
        throw error;
      }
      const transaction = db.prepare('BEGIN');
      transaction.run();
      let deleted = 0;
      try {
        for (const key of req.body.keys) {
          const where = primaryKeyWhere(table, key);
          const result = db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE ${where.clause}`).run(...where.values);
          deleted += Number(result.changes);
        }
        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }
      res.json({ changes: deleted });
    } catch (error) {
      sendError(res, sqliteError(error));
    }
  });

  const parseCsv = text => {
    const rows = [];
    let row = [], value = '', quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(value); value = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(value); value = '';
        if (row.some(item => item !== '')) rows.push(row);
        row = [];
      } else value += char;
    }
    if (value || row.length) { row.push(value); if (row.some(item => item !== '')) rows.push(row); }
    return rows;
  };

  const seededRandom = seed => {
    let value = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : (Date.now() >>> 0);
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  };

  const isoDate = date => date.toISOString().slice(0, 10);
  const datesBetween = (start, end) => {
    const dates = [];
    const date = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    while (date <= last) {
      dates.push(isoDate(date));
      date.setDate(date.getDate() + 1);
    }
    return dates;
  };

  const randomItem = (items, random) => items[Math.floor(random() * items.length)];
  const randomTime = random => `${String(7 + Math.floor(random() * 3)).padStart(2, '0')}:${String(Math.floor(random() * 60)).padStart(2, '0')}`;
  const generationNames = {
    nombres: ['Sofía', 'Mateo', 'Isidora', 'Benjamín', 'Camila', 'Tomás', 'Emilia', 'Diego', 'Valentina', 'Vicente'],
    apellidos: ['González', 'Rojas', 'Muñoz', 'Pérez', 'Soto', 'Contreras', 'Silva', 'Sepúlveda', 'Araya', 'Torres']
  };

  const generatedRows = (table, body, random) => {
    const count = Math.max(1, Math.min(10000, Number.parseInt(body.count, 10) || 0));
    if (!count) {
      const error = new Error('La cantidad debe ser mayor que cero.');
      error.statusCode = 400;
      throw error;
    }
    const { columns } = getSchema(table);
    const options = body.options || {};
    if (table === 'asistencia') {
      const alumnos = Array.isArray(options.alumnoIds) ? options.alumnoIds : [];
      const start = options.desde;
      const end = options.hasta;
      if (!alumnos.length || !start || !end) throw Object.assign(new Error('Asistencia requiere alumnos y rango de fechas.'), { statusCode: 400 });
      const feriados = new Set(db.prepare('SELECT fecha FROM feriados').all().map(row => row.fecha));
      const candidates = [];
      for (const alumnoId of alumnos) {
        for (const date of datesBetween(start, end)) {
          const weekday = new Date(`${date}T00:00:00`).getDay();
          if (options.saltarNoLectivos && (weekday === 0 || weekday === 6 || feriados.has(date))) continue;
          candidates.push({ alumno_id: Number(alumnoId), fecha: date });
        }
      }
      const selected = candidates.sort(() => random() - 0.5).slice(0, count);
      const distribution = options.distribucion && Object.keys(options.distribucion).length
        ? options.distribucion
        : { [options.estado || 'P']: 100 };
      return selected.map(row => {
        let point = random() * Object.values(distribution).reduce((sum, value) => sum + Number(value), 0);
        let estado = Object.keys(distribution)[0];
        for (const [candidate, weight] of Object.entries(distribution)) {
          point -= Number(weight);
          if (point <= 0) { estado = candidate; break; }
        }
        return { ...row, estado };
      });
    }
    if (table === 'alumnos') {
      const cursos = db.prepare('SELECT id FROM cursos').all().map(row => row.id);
      return Array.from({ length: count }, (_, index) => ({
        rut: `99.${String(Date.now()).slice(-3)}.${String(index).padStart(3, '0')}-${Math.floor(random() * 9)}`,
        nombres: randomItem(generationNames.nombres, random),
        apellidos: `${randomItem(generationNames.apellidos, random)} ${randomItem(generationNames.apellidos, random)}`,
        curso_id: Number(options.cursoId) || randomItem(cursos, random)
      }));
    }
    if (['atrasos', 'retiros', 'reingresos'].includes(table)) {
      const alumnos = Array.isArray(options.alumnoIds) && options.alumnoIds.length
        ? options.alumnoIds : db.prepare('SELECT id FROM alumnos').all().map(row => row.id);
      if (!options.desde || !options.hasta) throw Object.assign(new Error('Esta tabla requiere un rango de fechas.'), { statusCode: 400 });
      const dates = datesBetween(options.desde, options.hasta);
      return Array.from({ length: count }, () => {
        const row = { alumno_id: Number(randomItem(alumnos, random)), fecha: randomItem(dates, random) };
        if (table === 'atrasos') return { ...row, hora_llegada: randomTime(random), justificado: random() < 0.2 ? 1 : 0 };
        if (table === 'reingresos') return { ...row, hora_reingreso: randomTime(random), motivo: 'Actividad generada para pruebas' };
        return { ...row, hora_retiro: randomTime(random), retira: 'Apoderado', motivo: 'Actividad generada para pruebas' };
      });
    }
    if (!options.valores || typeof options.valores !== 'object') {
      throw Object.assign(new Error('Para esta tabla se requieren valores por columna.'), { statusCode: 400 });
    }
    return Array.from({ length: count }, () => Object.fromEntries(columns.filter(column => options.valores[column.name] !== undefined).map(column => {
      const value = options.valores[column.name];
      return [column.name, Array.isArray(value) ? randomItem(value, random) : value];
    })));
  };

  const shuffled = (items, random) => items.slice().sort(() => random() - 0.5);

  const integratedGeneration = (body, random) => {
    const options = body.options || {};
    const start = options.desde;
    const end = options.hasta;
    if (!start || !end || datesBetween(start, end).length === 0) {
      throw Object.assign(new Error('La generación integrada requiere un rango de fechas válido.'), { statusCode: 400 });
    }

    const allDates = datesBetween(start, end);
    const feriados = new Set(db.prepare('SELECT fecha FROM feriados').all().map(row => row.fecha));
    const dates = allDates.filter(date => {
      const weekday = new Date(`${date}T00:00:00`).getDay();
      return !options.saltarNoLectivos || (weekday !== 0 && weekday !== 6 && !feriados.has(date));
    });
    if (!dates.length) {
      throw Object.assign(new Error('El rango no contiene días hábiles para generar datos.'), { statusCode: 400 });
    }

    const positiveCount = (value, fallback, maximum) => Math.max(0, Math.min(maximum, Number.parseInt(value, 10) || fallback));
    const newStudents = positiveCount(options.nuevosAlumnos, 0, 500);
    const attendanceDays = positiveCount(options.asistenciasPorAlumno, Math.min(40, dates.length), dates.length);
    const lateEvents = positiveCount(options.atrasosPorAlumno, 3, dates.length);
    const withdrawalEvents = positiveCount(options.retirosPorAlumno, 2, dates.length);
    const reentryEvents = positiveCount(options.reingresosPorAlumno, 2, dates.length);
    const courses = db.prepare('SELECT id FROM cursos').all().map(row => row.id);
    if (!courses.length) {
      throw Object.assign(new Error('No hay cursos disponibles para asignar alumnos.'), { statusCode: 400 });
    }

    const report = {
      alumnos: { generated: newStudents, inserted: 0 },
      asistencia: { generated: 0, inserted: 0 },
      atrasos: { generated: 0, inserted: 0 },
      retiros: { generated: 0, inserted: 0 },
      reingresos: { generated: 0, inserted: 0 }
    };
    const insert = (table, row) => {
      const names = Object.keys(row);
      const result = db.prepare(`INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map(name => row[name]));
      if (Number(result.changes)) report[table].inserted += 1;
    };

    const alumnos = db.prepare('SELECT id FROM alumnos').all().map(row => row.id);
    for (let index = 0; index < newStudents; index += 1) {
      const rut = `99.${String(Date.now()).slice(-3)}.${String(index).padStart(3, '0')}-${Math.floor(random() * 10)}`;
      const result = db.prepare('INSERT INTO alumnos (rut, nombres, apellidos, curso_id) VALUES (?, ?, ?, ?)').run(
        rut,
        randomItem(generationNames.nombres, random),
        `${randomItem(generationNames.apellidos, random)} ${randomItem(generationNames.apellidos, random)}`,
        randomItem(courses, random)
      );
      alumnos.push(Number(result.lastInsertRowid));
    }
    report.alumnos.inserted = newStudents;

    const weightedState = () => {
      const point = random();
      if (point < 0.45) return 'A';
      if (point < 0.85) return 'P';
      return 'T';
    };
    for (const alumnoId of alumnos) {
      for (const date of shuffled(dates, random).slice(0, attendanceDays)) {
        report.asistencia.generated += 1;
        insert('asistencia', { alumno_id: alumnoId, fecha: date, estado: weightedState() });
      }
      for (const date of shuffled(dates, random).slice(0, lateEvents)) {
        report.atrasos.generated += 1;
        insert('atrasos', { alumno_id: alumnoId, fecha: date, hora_llegada: randomTime(random), justificado: random() < 0.2 ? 1 : 0 });
      }
      for (const date of shuffled(dates, random).slice(0, withdrawalEvents)) {
        report.retiros.generated += 1;
        insert('retiros', { alumno_id: alumnoId, fecha: date, hora_retiro: randomTime(random), retira: 'Apoderado', motivo: 'Actividad generada para pruebas' });
      }
      for (const date of shuffled(dates, random).slice(0, reentryEvents)) {
        report.reingresos.generated += 1;
        insert('reingresos', { alumno_id: alumnoId, fecha: date, hora_reingreso: randomTime(random), motivo: 'Actividad generada para pruebas' });
      }
    }
    return report;
  };

  router.post('/generar-datos-integrados', (req, res) => {
    try {
      const random = seededRandom(req.body && req.body.seed);
      db.prepare('BEGIN').run();
      try {
        const report = integratedGeneration(req.body || {}, random);
        db.prepare('COMMIT').run();
        res.json(report);
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }
    } catch (error) {
      sendError(res, sqliteError(error));
    }
  });

  /* ================================================================
   * Vista unificada por alumno y día + generación realista
   * Tablas de actividad: asistencia, atrasos, retiros, reingresos.
   * Todas tienen PK (alumno_id, fecha) y FK alumno_id -> alumnos.id;
   * ninguna tabla las referencia, así que borrar filas de ellas es seguro.
   * ================================================================ */
  const ACT = ['asistencia', 'atrasos', 'retiros', 'reingresos'];
  const bad = message => Object.assign(new Error(message), { statusCode: 400 });
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
  const tx = fn => {
    db.prepare('BEGIN').run();
    try { const result = fn(); db.prepare('COMMIT').run(); return result; }
    catch (error) { db.prepare('ROLLBACK').run(); throw error; }
  };
  const checkRange = (desde, hasta) => {
    if (!ISO.test(desde || '') || !ISO.test(hasta || '') || desde > hasta) throw bad('Rango de fechas no válido.');
  };
  const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay();
  const schoolDays = (desde, hasta) => {
    const feriados = new Set(db.prepare('SELECT fecha FROM feriados').all().map(row => row.fecha));
    const out = [];
    for (let d = new Date(`${desde}T12:00:00Z`); d <= new Date(`${hasta}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const f = d.toISOString().slice(0, 10), w = d.getUTCDay();
      if (w > 0 && w < 6 && !feriados.has(f)) out.push(f);
    }
    return out;
  };
  const hhmm = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const rutDv = body => {
    let sum = 0, mul = 2;
    for (let i = body.length - 1; i >= 0; i -= 1) { sum += Number(body[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
    const dv = 11 - (sum % 11);
    return dv === 11 ? '0' : dv === 10 ? 'K' : String(dv);
  };
  const fmtRut = body => `${body.slice(0, 2)}.${body.slice(2, 5)}.${body.slice(5)}-${rutDv(body)}`;

  // Filtro común (rango, curso, alumno) sobre la unión de claves (alumno_id, fecha) de las 4 tablas.
  const filtroDias = query => {
    const where = [], params = [];
    if (ISO.test(query.desde || '')) { where.push('k.fecha >= ?'); params.push(query.desde); }
    if (ISO.test(query.hasta || '')) { where.push('k.fecha <= ?'); params.push(query.hasta); }
    if (Number(query.curso)) { where.push('a.curso_id = ?'); params.push(Number(query.curso)); }
    if (Number(query.alumno)) { where.push('a.id = ?'); params.push(Number(query.alumno)); }
    if (typeof query.q === 'string' && query.q.trim()) {
      where.push("(a.rut LIKE ? OR (a.apellidos || ' ' || a.nombres) LIKE ? OR (a.nombres || ' ' || a.apellidos) LIKE ?)");
      const like = `%${query.q.trim()}%`; params.push(like, like, like);
    }
    const tipos = {
      ausentes: "s.estado = 'A'",
      atrasos: 't.alumno_id IS NOT NULL',
      retiros: 'r.alumno_id IS NOT NULL',
      reingresos: 'i.alumno_id IS NOT NULL',
      incoherentes: `((t.alumno_id IS NOT NULL AND s.estado IS NOT 'T') OR (s.estado = 'T' AND t.alumno_id IS NULL)
                     OR ((r.alumno_id IS NOT NULL OR i.alumno_id IS NOT NULL) AND s.estado IS NOT 'P' AND s.estado IS NOT 'T'))`
    };
    if (tipos[query.tipo]) where.push(tipos[query.tipo]);
    return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  };
  const FROM_DIAS = `FROM (SELECT alumno_id, fecha FROM asistencia UNION SELECT alumno_id, fecha FROM atrasos
                           UNION SELECT alumno_id, fecha FROM retiros UNION SELECT alumno_id, fecha FROM reingresos) k
    JOIN alumnos a ON a.id = k.alumno_id JOIN cursos c ON c.id = a.curso_id
    LEFT JOIN asistencia s ON s.alumno_id = k.alumno_id AND s.fecha = k.fecha
    LEFT JOIN atrasos t    ON t.alumno_id = k.alumno_id AND t.fecha = k.fecha
    LEFT JOIN retiros r    ON r.alumno_id = k.alumno_id AND r.fecha = k.fecha
    LEFT JOIN reingresos i ON i.alumno_id = k.alumno_id AND i.fecha = k.fecha`;

  router.get('/meta', (req, res) => {
    try {
      const rango = db.prepare(`SELECT MIN(f) AS min, MAX(f) AS max FROM (SELECT fecha f FROM asistencia UNION ALL SELECT fecha FROM atrasos
                                UNION ALL SELECT fecha FROM retiros UNION ALL SELECT fecha FROM reingresos)`).get();
      res.json({
        rango,
        cursos: db.prepare('SELECT id, nombre FROM cursos ORDER BY id').all(),
        alumnos: db.prepare(`SELECT a.id, a.rut, a.nombres, a.apellidos, a.curso_id, c.nombre AS curso
                             FROM alumnos a JOIN cursos c ON c.id = a.curso_id ORDER BY a.apellidos, a.nombres`).all(),
        feriados: db.prepare('SELECT fecha FROM feriados ORDER BY fecha').all().map(row => row.fecha)
      });
    } catch (error) { sendError(res, error); }
  });

  router.get('/registros', (req, res) => {
    try {
      const { where, params } = filtroDias(req.query);
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
      const total = db.prepare(`SELECT COUNT(*) AS n ${FROM_DIAS} ${where}`).get(...params).n;
      const rows = db.prepare(`SELECT k.alumno_id, k.fecha, a.rut, a.nombres, a.apellidos, c.nombre AS curso, s.estado,
          t.hora_llegada, t.justificado, r.hora_retiro, r.retira, r.motivo AS motivo_retiro, i.hora_reingreso, i.motivo AS motivo_reingreso
        ${FROM_DIAS} ${where} ORDER BY k.fecha DESC, c.id, a.apellidos, a.nombres LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
      res.json({ rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
    } catch (error) { sendError(res, error); }
  });

  // Guarda un día completo de un alumno en las 4 tablas, de forma coherente y en una sola transacción.
  router.put('/registros', (req, res) => {
    try {
      const body = req.body || {};
      const alumnoId = Number(body.alumno_id);
      if (!alumnoId || !db.prepare('SELECT 1 FROM alumnos WHERE id = ?').get(alumnoId)) throw bad('Alumno no válido.');
      if (!ISO.test(body.fecha || '')) throw bad('Fecha no válida.');
      const estado = body.estado || '';
      if (!['', 'P', 'A', 'T'].includes(estado)) throw bad('Estado no válido.');
      const { atraso, retiro, reingreso } = body;
      if (estado === 'T' && !atraso) throw bad('Un atraso (estado T) requiere hora de llegada.');
      if (atraso && estado !== 'T') throw bad('Solo un alumno con estado T (atraso) puede tener hora de llegada.');
      if ((retiro || reingreso) && estado !== 'P' && estado !== 'T') throw bad('Retiro y reingreso requieren que el alumno esté presente (P o T).');
      if (atraso && !HORA.test(atraso.hora_llegada || '')) throw bad('Hora de llegada no válida (HH:MM).');
      if (retiro && (!HORA.test(retiro.hora_retiro || '') || !retiro.retira || !retiro.motivo)) throw bad('Retiro incompleto: hora (HH:MM), quién retira y motivo.');
      if (reingreso && (!HORA.test(reingreso.hora_reingreso || '') || !reingreso.motivo)) throw bad('Reingreso incompleto: hora (HH:MM) y motivo.');
      const key = [alumnoId, body.fecha];
      tx(() => {
        ACT.forEach(t => db.prepare(`DELETE FROM ${t} WHERE alumno_id = ? AND fecha = ?`).run(...key));
        if (estado) db.prepare('INSERT INTO asistencia (alumno_id, fecha, estado) VALUES (?, ?, ?)').run(...key, estado);
        if (atraso) db.prepare('INSERT INTO atrasos (alumno_id, fecha, hora_llegada, justificado) VALUES (?, ?, ?, ?)').run(...key, atraso.hora_llegada, atraso.justificado ? 1 : 0);
        if (retiro) db.prepare('INSERT INTO retiros (alumno_id, fecha, hora_retiro, retira, motivo) VALUES (?, ?, ?, ?, ?)').run(...key, retiro.hora_retiro, String(retiro.retira), String(retiro.motivo));
        if (reingreso) db.prepare('INSERT INTO reingresos (alumno_id, fecha, hora_reingreso, motivo) VALUES (?, ?, ?, ?)').run(...key, reingreso.hora_reingreso, String(reingreso.motivo));
      });
      res.json({ ok: true });
    } catch (error) { sendError(res, sqliteError(error)); }
  });

  router.delete('/registros', (req, res) => {
    try {
      const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys : [req.body || {}];
      if (!keys.length || keys.some(k => !Number(k.alumno_id) || !ISO.test(k.fecha || ''))) throw bad('Claves no válidas.');
      const changes = tx(() => keys.reduce((n, k) => n + ACT.reduce((m, t) =>
        m + Number(db.prepare(`DELETE FROM ${t} WHERE alumno_id = ? AND fecha = ?`).run(Number(k.alumno_id), k.fecha).changes), 0), 0));
      res.json({ changes });
    } catch (error) { sendError(res, sqliteError(error)); }
  });

  // Borra (o cuenta, con preview) todos los registros de actividad en un rango, opcionalmente de un curso.
  router.post('/borrar-rango', (req, res) => {
    try {
      const { desde, hasta, preview } = req.body || {};
      checkRange(desde, hasta);
      const curso = Number(req.body.cursoId) || null;
      const cond = `fecha BETWEEN ? AND ?${curso ? ' AND alumno_id IN (SELECT id FROM alumnos WHERE curso_id = ?)' : ''}`;
      const params = curso ? [desde, hasta, curso] : [desde, hasta];
      const counts = Object.fromEntries(ACT.map(t => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${cond}`).get(...params).n]));
      if (preview) return res.json({ preview: true, counts });
      const deleted = tx(() => Object.fromEntries(ACT.map(t => [t, Number(db.prepare(`DELETE FROM ${t} WHERE ${cond}`).run(...params).changes)])));
      res.json({ deleted });
    } catch (error) { sendError(res, sqliteError(error)); }
  });

  router.get('/resumen', (req, res) => {
    try {
      const meses = db.prepare(`SELECT substr(fecha, 1, 7) AS mes, COUNT(DISTINCT fecha) AS dias, COUNT(*) AS registros,
          SUM(estado = 'P') AS P, SUM(estado = 'A') AS A, SUM(estado = 'T') AS T FROM asistencia GROUP BY mes ORDER BY mes`).all();
      const extra = t => Object.fromEntries(db.prepare(`SELECT substr(fecha, 1, 7) AS mes, COUNT(*) AS n FROM ${t} GROUP BY mes`).all().map(r => [r.mes, r.n]));
      const [atr, ret, rei] = ['atrasos', 'retiros', 'reingresos'].map(extra);
      const todos = new Set([...meses.map(m => m.mes), ...Object.keys(atr), ...Object.keys(ret), ...Object.keys(rei)]);
      const porMes = [...todos].sort().map(mes => {
        const m = meses.find(x => x.mes === mes) || { mes, dias: 0, registros: 0, P: 0, A: 0, T: 0 };
        return { ...m, atrasos: atr[mes] || 0, retiros: ret[mes] || 0, reingresos: rei[mes] || 0 };
      });
      const riesgo = db.prepare(`SELECT a.id, a.rut, a.nombres, a.apellidos, c.nombre AS curso, COUNT(*) AS dias,
          SUM(s.estado = 'A') AS A, SUM(s.estado = 'T') AS T, ROUND(100.0 * SUM(s.estado <> 'A') / COUNT(*), 1) AS pct
        FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id JOIN cursos c ON c.id = a.curso_id
        GROUP BY a.id HAVING pct < 85 OR T >= 10 ORDER BY pct, T DESC LIMIT 30`).all();
      res.json({ porMes, riesgo });
    } catch (error) { sendError(res, error); }
  });

  // Revisión de coherencia entre tablas (y reparación opcional).
  const PROBLEMAS = {
    atrasoSinT: { txt: 'Atraso registrado pero asistencia distinta de T', sql: `FROM atrasos t LEFT JOIN asistencia s USING (alumno_id, fecha) WHERE s.estado IS NOT 'T'`,
      fix: `INSERT INTO asistencia (alumno_id, fecha, estado) SELECT t.alumno_id, t.fecha, 'T' FROM atrasos t WHERE true
            ON CONFLICT (alumno_id, fecha) DO UPDATE SET estado = 'T'`, fixTxt: 'marca la asistencia como T' },
    tSinAtraso: { txt: 'Asistencia T sin hora de llegada', sql: `FROM asistencia s LEFT JOIN atrasos t USING (alumno_id, fecha) WHERE s.estado = 'T' AND t.alumno_id IS NULL`,
      fix: `INSERT INTO atrasos (alumno_id, fecha, hora_llegada, justificado) SELECT s.alumno_id, s.fecha, '08:15', 0 FROM asistencia s
            WHERE s.estado = 'T' AND NOT EXISTS (SELECT 1 FROM atrasos t WHERE t.alumno_id = s.alumno_id AND t.fecha = s.fecha)`, fixTxt: 'crea el atraso a las 08:15' },
    salidaAusente: { txt: 'Retiro o reingreso en un día sin presencia (A o sin asistencia)',
      sql: `FROM (SELECT alumno_id, fecha FROM retiros UNION SELECT alumno_id, fecha FROM reingresos) x LEFT JOIN asistencia s USING (alumno_id, fecha)
            WHERE s.estado IS NULL OR s.estado = 'A'`,
      fix: `INSERT INTO asistencia (alumno_id, fecha, estado) SELECT alumno_id, fecha, 'P' FROM (SELECT alumno_id, fecha FROM retiros UNION SELECT alumno_id, fecha FROM reingresos) WHERE true
            ON CONFLICT (alumno_id, fecha) DO UPDATE SET estado = 'P' WHERE estado = 'A'`, fixTxt: 'marca la asistencia como P' },
    diaNoLectivo: { txt: 'Registros en fin de semana o feriado',
      sql: `FROM (SELECT fecha FROM asistencia UNION ALL SELECT fecha FROM atrasos UNION ALL SELECT fecha FROM retiros UNION ALL SELECT fecha FROM reingresos)
            WHERE strftime('%w', fecha) IN ('0', '6') OR fecha IN (SELECT fecha FROM feriados)`,
      fixAll: ACT.map(t => `DELETE FROM ${t} WHERE strftime('%w', fecha) IN ('0', '6') OR fecha IN (SELECT fecha FROM feriados)`), fixTxt: 'los elimina' }
  };
  const revisar = () => {
    const out = Object.entries(PROBLEMAS).map(([id, p]) => ({ id, txt: p.txt, fixTxt: p.fixTxt, n: db.prepare(`SELECT COUNT(*) AS n ${p.sql}`).get().n }));
    out.push({ id: 'fk', txt: 'Filas con alumno inexistente (FK rota)', fixTxt: 'revisar a mano', n: db.prepare('PRAGMA foreign_key_check').all().length });
    return out;
  };
  router.get('/coherencia', (req, res) => { try { res.json(revisar()); } catch (error) { sendError(res, error); } });
  router.post('/coherencia/reparar', (req, res) => {
    try {
      tx(() => ['diaNoLectivo', 'atrasoSinT', 'tSinAtraso', 'salidaAusente'].forEach(id => {
        const p = PROBLEMAS[id];
        (p.fixAll || [p.fix]).forEach(sql => db.prepare(sql).run());
      }));
      res.json(revisar());
    } catch (error) { sendError(res, sqliteError(error)); }
  });

  /* ---------- Generación realista ----------
   * Cada alumno recibe un perfil (regular, atrasador, inasistente, en riesgo). Cada día lectivo:
   *  - las ausencias llegan en rachas (enfermedad de 1 a 4 días) y son más probables lunes y viernes;
   *  - algunos días son "difíciles" (lluvia, paro de transporte) con muchos más atrasos;
   *  - estado T siempre trae su fila en atrasos; retiros y reingresos solo en días presentes.
   */
  const PERFILES = {
    regular:     { a: 0.020, t: 0.030, ret: 0.010, rei: 0.008 },
    atrasador:   { a: 0.030, t: 0.220, ret: 0.012, rei: 0.020 },
    inasistente: { a: 0.110, t: 0.060, ret: 0.025, rei: 0.015 },
    riesgo:      { a: 0.170, t: 0.150, ret: 0.035, rei: 0.025 }
  };
  const CARGAS = {
    normal:   { regular: 75, atrasador: 12, inasistente: 8,  riesgo: 5 },
    alta:     { regular: 45, atrasador: 25, inasistente: 18, riesgo: 12 },
    muy_alta: { regular: 25, atrasador: 30, inasistente: 25, riesgo: 20 }
  };
  const MOTIVOS_RETIRO = ['Control médico', 'Control médico', 'Malestar de salud', 'Malestar de salud', 'Trámite familiar', 'Emergencia familiar', 'Hora dental'];
  const QUIEN_RETIRA = ['Apoderado titular', 'Apoderado titular', 'Apoderado suplente', 'Madre', 'Padre', 'Abuela'];
  const MOTIVOS_REINGRESO = ['Control médico', 'Retraso de transporte', 'Trámite familiar', 'Examen médico'];
  const NOMBRES = ['Sofía', 'Mateo', 'Isidora', 'Benjamín', 'Camila', 'Tomás', 'Emilia', 'Agustín', 'Valentina', 'Vicente', 'Florencia', 'Martín',
    'Antonella', 'Lucas', 'Josefa', 'Maximiliano', 'Trinidad', 'Joaquín', 'Catalina', 'Cristóbal', 'Javiera', 'Gaspar', 'Amanda', 'Felipe'];
  const APELLIDOS = ['González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva', 'Martínez', 'Sepúlveda', 'Morales', 'Rodríguez',
    'López', 'Fuentes', 'Hernández', 'Torres', 'Araya', 'Flores', 'Espinoza', 'Valenzuela', 'Castillo', 'Tapia', 'Reyes', 'Gutiérrez', 'Castro', 'Vargas'];

  router.post('/generar-escenario', (req, res) => {
    try {
      const o = (req.body && req.body.options) || {};
      checkRange(o.desde, o.hasta);
      const dias = schoolDays(o.desde, o.hasta);
      if (!dias.length) throw bad('El rango no contiene días lectivos (lunes a viernes sin feriados).');
      if (dias.length > 400) throw bad('El rango es demasiado largo (máximo 400 días lectivos).');
      const carga = CARGAS[o.carga] ? o.carga : 'alta';
      const cursoId = Number(o.cursoId) || null;
      const nuevos = Math.max(0, Math.min(300, Number.parseInt(o.nuevosAlumnos, 10) || 0));
      const random = seededRandom(req.body.seed === '' || req.body.seed == null ? undefined : req.body.seed);
      const pick = list => list[Math.floor(random() * list.length)];
      const cursos = db.prepare('SELECT id FROM cursos ORDER BY id').all().map(r => r.id);
      if (!cursos.length) throw bad('No hay cursos.');

      const report = tx(() => {
        const rep = { dias: dias.length, alumnosNuevos: 0, borrados: 0, asistencia: 0, P: 0, A: 0, T: 0, atrasos: 0, retiros: 0, reingresos: 0, omitidosExistentes: 0, perfiles: {} };
        // Alumnos nuevos con RUT válido (módulo 11), repartidos en los cursos con menos alumnos.
        const usados = new Set(db.prepare('SELECT rut FROM alumnos').all().map(r => r.rut));
        const insAlumno = db.prepare('INSERT INTO alumnos (rut, nombres, apellidos, curso_id) VALUES (?, ?, ?, ?)');
        const porCurso = new Map(cursos.map(id => [id, 0]));
        db.prepare('SELECT curso_id, COUNT(*) AS n FROM alumnos GROUP BY curso_id').all().forEach(r => porCurso.set(r.curso_id, r.n));
        for (let i = 0; i < nuevos; i += 1) {
          let rut;
          do rut = fmtRut(String(22000000 + Math.floor(random() * 5000000))); while (usados.has(rut));
          usados.add(rut);
          const destino = cursoId || [...porCurso.entries()].sort((x, y) => x[1] - y[1])[0][0];
          porCurso.set(destino, (porCurso.get(destino) || 0) + 1);
          const nombres = random() < 0.4 ? `${pick(NOMBRES)} ${pick(NOMBRES)}` : pick(NOMBRES);
          insAlumno.run(rut, nombres, `${pick(APELLIDOS)} ${pick(APELLIDOS)}`, destino);
          rep.alumnosNuevos += 1;
        }
        const alumnos = db.prepare(`SELECT id FROM alumnos ${cursoId ? 'WHERE curso_id = ?' : ''} ORDER BY id`).all(...(cursoId ? [cursoId] : [])).map(r => r.id);

        if (o.reemplazar) {
          const cond = `fecha BETWEEN ? AND ?${cursoId ? ' AND alumno_id IN (SELECT id FROM alumnos WHERE curso_id = ?)' : ''}`;
          const params = cursoId ? [o.desde, o.hasta, cursoId] : [o.desde, o.hasta];
          ACT.forEach(t => { rep.borrados += Number(db.prepare(`DELETE FROM ${t} WHERE ${cond}`).run(...params).changes); });
        }
        // Días con algún registro previo: no se tocan (para no mezclar datos incoherentes).
        const ocupados = new Set(db.prepare(`SELECT alumno_id || '|' || fecha AS k FROM asistencia WHERE fecha BETWEEN ? AND ?
          UNION SELECT alumno_id || '|' || fecha FROM atrasos WHERE fecha BETWEEN ? AND ? UNION SELECT alumno_id || '|' || fecha FROM retiros WHERE fecha BETWEEN ? AND ?
          UNION SELECT alumno_id || '|' || fecha FROM reingresos WHERE fecha BETWEEN ? AND ?`).all(o.desde, o.hasta, o.desde, o.hasta, o.desde, o.hasta, o.desde, o.hasta).map(r => r.k));

        // Días difíciles (lluvia, problemas de transporte): ~10 % de los días, con el triple de atrasos.
        const dificil = new Map(dias.map(f => [f, random() < 0.10 ? 3 : 1]));
        const reparto = CARGAS[carga];
        const totalPeso = Object.values(reparto).reduce((s, v) => s + v, 0);
        const insS = db.prepare('INSERT INTO asistencia (alumno_id, fecha, estado) VALUES (?, ?, ?)');
        const insT = db.prepare('INSERT INTO atrasos (alumno_id, fecha, hora_llegada, justificado) VALUES (?, ?, ?, ?)');
        const insR = db.prepare('INSERT INTO retiros (alumno_id, fecha, hora_retiro, retira, motivo) VALUES (?, ?, ?, ?, ?)');
        const insI = db.prepare('INSERT INTO reingresos (alumno_id, fecha, hora_reingreso, motivo) VALUES (?, ?, ?, ?)');

        for (const alumnoId of alumnos) {
          let punto = random() * totalPeso, perfil = 'regular';
          for (const [nombre, peso] of Object.entries(reparto)) { punto -= peso; if (punto <= 0) { perfil = nombre; break; } }
          rep.perfiles[perfil] = (rep.perfiles[perfil] || 0) + 1;
          const p = PERFILES[perfil];
          let racha = 0;
          for (const fecha of dias) {
            if (ocupados.has(`${alumnoId}|${fecha}`)) { rep.omitidosExistentes += 1; racha = 0; continue; }
            const w = weekday(fecha);
            let estado = 'P';
            if (racha > 0) { estado = 'A'; racha -= 1; }
            else if (random() < p.a * (w === 1 || w === 5 ? 1.4 : 1)) {
              estado = 'A';
              // Racha de enfermedad: 40 % de las ausencias duran de 2 a 4 días.
              if (random() < 0.4) racha = 1 + Math.floor(random() * 3);
            } else if (random() < Math.min(0.85, p.t * dificil.get(fecha) * (w === 1 ? 1.25 : 1))) estado = 'T';
            insS.run(alumnoId, fecha, estado); rep.asistencia += 1; rep[estado] += 1;
            if (estado === 'A') continue;
            if (estado === 'T') {
              // La mayoría llega pocos minutos tarde; unos pocos, cerca de las 09:30.
              const llegada = 8 * 60 + 5 + Math.floor(Math.pow(random(), 2.2) * 85);
              insT.run(alumnoId, fecha, hhmm(llegada), random() < 0.3 ? 1 : 0); rep.atrasos += 1;
            }
            let retiroMin = null;
            if (random() < p.ret) {
              retiroMin = 10 * 60 + 15 * Math.floor(random() * 24);
              insR.run(alumnoId, fecha, hhmm(retiroMin), pick(QUIEN_RETIRA), pick(MOTIVOS_RETIRO)); rep.retiros += 1;
            }
            // Reingreso: vuelve tras un retiro corto (control médico) o llega después de un trámite.
            if (retiroMin !== null && retiroMin <= 13 * 60 && random() < 0.3) {
              insI.run(alumnoId, fecha, hhmm(retiroMin + 90 + 15 * Math.floor(random() * 6)), 'Control médico'); rep.reingresos += 1;
            } else if (retiroMin === null && random() < p.rei) {
              insI.run(alumnoId, fecha, hhmm(9 * 60 + 45 + 15 * Math.floor(random() * 12)), pick(MOTIVOS_REINGRESO)); rep.reingresos += 1;
            }
          }
        }
        return rep;
      });
      res.json(report);
    } catch (error) { sendError(res, sqliteError(error)); }
  });

  router.post('/tablas/:tabla/masivo', (req, res) => {
    try {
      const table = getTable(req.params.tabla);
      const random = seededRandom(req.body && req.body.seed);
      const rows = generatedRows(table, req.body || {}, random);
      if (req.body.preview) return res.json({ preview: rows.slice(0, 10), generated: rows.length });
      const { columns } = getSchema(table);
      const duplicateMode = req.body.duplicateMode === 'overwrite' ? 'overwrite' : 'ignore';
      const report = { generated: rows.length, inserted: 0, overwritten: 0, omitted: 0, reasons: {} };
      db.prepare('BEGIN').run();
      try {
        for (const row of rows) {
          const names = Object.keys(row).filter(name => columns.some(column => column.name === name));
          try {
            const placeholders = names.map(() => '?').join(', ');
            let sql = `INSERT ${duplicateMode === 'ignore' ? 'OR IGNORE ' : ''}INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`;
            const primaryKey = columns.filter(column => column.pk > 0).map(column => column.name);
            if (duplicateMode === 'overwrite' && primaryKey.length) {
              sql += ` ON CONFLICT (${primaryKey.map(quoteIdentifier).join(', ')}) DO UPDATE SET ${names.filter(name => !primaryKey.includes(name)).map(name => `${quoteIdentifier(name)} = excluded.${quoteIdentifier(name)}`).join(', ') || `${quoteIdentifier(primaryKey[0])} = excluded.${quoteIdentifier(primaryKey[0])}`}`;
            }
            const result = db.prepare(sql).run(...names.map(name => row[name]));
            if (Number(result.changes)) report.inserted += 1;
            else report.omitted += 1;
            if (duplicateMode === 'overwrite' && Number(result.changes)) report.overwritten += 1;
          } catch (error) {
            report.omitted += 1;
            const reason = String(error.message).replace(/^SQLITE_CONSTRAINT:\s*/i, '');
            report.reasons[reason] = (report.reasons[reason] || 0) + 1;
          }
        }
        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }
      res.json(report);
    } catch (error) {
      sendError(res, sqliteError(error));
    }
  });

  router.post('/tablas/:tabla/importar-csv', (req, res) => {
    try {
      const table = getTable(req.params.tabla);
      if (typeof req.body.csv !== 'string') throw Object.assign(new Error('Debe enviar el contenido CSV en el campo csv.'), { statusCode: 400 });
      const parsed = parseCsv(req.body.csv);
      if (parsed.length < 2) throw Object.assign(new Error('El CSV debe tener encabezado y al menos una fila.'), { statusCode: 400 });
      const { columns } = getSchema(table);
      const headers = parsed[0].map(value => value.trim());
      const validHeaders = headers.filter(header => columns.some(column => column.name === header));
      if (!validHeaders.length || validHeaders.length !== headers.length) throw Object.assign(new Error('El CSV contiene columnas que no existen en la tabla.'), { statusCode: 400 });
      const report = { generated: parsed.length - 1, inserted: 0, omitted: 0, reasons: {} };
      db.prepare('BEGIN').run();
      try {
        for (const values of parsed.slice(1)) {
          const data = Object.fromEntries(headers.map((header, index) => [header, values[index] === '' ? null : values[index]]));
          try {
            const result = db.prepare(`INSERT ${req.body.duplicateMode === 'ignore' ? 'OR IGNORE ' : ''}INTO ${quoteIdentifier(table)} (${headers.map(quoteIdentifier).join(', ')}) VALUES (${headers.map(() => '?').join(', ')})`).run(...headers.map(header => data[header]));
            if (Number(result.changes)) report.inserted += 1; else report.omitted += 1;
          } catch (error) {
            report.omitted += 1;
            const reason = String(error.message).replace(/^SQLITE_CONSTRAINT:\s*/i, '');
            report.reasons[reason] = (report.reasons[reason] || 0) + 1;
          }
        }
        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }
      res.json(report);
    } catch (error) {
      sendError(res, sqliteError(error));
    }
  });

  return router;
}

module.exports = { createAdminRouter };
