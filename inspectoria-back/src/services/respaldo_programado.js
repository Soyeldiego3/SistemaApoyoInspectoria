// Temporizador de respaldos automáticos: cada `respaldoIntervaloMin` minutos revisa si las
// notas o justificativos cambiaron y, si cambiaron, guarda un respaldo nuevo. Se suma a los
// respaldos al abrir y al cerrar la app. Cualquier revisión (al abrir, al configurar, etc.)
// reinicia la cuenta, porque se cuenta desde `respaldoUltimaRevision`.
const { abrirDb } = require('./asistencia');
const { respaldoAutomatico, proximoRespaldo } = require('./respaldo');

const MARGEN_MS = 5_000; // si ya tocaba (p. ej. la app estuvo cerrada), se espera un poco tras abrir
let temporizador = null;

// Abre la base, respalda y la cierra. Nunca lanza: un respaldo fallido no debe botar la app.
function respaldarAhora(opciones) {
  let db;
  try {
    db = abrirDb();
    const resultado = respaldoAutomatico(db, opciones);
    if (resultado.archivo) console.log(`Respaldo automático guardado: ${resultado.archivo}`);
    return resultado;
  } catch (error) {
    console.error('No se pudo guardar el respaldo automático:', error.message);
    return { archivo: null, resultado: 'error' };
  } finally {
    db?.close();
  }
}

function programar() {
  clearTimeout(temporizador);
  temporizador = null;
  let proximo;
  try {
    proximo = proximoRespaldo();
  } catch (error) {
    console.error('No se pudo leer el intervalo de respaldo:', error.message);
    return;
  }
  if (!proximo) return; // temporizador desactivado

  const espera = Math.max(MARGEN_MS, proximo.getTime() - Date.now());
  temporizador = setTimeout(() => {
    temporizador = null;
    // Otra revisión pudo mover la hora mientras se esperaba: solo se respalda si de verdad toca
    try {
      const vigente = proximoRespaldo();
      if (vigente && vigente.getTime() <= Date.now() + 1000) respaldarAhora();
    } catch (error) {
      console.error('Error en el temporizador de respaldo:', error.message);
    }
    programar();
  }, espera);
  temporizador.unref?.(); // no impide que el proceso termine
}

module.exports = { iniciar: programar, reprogramar: programar, respaldarAhora };
