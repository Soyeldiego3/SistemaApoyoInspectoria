const { transaccion } = require('./asistencia');

// Nota: sync_ejecucion NO se borra a propósito. Es el historial de sincronizaciones
// que alimenta el KPI TSE y el gráfico "Sincronización diaria".
// alerta_gestion tampoco se borra: guarda qué se hizo con cada alerta de patrones
// (revisada, citado, descartada) para no repetir alertas ya atendidas.
function borrarDatosSincronizados(db) {
  db.exec(`
    DELETE FROM atraso;
    DELETE FROM asistencia_clase;
    DELETE FROM asistencia;
    DELETE FROM matricula;
    DELETE FROM curso;
    DELETE FROM justificativo
    WHERE estado_documento != 'APROBADO';
    DELETE FROM alumno
    WHERE NOT EXISTS (
      SELECT 1 FROM justificativo j
      WHERE j.rut_alumno = alumno.rut
        AND j.estado_documento = 'APROBADO'
    );
  `);
}

function limpiarDatosSincronizados(db) {
  db.pragma('secure_delete = ON');
  const resultado = transaccion(db, () => {
    borrarDatosSincronizados(db);
    return true;
  });
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  return resultado;
}

module.exports = { borrarDatosSincronizados, limpiarDatosSincronizados };
