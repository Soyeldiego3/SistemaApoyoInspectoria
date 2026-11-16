const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const authRouter = require('./routes/auth');
const asistenciaRouter = require('./routes/asistencia');
const syncRouter = require('./routes/sync');
const portalRouter = require('./routes/portal');
const redRouter = require('./routes/red');
const usuariosRouter = require('./routes/usuarios');
const { requerirSesion } = require('./middleware/sesion');
const { requerirRedLocal } = require('./middleware/red_local');
const { origenPermitido } = require('./services/red');
const path = require('path');

const app = express();
const FRONT_DIR = process.env.FRONT_DIR || path.join(__dirname, '..', '..', 'desktop', 'front-dist');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: (origin, callback) => callback(null, origenPermitido(origin)) }));
app.use(express.json());
app.use('/api', requerirRedLocal);

app.get('/api/salud', (req, res) => {
  res.json({ ok: true });
});

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.use('/api/auth', loginRateLimit, authRouter);
app.use('/api/asistencia', requerirSesion, asistenciaRouter);
app.use('/api/sync', requerirSesion, syncRouter);
app.use('/api/portal', requerirSesion, portalRouter);
app.use('/api/red', requerirSesion, redRouter);
app.use('/api/usuarios', requerirSesion, usuariosRouter);

app.use(express.static(FRONT_DIR));

module.exports = app;