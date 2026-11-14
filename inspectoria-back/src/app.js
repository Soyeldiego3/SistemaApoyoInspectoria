const express = require('express');
const authRouter = require('./routes/auth');
const asistenciaRouter = require('./routes/asistencia');
const syncRouter = require('./routes/sync');
const { requerirSesion } = require('./middleware/sesion');

const app = express();

app.use(express.json());

app.get('/api/salud', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/asistencia', requerirSesion, asistenciaRouter);
app.use('/api/sync', requerirSesion, syncRouter);

module.exports = app;