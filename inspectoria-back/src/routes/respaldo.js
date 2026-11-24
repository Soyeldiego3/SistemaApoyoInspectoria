// Respaldo de información.
// GET / descarga (cifrada), POST /restaurar,
// GET /automaticos y GET /automaticos/:archivo (solo desde el PC),
// GET/PUT /config: contraseña de respaldo y carpeta externa (solo desde el PC)
const express = require('express');
const fs = require('fs');
const { abrirDb } = require('../services/asistencia');
const {
  generarRespaldo, restaurarRespaldo, listarAutomaticos, rutaAutomatico, fechaLocal, ErrorRespaldo,
  empaquetar, desempaquetar, claveDeArchivo, configRespaldo, configurarRespaldo, respaldoAutomatico, EXTENSION,
} = require('../services/respaldo');
const { requerirLoopback } = require('../middleware/loopback');
const auditoriaSistema = require('../services/auditoria_sistema');

const router = express.Router();
let dbWritable;

function obtenerDbWritable() {
  if (!dbWritable) dbWritable = abrirDb();
  return dbWritable;
}

// clave: 'contrasena' | 'equipo' | 'plano' (el front avisa si el archivo no sirve en otro equipo)
function enviarArchivo(res, contenido, nombreArchivo, clave) {
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
    'X-Respaldo-Clave': clave,
    'Access-Control-Expose-Headers': 'Content-Disposition, X-Respaldo-Clave',
  });
  res.send(contenido);
}

// La contraseña llega codificada (encodeURIComponent) porque un header solo admite ASCII
function contrasenaDe(req) {
  const valor = req.get('X-Clave-Respaldo');
  if (!valor) return null;
  try {
    return decodeURIComponent(valor);
  } catch {
    return valor;
  }
}

const responderError = (res, error, mensaje) => {
  if (error instanceof ErrorRespaldo) {
    return res.status(error.status).json({ error: error.message, codigo: error.codigo });
  }
  console.error(`${mensaje}:`, error.message);
  return res.status(500).json({ error: `${mensaje}.` });
};

function registrar(evento, req, detalle) {
  try {
    auditoriaSistema.registrar(evento, req.usuario?.nombre, detalle);
  } catch (error) {
    console.error('No se pudo registrar el evento de respaldo:', error.message);
  }
}

router.get('/', (req, res) => {
  try {
    const respaldo = generarRespaldo(obtenerDbWritable());
    const archivo = empaquetar(respaldo);
    registrar('respaldo.descargado', req, {
      alertas: respaldo.alerta_gestion.length,
      justificativos: respaldo.justificativos.length,
    });
    enviarArchivo(res, archivo, `respaldo-inspectoria-${fechaLocal()}${EXTENSION}`, claveDeArchivo(archivo));
  } catch (error) {
    console.error('Error al generar el respaldo:', error.message);
    res.status(500).json({ error: 'No se pudo generar el respaldo.' });
  }
});

// El archivo llega como bytes (el express.json global solo acepta 100 kb)
router.post('/restaurar', express.raw({ type: 'application/octet-stream', limit: '5mb' }), (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'Elige un archivo de respaldo.' });
    }
    const datos = desempaquetar(req.body, contrasenaDe(req));
    const resumen = restaurarRespaldo(obtenerDbWritable(), datos);
    registrar('respaldo.restaurado', req, resumen);
    res.json({ ok: true, resumen });
  } catch (error) {
    responderError(res, error, 'No se pudo restaurar el respaldo');
  }
});

router.get('/automaticos', requerirLoopback, (req, res) => {
  try {
    res.json({ respaldos: listarAutomaticos() });
  } catch (error) {
    console.error('Error al listar respaldos automáticos:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los respaldos automáticos.' });
  }
});

router.get('/automaticos/:archivo', requerirLoopback, (req, res) => {
  try {
    const ruta = rutaAutomatico(req.params.archivo);
    if (!ruta) return res.status(404).json({ error: 'No se encontró ese respaldo.' });
    const contenido = fs.readFileSync(ruta);
    enviarArchivo(res, contenido, req.params.archivo, claveDeArchivo(contenido));
  } catch (error) {
    console.error('Error al descargar respaldo automático:', error.message);
    res.status(500).json({ error: 'No se pudo descargar el respaldo.' });
  }
});

router.get('/config', requerirLoopback, (req, res) => {
  try {
    res.json(configRespaldo());
  } catch (error) {
    responderError(res, error, 'No se pudo leer la configuración del respaldo');
  }
});

router.put('/config', requerirLoopback, (req, res) => {
  try {
    const { contrasena, carpetaExterna } = req.body ?? {};
    const config = configurarRespaldo({ contrasena, carpetaExterna });
    registrar('respaldo.configurado', req, {
      contrasena: contrasena !== undefined ? 'cambiada' : 'sin cambios',
      carpetaExterna: config.carpetaExterna || null,
    });
    try {
      respaldoAutomatico(obtenerDbWritable());
    } catch (error) {
      console.error('No se pudo escribir el respaldo tras configurar:', error.message);
    }
    res.json(config);
  } catch (error) {
    responderError(res, error, 'No se pudo guardar la configuración del respaldo');
  }
});

module.exports = router;
