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
const auditoriaRouter = require('./routes/auditoria');
const dashboardRouter = require('./routes/dashboard');
const graficosRouter = require('./routes/graficos');
const setupRouter = require('./routes/setup');
const cuentaRouter = require('./routes/cuenta');
const ajustesRouter = require('./routes/ajustes');
const registroRouter = require('./routes/registro');
const exportarRouter = require('./routes/exportar');
const respaldoRouter = require('./routes/respaldo');
const { requerirSesion } = require('./middleware/sesion');
const { requerirRedLocal } = require('./middleware/red_local');
const { requerirRol } = require('./middleware/roles');
const { requerirLoopback } = require('./middleware/loopback');
const { origenPermitido } = require('./services/red');
const path = require('path');
const { abrirDb } = require('./services/asistencia');

try {
  const dbInicial = abrirDb();
  dbInicial.close();
} catch (error) {
  console.error('No se pudo inicializar la base de datos:', error.message);
}

const app = express();
const FRONT_DIR = process.env.FRONT_DIR || path.join(__dirname, '..', '..', 'desktop', 'front-dist');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'http://127.0.0.1:3005'],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      // En el PC se sirve por http en 127.0.0.1; en la red, por https (no forzar upgrade)
      upgradeInsecureRequests: null,
    },
  },
  hsts: false,
}));
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
app.use('/api/setup', requerirLoopback, setupRouter);
app.use('/api/asistencia', requerirSesion, asistenciaRouter);
app.use('/api/sync', requerirSesion, syncRouter);
app.use('/api/portal', requerirSesion, requerirLoopback, portalRouter);
app.use('/api/red', requerirSesion, redRouter);
app.use('/api/cuenta', requerirSesion, cuentaRouter);
app.use('/api/usuarios', requerirSesion, requerirRol('admin'), usuariosRouter);
app.use('/api/auditoria', requerirSesion, auditoriaRouter);
app.use('/api/dashboard', requerirSesion, dashboardRouter);
app.use('/api/graficos', requerirSesion, graficosRouter);
app.use('/api/registro', requerirSesion, registroRouter);
app.use('/api/exportar', requerirSesion, exportarRouter);
app.use('/api/respaldo', requerirSesion, respaldoRouter);
app.use('/api/ajustes', requerirSesion, requerirLoopback, ajustesRouter);
app.get('/api/cursos', requerirSesion, (req, res) => {
  try {
    const cursos = require('./db/conexion').prepare(`
      SELECT c.nombre AS curso, COUNT(DISTINCT m.rut_alumno) AS alumnos
      FROM curso c
      JOIN matricula m ON m.id_curso = c.id_curso
      WHERE m.anio = (SELECT MAX(anio) FROM matricula)
      GROUP BY c.id_curso, c.nombre
      ORDER BY c.nombre
    `).all();
    res.json({ cursos });
  } catch (error) {
    console.error('Error al consultar cursos:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los cursos.' });
  }
});

app.use(express.static(FRONT_DIR));

// Cualquier otra URL: 404 sin detalles
app.use((req, res) => res.status(404).json({ error: 'No encontrado.' }));

// Errores no controlados (p. ej. JSON mal formado): mensaje genérico, sin stack ni rutas del PC
app.use((error, req, res, next) => {
  console.error('Error en la petición:', error.message);
  const estado = error.status || 500;
  res.status(estado).json({ error: estado < 500 ? 'Solicitud inválida.' : 'Error interno.' });
});

module.exports = app;