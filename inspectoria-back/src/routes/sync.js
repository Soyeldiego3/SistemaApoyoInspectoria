const express = require('express');
const dbReadOnly = require('../db/conexion');
const { abrirSesion } = require('../extractores/sesion_portal');
const { descargarAsistencia } = require('../extractores/extraer_asistencia');
const { extraerTablaAtrasos } = require('../extractores/extraer_atrasos');
const { extraerCursos } = require('../extractores/extraer_cursos');
const { parsearAsistencia, abrirDb, guardar, transaccion } = require('../services/asistencia');
const { parsearAtrasos, guardarAtrasos } = require('../services/atrasos');
const credencialesPortal = require('../services/credenciales_portal');
const configuracion = require('../services/configuracion');

const router = express.Router();
const URL_PORTAL_CONFIGURADA = process.env.PORTAL_URL;
let dbWritable;
let sincronizacionEnCurso = false;
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

function registrarEjecucion(exitosa) {
  const ahora = new Date();
  const fecha = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  obtenerDbWritable().prepare(`
    INSERT INTO sync_ejecucion (fecha, exitosa)
    VALUES (?, ?)
  `).run(fecha, exitosa ? 1 : 0);
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

router.post('/descargar-e-importar', async (req, res) => {
  if (sincronizacionEnCurso) {
    return res.status(409).json({
      ok: false,
      codigo: 'SINCRONIZACION_EN_CURSO',
      mensaje: 'Ya hay una sincronización en curso.',
    });
  }
  sincronizacionEnCurso = true;
  const inicioSync = Date.now();
  let sesion;
  let credencialesGuardadas = false;
  let credencialesUsadas;
  const responder = (estado, datos, exitosa = false) => {
    try {
      registrarEjecucion(exitosa);
    } catch (error) {
      console.error('Error al registrar la ejecución de sincronización:', error.message);
    }
    return res.status(estado).json(datos);
  };
  try {
    const {
      usuario, pass, recordar, enMemoria, urlPortal, periodo, desde, hasta, soloFaltantes,
    } = req.body ?? {};
    const tieneCredencialesBody = typeof usuario === 'string' && usuario.trim()
      && typeof pass === 'string' && pass;
    if (usuario !== undefined || pass !== undefined) {
      if (!tieneCredencialesBody) {
        return responder(400, {
          ok: false,
          codigo: 'CREDENCIALES_REQUERIDAS',
          mensaje: 'Usuario y contraseña del portal son obligatorios.',
        });
      }
    }

    credencialesGuardadas = !tieneCredencialesBody;
    const credenciales = tieneCredencialesBody
      ? { usuario: usuario.trim(), pass, urlPortal }
      : credencialesPortal.leerDisponibles();
    credencialesUsadas = credenciales;
    if (!credenciales) {
      return responder(400, {
        ok: false,
        codigo: 'CREDENCIALES_REQUERIDAS',
        mensaje: 'Ingresa o actualiza las credenciales del portal para sincronizar.',
      });
    }
    if (credencialesGuardadas && credenciales.invalidas) {
      return responder(400, {
        ok: false,
        codigo: 'CREDENCIALES_REQUERIDAS',
        mensaje: 'Las credenciales guardadas son inválidas. Actualízalas para sincronizar.',
      });
    }
    if (!credenciales.urlPortal) credenciales.urlPortal = URL_PORTAL_CONFIGURADA;

    // TODO: convertir a job asíncrono
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

    let totalAlumnos = 0;
    let filasAsistencia = 0;
    let filasAtrasos = 0;
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
    });

    configuracion.guardar({ ultimaSincronizacionExitosa: new Date().toISOString() });
    // Cuánto tardó (para comparar la sincronización del año completo con la de 2 meses)
    const duracionMs = Date.now() - inicioSync;
    console.log(`Sincronización (${plan.modo}): ${meses.length} mes(es) × ${cursos.length} curso(s) en ${Math.round(duracionMs / 1000)} s.`);
    responder(200, {
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
      errores: [],
    }, true);
  } catch (error) {
    if (error.code === 'LOGIN_RECHAZADO') {
      return responder(422, {
        ok: false,
        codigo: 'LOGIN_RECHAZADO',
        mensaje: 'El portal rechazó las credenciales.',
      });
    }
    if (['PORTAL_INACCESIBLE', 'NAVEGADOR_NO_DISPONIBLE', 'ESTRUCTURA_CAMBIADA'].includes(error.code)) {
      const mensajes = {
        PORTAL_INACCESIBLE: 'No se pudo conectar con el portal.',
        NAVEGADOR_NO_DISPONIBLE: 'No se encontró Microsoft Edge disponible.',
        ESTRUCTURA_CAMBIADA: 'El portal cambió y no se pudo extraer la información.',
      };
      const estado = error.code === 'NAVEGADOR_NO_DISPONIBLE' ? 503
        : error.code === 'ESTRUCTURA_CAMBIADA' ? 502
        : 502;
      return responder(estado, { ok: false, codigo: error.code, mensaje: mensajes[error.code] });
    }
    if (error.code === 'SYNC_FAILED') {
      console.error('Error de extracción:', error.cause?.message || error.message);
      return responder(502, {
        ok: false,
        codigo: 'SYNC_FAILED',
        mensaje: 'La sincronización falló y se conservaron los datos anteriores.',
      });
    }
    console.error('Error en sincronización:', error.message);
    responder(500, {
      ok: false,
      codigo: 'SYNC_FAILED',
      mensaje: 'No se pudo completar la sincronización.',
    });
  } finally {
    await sesion?.cerrar();
    sincronizacionEnCurso = false;
  }
});

module.exports = router;
module.exports.calcularMeses = calcularMeses;
