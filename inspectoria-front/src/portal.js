// Conexión con el portal institucional: qué equipo es, mensajes de error y sincronización.
import {
  getCredencialesPortal, getTareaSync, iniciarSync, iniciarTareaSync,
} from './api.js';

// La app de escritorio abre el front en localhost; el teléfono entra por la IP del PC.
// Solo en el PC se pueden ingresar credenciales y abrir el navegador del portal.
export const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

export const MENSAJES_PORTAL = {
  LOGIN_RECHAZADO: 'El portal rechazó el usuario o la contraseña',
  PORTAL_INACCESIBLE: 'No se pudo conectar con el portal; revisa la red o la URL',
  NAVEGADOR_NO_DISPONIBLE: 'No se encontró Microsoft Edge',
  ESTRUCTURA_CAMBIADA: 'El portal cambió y no se pudo extraer la información.',
  CREDENCIALES_REQUERIDAS: 'Las credenciales del portal son necesarias para sincronizar.',
};

export const ERRORES_LOGIN = ['CREDENCIALES_REQUERIDAS', 'LOGIN_RECHAZADO'];

// Ajustes abre el panel de credenciales al recibir este state (ver ExtraccionAutomatica.jsx).
// En modo 'guardar', al guardarlas se sincroniza solo.
export const irACredenciales = (navigate, mensaje) => navigate('/ajustes', {
  state: { abrirCredenciales: true, accionModal: 'guardar', mensaje },
});

// ---- Último resultado de sincronización de esta sesión (lo muestra Inicio) ----
// Se guarda la promesa (no solo el resultado) para que, si Inicio se vuelve a montar mientras
// sincroniza, lea el resultado en vez de quedarse en "Sincronizando…". Cualquier pantalla que
// sincronice bien lo actualiza, así Inicio no sigue mostrando un error ya resuelto.
// Resultado: { estado: 'ok' | 'requiere' | 'error', codigo, mensaje }
let resultadoSync = null;
export const ultimaSync = () => resultadoSync;
export const registrarSync = (promesa) => { resultadoSync = promesa; return promesa; };
export const marcarSyncExitosa = () => registrarSync(Promise.resolve(
  { estado: 'ok', codigo: '', mensaje: 'Datos sincronizados correctamente.' }));

// ---- Teléfono: pedirle la sincronización al PC ----
// El teléfono no puede abrir el portal ni ingresar credenciales: le pide al PC una tarea en
// segundo plano (que usa las credenciales guardadas allí) y consulta su estado hasta que
// termina. Así no depende de una petición de minutos, que se corta si se bloquea la pantalla.

// En el teléfono los errores de credenciales se corrigen en el PC
export const MENSAJES_TELEFONO = {
  CREDENCIALES_REQUERIDAS: 'El PC no tiene credenciales del portal guardadas. Ingrésalas en Ajustes desde el PC.',
  LOGIN_RECHAZADO: 'El portal rechazó las credenciales guardadas en el PC. Actualízalas en Ajustes desde el PC.',
};

const cancelado = () => new DOMException('Operación cancelada.', 'AbortError');

// Espera `ms`, o menos si la pestaña vuelve a estar visible (el teléfono se desbloqueó)
function pausa(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelado()); return; }
    const terminar = (fn) => {
      clearTimeout(temporizador);
      document.removeEventListener('visibilitychange', alVolver);
      signal?.removeEventListener('abort', alCancelar);
      fn();
    };
    const temporizador = setTimeout(() => terminar(resolve), ms);
    const alVolver = () => { if (document.visibilityState === 'visible') terminar(resolve); };
    const alCancelar = () => terminar(() => reject(cancelado()));
    document.addEventListener('visibilitychange', alVolver);
    signal?.addEventListener('abort', alCancelar);
  });
}

// Consulta la tarea hasta que termina. Devuelve su resultado o lanza un Error con `code`.
// Los cortes de red (teléfono dormido, wifi) se reintentan; cancelar no detiene la tarea en el PC.
export async function esperarTarea(id, { signal, intervalo = 2000 } = {}) {
  let cortes = 0;
  for (;;) {
    let tarea;
    try {
      ({ tarea } = await getTareaSync(id));
      cortes = 0;
    } catch (e) {
      if (e instanceof TypeError && cortes < 60) {
        cortes += 1;
        await pausa(intervalo, signal);
        continue;
      }
      throw e;
    }
    if (tarea.estado === 'ok') return tarea.resultado;
    if (tarea.estado === 'error') {
      const error = new Error(tarea.error?.mensaje || 'No se pudo sincronizar.');
      error.code = tarea.error?.codigo;
      throw error;
    }
    await pausa(intervalo, signal);
  }
}

// Mismos parámetros de extracción (lo que el PC muestra en la tarea; nunca credenciales)
const CLAVES_TAREA = ['fecha', 'periodo', 'desde', 'hasta', 'soloFaltantes'];
const mismaTarea = (tarea, { tipo, parametros = {} }) => tarea.tipo === tipo
  && CLAVES_TAREA.every((clave) => (tarea.parametros?.[clave] ?? null) === (parametros[clave] ?? null));

// Le pide al PC una tarea { tipo, parametros, iniciar } y espera su resultado.
// Si el PC ya está haciendo esa misma extracción (p. ej. la de Inicio), espera esa;
// si está haciendo otra, espera a que termine y luego pide la suya.
export async function pedirAlPc(pedido, { signal } = {}) {
  for (;;) {
    let tarea;
    try {
      const respuesta = await pedido.iniciar();
      if (!respuesta?.tarea) return respuesta; // el PC la resolvió al tiro
      tarea = respuesta.tarea;
    } catch (e) {
      const enCurso = e.code === 'SINCRONIZACION_EN_CURSO' && e.datos?.tarea;
      if (!enCurso) throw e;
      if (!mismaTarea(e.datos.tarea, pedido)) {
        await esperarTarea(e.datos.tarea.id, { signal }).catch((error) => {
          if (error.name === 'AbortError') throw error;
        });
        continue;
      }
      tarea = e.datos.tarea;
    }
    return esperarTarea(tarea.id, { signal });
  }
}

// La tarea que el PC está haciendo ahora (o null), para reengancharse al volver a una pantalla
export async function tareaEnCurso() {
  try {
    const { tarea } = await getTareaSync();
    return tarea?.estado === 'en_curso' ? tarea : null;
  } catch {
    return null;
  }
}

export const tareaSyncCompleta = (cuerpo) => ({
  tipo: 'completa',
  parametros: cuerpo || {},
  iniciar: () => iniciarTareaSync(cuerpo),
});

// Sincronización de Inicio: nunca lanza, devuelve el resultado para mostrarlo.
// En el teléfono se la pide al PC (sin revisar credenciales: eso solo se puede en el PC);
// con `enCurso` espera esa tarea del PC en vez de pedir otra.
export async function intentarSync(enCurso) {
  if (!esPc) {
    try {
      await (enCurso ? esperarTarea(enCurso.id) : pedirAlPc(tareaSyncCompleta()));
      return { estado: 'ok', codigo: '', mensaje: 'Datos sincronizados correctamente.' };
    } catch (error) {
      return {
        estado: 'error',
        codigo: error.code || '',
        mensaje: MENSAJES_TELEFONO[error.code] || MENSAJES_PORTAL[error.code] || error.message || 'No se pudo sincronizar.',
      };
    }
  }
  try {
    const credenciales = await getCredencialesPortal();
    // "En memoria" también sirve (al reintentar en la misma sesión)
    if ((!credenciales.guardadas && !credenciales.enMemoria) || credenciales.invalidas) {
      return {
        estado: 'requiere',
        codigo: '',
        mensaje: credenciales.invalidas
          ? 'Las credenciales guardadas están inválidas. Actualízalas para sincronizar.' : '',
      };
    }
    await iniciarSync();
    return { estado: 'ok', codigo: '', mensaje: 'Datos sincronizados correctamente.' };
  } catch (error) {
    return {
      estado: 'error',
      codigo: error.code || '',
      mensaje: error.message || MENSAJES_PORTAL[error.code] || 'No se pudo sincronizar.',
    };
  }
}

// Sincroniza con el portal (`cuerpo` opcional: { desde, hasta, soloFaltantes }).
// En el PC revisa antes las credenciales: si faltan, son inválidas o el portal las rechaza,
// lleva a Ajustes para ingresarlas. Devuelve la respuesta, o null si se fue a Ajustes.
// Lanza un Error con el mensaje listo para mostrar (los AbortError se relanzan tal cual).
// `accion` opcional: otra petición al portal (p. ej. asistencia por clase) con el mismo manejo
// de credenciales y errores; esa no cuenta como sincronización completa para Inicio.
// En el teléfono se le pide al PC como tarea: `tareaTelefono` ({ tipo, parametros, iniciar })
// es la tarea equivalente a `accion`; sin `accion`, es la sincronización completa con `cuerpo`.
export async function sincronizarPortal({ navigate, cuerpo, signal, accion, tareaTelefono } = {}) {
  try {
    if (!esPc && (tareaTelefono || !accion)) {
      const respuesta = await pedirAlPc(tareaTelefono || tareaSyncCompleta(cuerpo), { signal });
      if (!accion) marcarSyncExitosa();
      return respuesta;
    }
    if (esPc) {
      const credenciales = await getCredencialesPortal();
      if (!credenciales.guardadas && !credenciales.enMemoria) {
        irACredenciales(navigate, 'Configura las credenciales del portal para sincronizar.');
        return null;
      }
      if (credenciales.invalidas) {
        irACredenciales(navigate, 'Las credenciales guardadas están inválidas. Actualízalas para continuar.');
        return null;
      }
    }
    if (accion) return await accion();
    const respuesta = await iniciarSync(cuerpo, { signal });
    marcarSyncExitosa();
    return respuesta;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const deLogin = ERRORES_LOGIN.includes(e.code);
    // Desde el teléfono no se pueden ingresar credenciales: se corrigen en el PC
    if (!esPc && deLogin) throw new Error(MENSAJES_TELEFONO[e.code]);
    const mensaje = MENSAJES_PORTAL[e.code] || e.message || 'No se pudo sincronizar.';
    if (deLogin) irACredenciales(navigate, mensaje);
    throw new Error(mensaje);
  }
}
