// "Abrir al iniciar Windows" (Ajustes).

const ESPERA_MS = 3000;
const NO_DISPONIBLE = { disponible: false, activo: false };

// Envía `mensaje` a Electron y espera su respuesta { type: 'inicio-windows:estado', disponible, activo }
function pedir(mensaje) {
  if (typeof process.send !== 'function' || !process.connected) return Promise.resolve(NO_DISPONIBLE);
  return new Promise((resolve) => {
    let temporizador;
    const alRecibir = (respuesta) => {
      if (respuesta?.type !== 'inicio-windows:estado') return;
      clearTimeout(temporizador);
      process.removeListener('message', alRecibir);
      resolve({ disponible: Boolean(respuesta.disponible), activo: Boolean(respuesta.activo) });
    };
    temporizador = setTimeout(() => {
      process.removeListener('message', alRecibir);
      resolve(NO_DISPONIBLE);
    }, ESPERA_MS);
    process.on('message', alRecibir);
    try {
      process.send(mensaje);
    } catch {
      clearTimeout(temporizador);
      process.removeListener('message', alRecibir);
      resolve(NO_DISPONIBLE);
    }
  });
}

const estado = () => pedir({ type: 'inicio-windows:consultar' });
const cambiar = (activo) => pedir({ type: 'inicio-windows:cambiar', activo: Boolean(activo) });

module.exports = { estado, cambiar };
