const crypto = require('crypto');

// Sincronizaciones con el portal: una a la vez. Sirve de candado para todas las rutas de
// /api/sync y permite que el teléfono pida una sincronización al PC y consulte cómo va
// (la extracción puede tardar minutos y la petición del teléfono se corta si se bloquea la pantalla).
// Se conserva la última tarea terminada para que quien la pidió pueda leer el resultado.

let actual = null;

// Lo que se expone por la API (sin funciones ni credenciales)
const publica = (tarea) => (tarea ? { ...tarea } : null);

const ocupado = () => actual?.estado === 'en_curso';

const obtenerActual = () => publica(actual);

const obtener = (id) => (actual && actual.id === id ? publica(actual) : null);

// Corre `fn` (async, devuelve { estado, datos }) como tarea, sin esperarla.
// Devuelve { tarea, terminado }: `terminado` es la promesa con el { estado, datos } final.
// Quien llama debe revisar ocupado() antes; si igual está ocupado, lanza SINCRONIZACION_EN_CURSO.
function ejecutar({ tipo, parametros = {}, origen }, fn) {
  if (ocupado()) {
    const error = new Error('Ya hay una sincronización en curso.');
    error.code = 'SINCRONIZACION_EN_CURSO';
    throw error;
  }
  const tarea = {
    id: crypto.randomUUID(),
    tipo,
    parametros,
    origen,
    estado: 'en_curso',
    inicio: new Date().toISOString(),
    fin: null,
    resultado: null,
    error: null,
    // Texto de avance mientras corre (p. ej. "Reintentando (2 de 3)…"); null si no hay nada que contar
    detalle: null,
  };
  actual = tarea;

  const terminado = (async () => {
    let respuesta;
    try {
      respuesta = await fn();
    } catch (error) {
      console.error(`Tarea de sincronización (${tipo}):`, error.message);
      respuesta = {
        estado: 500,
        datos: { ok: false, codigo: 'SYNC_FAILED', mensaje: 'No se pudo completar la sincronización.' },
      };
    }
    const exitosa = respuesta.estado >= 200 && respuesta.estado < 300;
    tarea.detalle = null;
    tarea.estado = exitosa ? 'ok' : 'error';
    tarea.fin = new Date().toISOString();
    if (exitosa) tarea.resultado = respuesta.datos;
    else {
      tarea.error = {
        estado: respuesta.estado,
        codigo: respuesta.datos?.codigo || 'SYNC_FAILED',
        mensaje: respuesta.datos?.mensaje || 'No se pudo completar la sincronización.',
      };
    }
    return respuesta;
  })();

  return { tarea: publica(tarea), terminado };
}

// Avance de la tarea en curso (lo leen el PC y el teléfono al consultar la tarea)
function actualizarDetalle(texto) {
  if (actual?.estado === 'en_curso') actual.detalle = texto || null;
}

module.exports = {
  ocupado,
  obtenerActual,
  obtener,
  ejecutar,
  actualizarDetalle,
};
