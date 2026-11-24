// Respaldo de información.
// GET / descarga (cifrada), POST /restaurar (desde un archivo),
// GET/POST /automaticos (lista / guardar ahora), GET /automaticos/:archivo (descarga),
// POST /automaticos/:archivo/restaurar (solo desde el PC),
// GET/PUT /config: contraseña de respaldo, carpeta externa e intervalo del temporizador,
// POST /elegir-carpeta: diálogo nativo para elegir la carpeta (todo esto solo desde el PC)
const express = require('express');
const fs = require('fs');
const { abrirDb } = require('../services/asistencia');
const {
  generarRespaldo, restaurarRespaldo, restaurarAutomatico, listarAutomaticos, rutaAutomatico, fechaLocal, ErrorRespaldo,
  empaquetar, desempaquetar, claveDeArchivo, configRespaldo, configurarRespaldo, respaldoAutomatico, EXTENSION,
} = require('../services/respaldo');
const { requerirLoopback } = require('../middleware/loopback');
const auditoriaSistema = require('../services/auditoria_sistema');
const respaldoProgramado = require('../services/respaldo_programado');
const electron = require('../services/electron');

const ESPERA_DIALOGO_MS = 10 * 60_000; // el diálogo de carpeta espera a la persona

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
    res.status(500).json({ error: 'No se pudo crear la copia.' });
  }
});

// El archivo llega como bytes (el express.json global solo acepta 100 kb)
router.post('/restaurar', express.raw({ type: 'application/octet-stream', limit: '5mb' }), (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'Elige un archivo de copia de seguridad.' });
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
    res.status(500).json({ error: 'No se pudieron cargar las copias guardadas.' });
  }
});

// "Guardar copia ahora": igual que el automático (si nada cambió, no repite el archivo)
router.post('/automaticos', requerirLoopback, (req, res) => {
  try {
    const resultado = respaldoAutomatico(obtenerDbWritable());
    respaldoProgramado.reprogramar();
    if (resultado.archivo) registrar('respaldo.guardado', req, { archivo: resultado.archivo });
    res.json(resultado);
  } catch (error) {
    responderError(res, error, 'No se pudo guardar la copia');
  }
});

// Recuperar una copia de la lista sin tener que descargarla
router.post('/automaticos/:archivo/restaurar', requerirLoopback, (req, res) => {
  try {
    const resumen = restaurarAutomatico(obtenerDbWritable(), req.params.archivo, contrasenaDe(req));
    registrar('respaldo.restaurado', req, { archivo: req.params.archivo, ...resumen });
    res.json({ ok: true, resumen });
  } catch (error) {
    responderError(res, error, 'No se pudo recuperar la copia');
  }
});

router.get('/automaticos/:archivo', requerirLoopback, (req, res) => {
  try {
    const ruta = rutaAutomatico(req.params.archivo);
    if (!ruta) return res.status(404).json({ error: 'No se encontró esa copia.' });
    const contenido = fs.readFileSync(ruta);
    enviarArchivo(res, contenido, req.params.archivo, claveDeArchivo(contenido));
  } catch (error) {
    console.error('Error al descargar respaldo automático:', error.message);
    res.status(500).json({ error: 'No se pudo descargar la copia.' });
  }
});

router.get('/config', requerirLoopback, (req, res) => {
  try {
    res.json(configRespaldo());
  } catch (error) {
    responderError(res, error, 'No se pudo leer la configuración del respaldo');
  }
});

// Guarda la configuración y, si cambió la contraseña o la carpeta, respalda de inmediato
// (así el pendrive recibe una copia al tiro). Responde la configuración actualizada.
function aplicarConfig(req, cambios) {
  configurarRespaldo(cambios);
  registrar('respaldo.configurado', req, {
    contrasena: cambios.contrasena === undefined ? 'sin cambios' : cambios.contrasena === null ? 'quitada' : 'cambiada',
    ...(cambios.carpetaExterna !== undefined ? { carpetaExterna: cambios.carpetaExterna.trim() || null } : {}),
    ...(cambios.intervaloMin !== undefined ? { intervaloMin: cambios.intervaloMin } : {}),
  });
  if (cambios.contrasena !== undefined || cambios.carpetaExterna !== undefined) {
    try {
      respaldoAutomatico(obtenerDbWritable());
    } catch (error) {
      console.error('No se pudo escribir el respaldo tras configurar:', error.message);
    }
  }
  respaldoProgramado.reprogramar();
  return configRespaldo();
}

router.put('/config', requerirLoopback, (req, res) => {
  try {
    const { contrasena, carpetaExterna, intervaloMin } = req.body ?? {};
    res.json(aplicarConfig(req, { contrasena, carpetaExterna, intervaloMin }));
  } catch (error) {
    responderError(res, error, 'No se pudo guardar la configuración del respaldo');
  }
});

// Abre el diálogo nativo de Electron para elegir la carpeta externa (pendrive).
// Espera hasta que la persona elija o cancele.
router.post('/elegir-carpeta', requerirLoopback, async (req, res) => {
  try {
    if (!electron.disponible()) {
      return res.status(409).json({ error: 'Elegir la carpeta solo funciona en la app de escritorio. Escribe la ubicación de la carpeta.' });
    }
    const respuesta = await electron.pedir(
      { type: 'respaldo:elegir-carpeta' }, 'respaldo:carpeta', ESPERA_DIALOGO_MS, { ruta: null },
    );
    if (typeof respuesta.ruta !== 'string' || !respuesta.ruta) {
      return res.json({ ...configRespaldo(), cancelado: true });
    }
    res.json(aplicarConfig(req, { carpetaExterna: respuesta.ruta }));
  } catch (error) {
    responderError(res, error, 'No se pudo elegir la carpeta');
  }
});

module.exports = router;
