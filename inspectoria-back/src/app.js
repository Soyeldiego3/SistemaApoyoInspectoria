const express = require('express');
const authRouter = require('./routes/auth');
const asistenciaRouter = require('./routes/asistencia');
const syncRouter = require('./routes/sync');

const app = express();

app.use(express.json());

app.get('/api/salud', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/asistencia', asistenciaRouter);
app.use('/api/sync', syncRouter);

module.exports = app;