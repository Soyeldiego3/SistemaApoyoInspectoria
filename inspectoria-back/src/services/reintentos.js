// Reintentos de la sincronización completa 

const esperar = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * intentar(): async, devuelve { estado, datos } (como sincronizarCompleta).
 * esperasMs: espera antes de cada reintento, p. ej. [30000, 90000] = 3 intentos en total.
 * alReintentar({ intento, de, codigo, esperaMs }): aviso antes de esperar (log, progreso).
 * alIniciarIntento({ intento, de }): aviso al empezar cada reintento.
 * Devuelve la última respuesta; si falló tras reintentar, su mensaje indica cuántas veces se intentó.
 */
async function conReintentos(intentar, {
  esperasMs, esReintentable, alReintentar = () => {}, alIniciarIntento = () => {},
}) {
  const de = esperasMs.length + 1;
  for (let intento = 1; ; intento += 1) {
    const respuesta = await intentar();
    const fallo = respuesta.estado >= 400;
    if (!fallo || !esReintentable(respuesta) || intento >= de) {
      if (fallo && intento > 1) {
        respuesta.datos = {
          ...respuesta.datos,
          mensaje: `${respuesta.datos?.mensaje || 'No se pudo completar la sincronización.'} Se intentó ${intento} veces.`,
        };
      }
      return respuesta;
    }
    const esperaMs = esperasMs[intento - 1];
    alReintentar({ intento, de, codigo: respuesta.datos?.codigo, esperaMs });
    await esperar(esperaMs);
    alIniciarIntento({ intento: intento + 1, de });
  }
}

module.exports = { conReintentos };
