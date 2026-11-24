const express = require('express');
const dbReadOnly = require('../db/conexion');
const { abrirSesion } = require('../extractores/sesion_portal');
const { descargarAsistencia } = require('../extractores/extraer_asistencia');
const { extraerTablaAtrasos } = require('../extractores/extraer_atrasos');
const { extraerCursos } = require('../extractores/extraer_cursos');
const { extraerAsistenciaClaseDia } = require('../extractores/extraer_asistencia_clase');
const { parsearAsistencia, abrirDb, guardar, transaccion } = require('../services/asistencia');
const { parsearAtrasos, guardarAtrasos } = require('../services/atrasos');
const { parsearAsistenciaClase, guardarAsistenciaClase } = require('../services/asistencia_clase');
const credencialesPortal = require('../services/credenciales_portal');
const configuracion = require('../services/configuracion');
const tareas = require('../services/tareas_sync');
const { esLoopback } = require('../services/red');
const auditoriaSistema = require('../services/auditoria_sistema');
const { conReintentos } = require('../services/reintentos');

const router = express.Router();
const URL_PORTAL_CONFIGURADA = process.env.PORTAL_URL;
let dbWritable;
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function obtenerDbWritable() {
  if (!dbWritable) dbWritable = abrirDb();
  return dbWritable;
}

const INICIO_ANIO_ESCOLAR = 2; // marzo (índice 0-based)
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Meses (YYYY-MM) que ya tienen asistencia guardada
function mesesConDatos(db) {
  return new Set(db.prepare('SELECT DISTINCT substr(fecha, 1, 7) AS mes FROM asistencia').all().map((fila) => fila.mes));
}

// Decide qué meses descargar (índices 0-based del año en curso).
// - por defecto: el año escolar (marzo al mes actual). El mes actual y el anterior se
//   descargan siempre; los anteriores solo si aún no están en la base, así la primera
//   sincronización trae el año completo y las siguientes siguen siendo rápidas.
// - periodo 'anio': de marzo al mes actual, todos (fuerza volver a descargarlos)
// - desde/hasta: los meses del rango dentro de marzo..mes actual; con soloFaltantes
//   se omiten los que ya tienen asistencia guardada
function calcularMeses(db, { periodo, desde, hasta, soloFaltantes }, ahora = new Date()) {
  const anio = ahora.getFullYear();
  const actual = ahora.getMonth();
  const advertencias = [];
  const rango = (inicio, fin) => {
    const lista = [];
    for (let m = inicio; m <= fin; m += 1) lista.push(m);
    return lista;
  };

  if (FECHA_ISO.test(desde || '') && FECHA_ISO.test(hasta || '')) {
    const [anioDesde, mesDesde] = desde.split('-').map(Number);
    const [anioHasta, mesHasta] = hasta.split('-').map(Number);
    let inicio = anioDesde < anio ? 0 : mesDesde - 1;
    let fin = anioHasta > anio ? 11 : mesHasta - 1;
    if (anioDesde < anio || inicio < INICIO_ANIO_ESCOLAR) {
      advertencias.push('El portal solo entrega el año escolar en curso (desde marzo).');
      inicio = Math.max(inicio, INICIO_ANIO_ESCOLAR);
    }
    if (anioHasta > anio || fin > actual) fin = actual;
    let meses = inicio <= fin && anioHasta >= anio ? rango(inicio, fin) : [];
    if (soloFaltantes && meses.length) {
      const conDatos = mesesConDatos(db);
      meses = meses.filter((m) => !conDatos.has(`${anio}-${String(m + 1).padStart(2, '0')}`));
    }
    return { modo: 'rango', meses, advertencias };
  }

  if (periodo === 'anio' && actual > INICIO_ANIO_ESCOLAR) {
    return { modo: 'anio', meses: rango(INICIO_ANIO_ESCOLAR, actual), advertencias };
  }
  // Antes de marzo no hay año escolar: solo el mes actual (como siempre)
  if (actual <= INICIO_ANIO_ESCOLAR) return { modo: 'normal', meses: [actual], advertencias };
  const conDatos = mesesConDatos(db);
  const meses = rango(INICIO_ANIO_ESCOLAR, actual).filter((m) => m >= actual - 1
    || !conDatos.has(`${anio}-${String(m + 1).padStart(2, '0')}`));
  return { modo: 'normal', meses, advertencias };
}

// Fecha local del PC en YYYY-MM-DD
function fechaLocal(fecha = new Date()) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function registrarEjecucion(exitosa) {
  obtenerDbWritable().prepare(`
    INSERT INTO sync_ejecucion (fecha, exitosa)
    VALUES (?, ?)
  `).run(fechaLocal(), exitosa ? 1 : 0);
}

// Parsea lo extraído de "Asistencia por clase". Lo que no se puede leer pasa a advertencias
// en vez de tumbar el resto. Entrada: { tablas, errores } de extraerAsistenciaClaseDia().
function parsearTablasClase({ tablas, errores }) {
  const advertencias = errores.map(({ curso, mensaje }) => {
    console.error(`Asistencia por clase, ${curso}:`, mensaje);
    return `${curso}: no se pudo leer la asistencia por clase.`;
  });
  const datos = [];
  for (const tabla of tablas) {
    try {
      datos.push(parsearAsistenciaClase(tabla));
    } catch (error) {
      advertencias.push(`${tabla.curso} ${tabla.bloque}: ${error.message}`);
    }
  }
  return { datos, advertencias };
}

// Credenciales del body (si vienen) o las guardadas. Devuelve { credenciales, guardadas } o { error }.
function resolverCredenciales(body) {
  const { usuario, pass, urlPortal } = body ?? {};
  const tieneCredencialesBody = typeof usuario === 'string' && usuario.trim()
    && typeof pass === 'string' && pass;
  if ((usuario !== undefined || pass !== undefined) && !tieneCredencialesBody) {
    return { error: {
      ok: false,
      codigo: 'CREDENCIALES_REQUERIDAS',
      mensaje: 'Usuario y contraseña del portal son obligatorios.',
    } };
  }
  const guardadas = !tieneCredencialesBody;
  const credenciales = tieneCredencialesBody
    ? { usuario: usuario.trim(), pass, urlPortal }
    : credencialesPortal.leerDisponibles();
  if (!credenciales) {
    return { error: {
      ok: false,
      codigo: 'CREDENCIALES_REQUERIDAS',
      mensaje: 'Ingresa o actualiza las credenciales del portal para sincronizar.',
    } };
  }
  if (guardadas && credenciales.invalidas) {
    return { error: {
      ok: false,
      codigo: 'CREDENCIALES_REQUERIDAS',
      mensaje: 'Las credenciales guardadas son inválidas. Actualízalas para sincronizar.',
    } };
  }
  if (!credenciales.urlPortal) credenciales.urlPortal = URL_PORTAL_CONFIGURADA;
  return { credenciales, guardadas };
}

// Traduce los errores del portal a { estado, datos }; null si no es un error del portal.
function errorPortal(error) {
  if (error.code === 'LOGIN_RECHAZADO') {
    return { estado: 422, datos: { ok: false, codigo: 'LOGIN_RECHAZADO', mensaje: 'El portal rechazó las credenciales.' } };
  }
  const mensajes = {
    PORTAL_INACCESIBLE: 'No se pudo conectar con el portal.',
    NAVEGADOR_NO_DISPONIBLE: 'No se encontró Microsoft Edge disponible.',
    ESTRUCTURA_CAMBIADA: 'El portal cambió y no se pudo extraer la información.',
  };
  if (!mensajes[error.code]) return null;
  const estado = error.code === 'NAVEGADOR_NO_DISPONIBLE' ? 503 : 502;
  return { estado, datos: { ok: false, codigo: error.code, mensaje: mensajes[error.code] } };
}

router.get('/cursos', (req, res) => {
  try {
    const cursos = dbReadOnly
      .prepare('SELECT nombre FROM curso ORDER BY nombre')
      .all()
      .map((curso) => curso.nombre);

    res.json({ cursos });
  } catch (error) {
    console.error('Error al consultar cursos:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los cursos.' });
  }
});

// ---- Tareas ----
// Las extracciones corren como tarea (services/tareas_sync.js): una a la vez.
// Sin `segundoPlano` la petición espera el resultado (como siempre, lo usa el PC).
// Con `segundoPlano: true` responde 202 { tarea } al tiro y el resultado se consulta en
// GET /tarea/:id; así el teléfono le pide la sincronización al PC sin depender de una
// petición de minutos que se corta al bloquear la pantalla.

function enCurso(res) {
  return res.status(409).json({
    ok: false,
    codigo: 'SINCRONIZACION_EN_CURSO',
    mensaje: 'Ya hay una sincronización en curso.',
    tarea: tareas.obtenerActual(),
  });
}

// Solo parámetros de la extracción (nunca credenciales) para mostrarlos en la tarea
function parametrosPublicos(body, claves) {
  return Object.fromEntries(claves.filter((clave) => body?.[clave] !== undefined).map((clave) => [clave, body[clave]]));
}

async function correrTarea(req, res, { tipo, parametros }, fn) {
  if (tareas.ocupado()) return enCurso(res);
  const segundoPlano = req.body?.segundoPlano === true;
  const origen = esLoopback(req.socket.remoteAddress) ? 'pc' : 'telefono';
  const { tarea, terminado } = tareas.ejecutar({ tipo, parametros, origen }, fn);
  // En segundo plano, si faltan credenciales se responde el error al tiro (no toca el portal)
  if (segundoPlano && !resolverCredenciales(req.body).error) return res.status(202).json({ ok: true, tarea });
  const { estado, datos } = await terminado;
  return res.status(estado).json(datos);
}

router.get('/tarea', (req, res) => {
  res.json({ tarea: tareas.obtenerActual() });
});

router.get('/tarea/:id', (req, res) => {
  const tarea = tareas.obtener(req.params.id);
  if (!tarea) {
    return res.status(404).json({ ok: false, codigo: 'TAREA_NO_ENCONTRADA', mensaje: 'La sincronización ya no está disponible.' });
  }
  res.json({ tarea });
});

// Sincronización completa (asistencia de los meses, atrasos y asistencia por clase de hoy).
// Devuelve { estado, datos } para responder.
async function sincronizarCompleta(body) {
  const inicioSync = Date.now();
  let sesion;
  const responder = (estado, datos, exitosa = false) => {
    try {
      registrarEjecucion(exitosa);
    } catch (error) {
      console.error('Error al registrar la ejecución de sincronización:', error.message);
    }
    return { estado, datos };
  };
  try {
    const {
      recordar, enMemoria, periodo, desde, hasta, soloFaltantes,
    } = body ?? {};
    const resuelto = resolverCredenciales(body);
    if (resuelto.error) return responder(400, resuelto.error);
    const { credenciales } = resuelto;

    const mes = MESES[new Date().getMonth()];
    const db = obtenerDbWritable();
    const plan = calcularMeses(db, { periodo, desde, hasta, soloFaltantes });
    const advertencias = [...plan.advertencias];
    const meses = plan.meses.map((m) => MESES[m]);
    // A pedido (rango): el mes actual no es obligatorio y los atrasos no se vuelven a leer,
    // porque el portal solo entrega una ventana de ~1 mes de atrasos.
    const aPedido = plan.modo === 'rango';
    if (aPedido && !meses.length) {
      return responder(200, {
        mensaje: 'No hay meses pendientes por descargar en ese rango.',
        mes,
        meses: [],
        advertencias,
        totalCursos: 0,
        cursosProcesados: 0,
        totalAlumnos: 0,
        filasAsistencia: 0,
        filasAtrasos: 0,
        errores: [],
      }, true);
    }
    sesion = await abrirSesion(credenciales);
    credencialesPortal.registrarExito(credenciales);
    if (recordar) credencialesPortal.guardar(credenciales);
    else if (enMemoria) credencialesPortal.guardarEnMemoria(credenciales);
    const cursos = await extraerCursos(sesion.page);
    if (!cursos.length) {
      return responder(404, {
        ok: false,
        codigo: 'ESTRUCTURA_CAMBIADA',
        mensaje: 'El portal cambió y no se encontraron cursos.',
      });
    }

    const paquetes = [];

    for (const curso of cursos) {
      try {
        // Meses anteriores: si el portal no los entrega se avisa, pero no se cae la sincronización.
        // En modo normal/anual el mes actual sí es obligatorio, igual que antes.
        const datosMeses = [];
        for (const m of meses) {
          try {
            datosMeses.push(parsearAsistencia(await descargarAsistencia(sesion.page, curso, m)));
          } catch (error) {
            if (!aPedido && m === mes) throw error;
            advertencias.push(`${curso}: no se pudo descargar ${m}.`);
            console.error(`Sincronización, ${curso} ${m}:`, error.message);
          }
        }
        if (aPedido) {
          if (datosMeses.length) paquetes.push({ data: datosMeses.at(-1), anteriores: datosMeses.slice(0, -1), atrasos: null });
          continue;
        }
        const data = datosMeses.at(-1);
        const atrasos = parsearAtrasos(await extraerTablaAtrasos(sesion.page, curso));
        const fechasAtrasos = atrasos.map((atraso) => atraso.fecha);
        const mm = String(data.mes).padStart(2, '0');
        const ultimoDia = new Date(data.anio, data.mes, 0).getDate();
        paquetes.push({
          data,
          anteriores: datosMeses.slice(0, -1),
          atrasos,
          rango: {
            // Atrasos es una ventana móvil del portal, no el mes del Excel.
            desde: fechasAtrasos.length ? fechasAtrasos.reduce((min, fecha) => fecha < min ? fecha : min) : `${data.anio}-${mm}-01`,
            hasta: fechasAtrasos.length ? fechasAtrasos.reduce((max, fecha) => fecha > max ? fecha : max) : `${data.anio}-${mm}-${ultimoDia}`,
            curso: data.curso,
          },
        });
      } catch (error) {
        const fallo = new Error(`No se pudo extraer el curso ${curso}.`);
        fallo.code = 'SYNC_FAILED';
        fallo.cause = error;
        throw fallo;
      }
    }

    if (aPedido && !paquetes.length) {
      const fallo = new Error('No se pudo descargar ningún mes del rango pedido.');
      fallo.code = 'SYNC_FAILED';
      throw fallo;
    }

    // Asistencia por clase de hoy, con la misma sesión. Es un extra: si falla, se avisa
    // pero la sincronización sigue. Los fines de semana no hay clases.
    let clase = { datos: [], advertencias: [] };
    const diaSemana = new Date().getDay();
    if (!aPedido && diaSemana !== 0 && diaSemana !== 6) {
      try {
        clase = parsearTablasClase(await extraerAsistenciaClaseDia(sesion.page, { fecha: fechaLocal(), cursos }));
      } catch (error) {
        console.error('Asistencia por clase de hoy:', error.cause?.message || error.message);
        clase.advertencias.push('No se pudo traer la asistencia por clase de hoy.');
      }
      advertencias.push(...clase.advertencias);
    }

    let totalAlumnos = 0;
    let filasAsistencia = 0;
    let filasAtrasos = 0;
    let filasClase = 0;
    // No se borra lo anterior: guardar() reemplaza curso+mes y guardarAtrasos() su ventana,
    // así los meses ya descargados (p. ej. a pedido desde Auditar) se conservan.
    // El borrado total sigue ocurriendo al cerrar la app (limpiarAlCerrar).
    transaccion(db, () => {
      for (const paquete of paquetes) {
        for (const anterior of paquete.anteriores) filasAsistencia += guardar(db, anterior, { transaccionar: false });
        filasAsistencia += guardar(db, paquete.data, { transaccionar: false });
        totalAlumnos += paquete.data.alumnos.length;
        if (paquete.atrasos) {
          filasAtrasos += guardarAtrasos(db, paquete.atrasos, { ...paquete.rango, transaccionar: false });
        }
      }
      for (const data of clase.datos) filasClase += guardarAsistenciaClase(db, data, { transaccionar: false });
    });

    configuracion.guardar({ ultimaSincronizacionExitosa: new Date().toISOString() });
    // Cuánto tardó (para comparar la sincronización del año completo con la de 2 meses)
    const duracionMs = Date.now() - inicioSync;
    console.log(`Sincronización (${plan.modo}): ${meses.length} mes(es) × ${cursos.length} curso(s) en ${Math.round(duracionMs / 1000)} s.`);
    return responder(200, {
      mensaje: 'Proceso completado',
      mes,
      meses,
      duracionMs,
      advertencias,
      totalCursos: cursos.length,
      cursosProcesados: paquetes.length,
      totalAlumnos,
      filasAsistencia,
      filasAtrasos,
      filasClase,
      errores: [],
    }, true);
  } catch (error) {
    const portal = errorPortal(error);
    if (portal) return responder(portal.estado, portal.datos);
    if (error.code === 'SYNC_FAILED') {
      console.error('Error de extracción:', error.cause?.message || error.message);
      return responder(502, {
        ok: false,
        codigo: 'SYNC_FAILED',
        mensaje: 'La sincronización falló y se conservaron los datos anteriores.',
      });
    }
    console.error('Error en sincronización:', error.message);
    return responder(500, {
      ok: false,
      codigo: 'SYNC_FAILED',
      mensaje: 'No se pudo completar la sincronización.',
    });
  } finally {
    await sesion?.cerrar();
  }
}

// SLA 1: la sincronización completa se reintenta sola ante fallas transitorias
// (services/reintentos.js): 3 intentos, esperando 30 s y luego 90 s (menos de 5 min en total).
// Cada intento queda en sync_ejecucion (el KPI TSE cuenta intentos ejecutados).
// SYNC_ESPERAS_MS (ej. "100,100") permite acortar las esperas en pruebas.
const ESPERAS_REINTENTO_MS = (process.env.SYNC_ESPERAS_MS || '30000,90000')
  .split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0);
const CODIGOS_REINTENTABLES = ['PORTAL_INACCESIBLE', 'SYNC_FAILED'];

function sincronizarConReintentos(body) {
  return conReintentos(() => sincronizarCompleta(body), {
    esperasMs: ESPERAS_REINTENTO_MS,
    esReintentable: (respuesta) => CODIGOS_REINTENTABLES.includes(respuesta.datos?.codigo),
    alReintentar: ({ intento, de, codigo, esperaMs }) => {
      console.warn(`Sincronización: el intento ${intento} de ${de} falló (${codigo}); se reintenta en ${Math.round(esperaMs / 1000)} s.`);
      try {
        auditoriaSistema.registrar('sync.reintento', null, { intento, de, codigo, esperaMs });
      } catch { /* sin log */ }
      tareas.actualizarDetalle(`El intento ${intento} falló; se vuelve a intentar en ${Math.round(esperaMs / 1000)} s…`);
    },
    alIniciarIntento: ({ intento, de }) => tareas.actualizarDetalle(`Reintentando (${intento} de ${de})…`),
  });
}

router.post('/descargar-e-importar', (req, res) => correrTarea(req, res, {
  tipo: 'completa',
  parametros: parametrosPublicos(req.body, ['periodo', 'desde', 'hasta', 'soloFaltantes']),
}, () => sincronizarConReintentos(req.body)));

// Asistencia por clase de TODOS los cursos en una fecha, con un solo inicio de sesión.
// Devuelve { estado, datos }. No cuenta como sincronización (sync_ejecucion).
async function traerAsistenciaClase(body, fecha) {
  const resuelto = resolverCredenciales(body);
  if (resuelto.error) return { estado: 400, datos: resuelto.error };

  const inicio = Date.now();
  let sesion;
  try {
    sesion = await abrirSesion(resuelto.credenciales);
    credencialesPortal.registrarExito(resuelto.credenciales);
    const cursos = await extraerCursos(sesion.page);
    const { datos, advertencias } = parsearTablasClase(await extraerAsistenciaClaseDia(sesion.page, { fecha, cursos }));
    if (!datos.length) advertencias.push(`El portal no tiene asistencia por clase para el ${fecha.split('-').reverse().join('-')}.`);

    const db = obtenerDbWritable();
    const filas = transaccion(db, () => datos.reduce(
      (total, data) => total + guardarAsistenciaClase(db, data, { transaccionar: false }), 0));
    const cursosConDatos = [...new Set(datos.map((data) => data.curso))];
    console.log(`Asistencia por clase ${fecha}: ${cursosConDatos.length} curso(s), ${datos.length} bloque(s) en ${Math.round((Date.now() - inicio) / 1000)} s.`);
    return {
      estado: 200,
      datos: { ok: true, fecha, cursos: cursosConDatos, bloques: datos.length, filas, advertencias, duracionMs: Date.now() - inicio },
    };
  } catch (error) {
    console.error('Asistencia por clase:', error.cause?.message || error.message);
    const portal = errorPortal(error);
    if (portal) return portal;
    return {
      estado: 502,
      datos: {
        ok: false,
        codigo: 'SYNC_FAILED',
        mensaje: 'No se pudo extraer la asistencia por clase; se conservaron los datos anteriores.',
      },
    };
  } finally {
    await sesion?.cerrar();
  }
}

// Body: { fecha: 'YYYY-MM-DD' } + credenciales opcionales + segundoPlano opcional.
router.post('/asistencia-clase', (req, res) => {
  const { fecha } = req.body ?? {};
  if (!FECHA_ISO.test(fecha || '')) {
    return res.status(400).json({ ok: false, codigo: 'DATOS_INVALIDOS', mensaje: 'Indica la fecha (YYYY-MM-DD).' });
  }
  return correrTarea(req, res, { tipo: 'clase', parametros: { fecha } }, () => traerAsistenciaClase(req.body, fecha));
});

module.exports = router;
module.exports.calcularMeses = calcularMeses;
