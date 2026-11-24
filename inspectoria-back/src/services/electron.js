// Pedidos a Electron (desktop/main.js) por el canal de mensajes del proceso.
// Fuera de Electron (npm run dev) no hay canal: se responde `porDefecto` al instante.

const disponible = () => typeof process.send === 'function' && process.connected;

// Envía `mensaje` y espera la primera respuesta con type === `tipoRespuesta`.
// Si no llega en `esperaMs`, o no hay Electron, resuelve con `porDefecto`.
function pedir(mensaje, tipoRespuesta, esperaMs, porDefecto) {
  if (!disponible()) return Promise.resolve(porDefecto);
  return new Promise((resolve) => {
    let temporizador;
    const terminar = (valor) => {
      clearTimeout(temporizador);
      process.removeListener('message', alRecibir);
      resolve(valor);
    };
    const alRecibir = (respuesta) => {
      if (respuesta?.type === tipoRespuesta) terminar(respuesta);
    };
    temporizador = setTimeout(() => terminar(porDefecto), esperaMs);
    process.on('message', alRecibir);
    try {
      process.send(mensaje);
    } catch {
      terminar(porDefecto);
    }
  });
}

module.exports = { pedir, disponible };
