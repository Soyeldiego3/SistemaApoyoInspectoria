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
