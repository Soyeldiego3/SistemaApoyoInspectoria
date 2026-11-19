const express = require('express');
const dbReadOnly = require('../db/conexion');
const { abrirSesion } = require('../extractores/sesion_portal');
const { descargarAsistencia } = require('../extractores/extraer_asistencia');
const { extraerTablaAtrasos } = require('../extractores/extraer_atrasos');
const { extraerCursos } = require('../extractores/extraer_cursos');
const { parsearAsistencia, abrirDb, guardar, transaccion } = require('../services/asistencia');
const { parsearAtrasos, guardarAtrasos } = require('../services/atrasos');
const credencialesPortal = require('../services/credenciales_portal');
const { borrarDatosSincronizados } = require('../services/limpieza');
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
    const { usuario, pass, recordar, enMemoria, urlPortal, periodo } = req.body ?? {};
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
    const mesActual = new Date().getMonth();
    const mes = MESES[mesActual];
    // periodo 'anio': año escolar completo, de marzo al mes actual (útil para el Master de registro)
    const INICIO_ANIO_ESCOLAR = 2; // marzo
    const meses = periodo === 'anio' && mesActual > INICIO_ANIO_ESCOLAR
      ? MESES.slice(INICIO_ANIO_ESCOLAR, mesActual + 1)
      : [mes];
    const advertencias = [];
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

    const db = obtenerDbWritable();
    const paquetes = [];

    for (const curso of cursos) {
      try {
        // Meses anteriores: si el portal no los entrega se avisa, pero no se cae la sincronización.
        // El mes actual sí es obligatorio, igual que antes.
        const datosMeses = [];
        for (const m of meses) {
          try {
            datosMeses.push(parsearAsistencia(await descargarAsistencia(sesion.page, curso, m)));
          } catch (error) {
            if (m === mes) throw error;
            advertencias.push(`${curso}: no se pudo descargar ${m}.`);
            console.error(`Sincronización anual, ${curso} ${m}:`, error.message);
          }
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

    let totalAlumnos = 0;
    let filasAsistencia = 0;
    let filasAtrasos = 0;
    transaccion(db, () => {
      borrarDatosSincronizados(db);
      for (const paquete of paquetes) {
        for (const anterior of paquete.anteriores) filasAsistencia += guardar(db, anterior, { transaccionar: false });
        filasAsistencia += guardar(db, paquete.data, { transaccionar: false });
        totalAlumnos += paquete.data.alumnos.length;
        filasAtrasos += guardarAtrasos(db, paquete.atrasos, { ...paquete.rango, transaccionar: false });
      }
    });

    configuracion.guardar({ ultimaSincronizacionExitosa: new Date().toISOString() });
    responder(200, {
      mensaje: 'Proceso completado',
      mes,
      meses,
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
