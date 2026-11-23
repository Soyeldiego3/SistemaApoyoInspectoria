// Conexión con el portal institucional: qué equipo es, mensajes de error y sincronización.
import { getCredencialesPortal, iniciarSync } from './api.js';

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

// Sincronización de Inicio: nunca lanza, devuelve el resultado para mostrarlo
export async function intentarSync() {
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
export async function sincronizarPortal({ navigate, cuerpo, signal, accion } = {}) {
  try {
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
    // Desde el teléfono no se pueden ingresar credenciales
    if (!esPc && deLogin) throw new Error('Sincroniza desde el PC.');
    const mensaje = MENSAJES_PORTAL[e.code] || e.message || 'No se pudo sincronizar.';
    if (deLogin) irACredenciales(navigate, mensaje);
    throw new Error(mensaje);
  }
}
