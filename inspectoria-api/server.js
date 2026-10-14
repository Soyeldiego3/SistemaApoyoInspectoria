// Servidor mínimo: sirve la página (carpeta public/) y entrega los datos de SQLite como JSON.
const path = require('path');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'inspectoria.sqlite');

const db = new DatabaseSync(DB_FILE, { readOnly: true });   // solo lectura: la página no modifica nada
const todas = sql => db.prepare(sql).all();

const app = express();

// Cursos, alumnos, feriados, meses y la fecha "de hoy" (último día con asistencia registrada).
app.get('/api/base', (req, res) => {
  res.json({
    hoy: db.prepare('SELECT MAX(fecha) AS f FROM asistencia').get().f,
    cursos: todas('SELECT nombre FROM cursos ORDER BY id').map(r => r.nombre),
    feriados: todas('SELECT fecha FROM feriados ORDER BY fecha').map(r => r.fecha),
    alumnos: todas(`SELECT a.rut, a.nombres, a.apellidos, c.nombre AS curso
                    FROM alumnos a JOIN cursos c ON c.id = a.curso_id ORDER BY a.id`)
  });
});

// Una fila por alumno y día: [rut, fecha, estado] (formato compacto, son unas 3.700 filas).
app.get('/api/asistencia', (req, res) => {
  res.json(todas(`SELECT a.rut, s.fecha, s.estado FROM asistencia s
                  JOIN alumnos a ON a.id = s.alumno_id ORDER BY s.fecha, a.id`).map(r => [r.rut, r.fecha, r.estado]));
});

app.get('/api/atrasos', (req, res) => {
  res.json(todas(`SELECT a.rut, t.fecha, t.hora_llegada AS hora, t.justificado AS just
                  FROM atrasos t JOIN alumnos a ON a.id = t.alumno_id`));
});
app.get('/api/retiros', (req, res) => {
  res.json(todas(`SELECT a.rut, t.fecha, t.hora_retiro AS hora, t.retira AS quien, t.motivo
                  FROM retiros t JOIN alumnos a ON a.id = t.alumno_id`));
});
app.get('/api/reingresos', (req, res) => {
  res.json(todas(`SELECT a.rut, t.fecha, t.hora_reingreso AS hora, t.motivo
                  FROM reingresos t JOIN alumnos a ON a.id = t.alumno_id`));
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, HOST, () => console.log(`Inspectoría en http://${HOST}:${PORT}  (base: ${DB_FILE})`));
