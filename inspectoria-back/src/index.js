require('dotenv').config();
const { iniciarServidor } = require('./services/servidor');
const { abrirDb } = require('./services/asistencia');
const { limpiarDatosSincronizados } = require('./services/limpieza');
const { leer } = require('./services/configuracion');
const { respaldoAutomatico } = require('./services/respaldo');

iniciarServidor();

// Respaldo automático de notas de alertas y justificativos. Al cerrar puede no
// alcanzar a ejecutarse (corte de luz, cierre forzado), por eso también al iniciar.
function respaldar(opciones) {
  let db;
  try {
    db = abrirDb();
    const archivo = respaldoAutomatico(db, opciones);
    if (archivo) console.log(`Respaldo automático guardado: ${archivo}`);
  } catch (error) {
    console.error('No se pudo guardar el respaldo automático:', error.message);
  } finally {
    db?.close();
  }
}

respaldar({ soloSiFaltaHoy: true });

process.on('unhandledRejection', (reason) => {
  const mensaje = reason?.code || reason?.name || 'Rechazo de promesa no manejado';
  console.error('Promesa no manejada:', mensaje);
});

process.on('uncaughtException', (error) => {
  const mensaje = error?.code || error?.name || 'Excepción no controlada';
  console.error('Excepción no controlada:', mensaje);
});

process.on('message', (message) => {
  if (message?.type !== 'limpiar-datos') return;
  respaldar(); // antes de limpiar, y aunque la limpieza esté desactivada
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