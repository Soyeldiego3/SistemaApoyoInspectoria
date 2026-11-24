// "Abrir al iniciar Windows" (Ajustes).
const electron = require('./electron');

const ESPERA_MS = 3000;
const NO_DISPONIBLE = { disponible: false, activo: false };

// Envía `mensaje` a Electron y espera su respuesta { type: 'inicio-windows:estado', disponible, activo }
async function pedir(mensaje) {
  const respuesta = await electron.pedir(mensaje, 'inicio-windows:estado', ESPERA_MS, NO_DISPONIBLE);
  return { disponible: Boolean(respuesta.disponible), activo: Boolean(respuesta.activo) };
}

const estado = () => pedir({ type: 'inicio-windows:consultar' });
const cambiar = (activo) => pedir({ type: 'inicio-windows:cambiar', activo: Boolean(activo) });

module.exports = { estado, cambiar };
