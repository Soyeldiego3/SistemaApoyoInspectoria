require('dotenv').config();
const { iniciarServidor } = require('./services/servidor');
const { abrirDb } = require('./services/asistencia');
const { limpiarDatosSincronizados } = require('./services/limpieza');
const { leer } = require('./services/configuracion');

iniciarServidor();

process.on('message', (message) => {
  if (message?.type !== 'limpiar-datos') return;
  try {
    if (leer().limpiarAlCerrar !== false) {
      const db = abrirDb();
      limpiarDatosSincronizados(db);
      db.close();
    }
    process.send?.({ type: 'limpiar-datos:ok' });
  } catch (error) {
    console.error('Error al limpiar datos al cerrar:', error.message);
    process.send?.({ type: 'limpiar-datos:error' });
  }
});