const https = require('https');
const { redHabilitada, PUERTO, PUERTO_HTTPS } = require('./red');
const { obtenerCertificado } = require('./certificado');

// El PC usa siempre HTTP en 127.0.0.1 (no sale del equipo).
// Con "Acceso en red" se abre además HTTPS en la red para el teléfono.
let servidorRed;

function iniciarServidor() {
  const app = require('../app');
  app.listen(PUERTO, '127.0.0.1', () => console.log(`API corriendo en http://127.0.0.1:${PUERTO}`));
  return actualizarRed();
}

// Abre o cierra el HTTPS de la red según la configuración actual
async function actualizarRed() {
  if (servidorRed) {
    servidorRed.closeAllConnections();
    await new Promise((resolve) => servidorRed.close(resolve));
    servidorRed = null;
  }
  if (!redHabilitada()) return;
  const app = require('../app');
  servidorRed = https.createServer(await obtenerCertificado(), app)
    .listen(PUERTO_HTTPS, '0.0.0.0', () => console.log(`Acceso en red: https://0.0.0.0:${PUERTO_HTTPS}`));
}

module.exports = { iniciarServidor, actualizarRed };
