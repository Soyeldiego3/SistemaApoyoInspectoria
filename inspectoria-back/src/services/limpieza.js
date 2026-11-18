const { transaccion } = require('./asistencia');

function borrarDatosSincronizados(db) {
  db.exec(`
    DELETE FROM sync_ejecucion;
    DELETE FROM atraso;
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
