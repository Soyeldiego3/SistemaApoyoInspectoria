require('dotenv').config();
const { iniciarServidor } = require('./services/servidor');
const { abrirDb } = require('./services/asistencia');
const { limpiarDatosSincronizados } = require('./services/limpieza');
const { leer } = require('./services/configuracion');
const respaldoProgramado = require('./services/respaldo_programado');

iniciarServidor();

// Respaldo automático de notas de alertas y justificativos: al abrir, cada cierto tiempo
// (temporizador de Ajustes) y al cerrar. Al cerrar puede no alcanzar a ejecutarse
// (corte de luz, cierre forzado), por eso también al iniciar.
const respaldar = respaldoProgramado.respaldarAhora;

// Se deja pasar unos segundos: el respaldo es síncrono (lee, descifra y compara el último)
// y, si corre apenas se abre, bloquea al servidor justo cuando la ventana espera /api/salud
setTimeout(() => respaldar({ soloSiFaltaHoy: true }), 3000);
respaldoProgramado.iniciar();

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