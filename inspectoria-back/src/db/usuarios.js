// Usuarios de la plataforma. Van en su propia base (data/usuarios.db), aparte de asistencia.db,
// porque esa se abre en solo lectura y esta sí se modifica.
const Database = require('better-sqlite3');
const { DB_PATH } = require('./ruta');

const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL'); // el mismo modo que usa abrirDb(), para que las conexiones convivan sin bloquearse
db.exec(`
  CREATE TABLE IF NOT EXISTS usuario (
    id            INTEGER PRIMARY KEY,
    nombre        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    activo        INTEGER NOT NULL DEFAULT 1,
    creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const columnas = db.prepare('PRAGMA table_info(usuario)').all();
if (!columnas.some((columna) => columna.name === 'rol')) {
  db.exec("ALTER TABLE usuario ADD COLUMN rol TEXT NOT NULL DEFAULT 'inspector'");
}
db.exec("UPDATE usuario SET rol = 'inspector' WHERE rol IS NULL OR rol NOT IN ('admin', 'inspector')");

const q = {
  buscar: db.prepare('SELECT id, nombre, password_hash, activo, rol FROM usuario WHERE nombre = ?'),
  cantidad: db.prepare('SELECT COUNT(*) AS n FROM usuario'),
  actualizarNombre: db.prepare('UPDATE usuario SET nombre = ? WHERE id = ?'),
  crear: db.prepare('INSERT INTO usuario (nombre, password_hash, rol) VALUES (?, ?, ?)'),
  cambiarClave: db.prepare('UPDATE usuario SET password_hash = ? WHERE nombre = ?'),
  cambiarRol: db.prepare("UPDATE usuario SET rol = ? WHERE nombre = ?"),
  activar: db.prepare('UPDATE usuario SET activo = ? WHERE nombre = ?'),
  eliminar: db.prepare('DELETE FROM usuario WHERE nombre = ?'),
  listar: db.prepare('SELECT id, nombre, password_hash, activo, rol, creado_en FROM usuario ORDER BY nombre'),
  adminsActivos: db.prepare("SELECT COUNT(*) AS n FROM usuario WHERE rol = 'admin' AND activo = 1"),
};

module.exports = {
  buscar: (nombre) => q.buscar.get(String(nombre).trim()),
  hayUsuarios: () => q.cantidad.get().n > 0,
  hayAdmins: () => q.adminsActivos.get().n > 0,
  cantidadAdminsActivos: () => q.adminsActivos.get().n,
  crear: (nombre, hash, rol = 'inspector') => q.crear.run(nombre, hash, rol),
  actualizarNombre: (id, nombre) => q.actualizarNombre.run(nombre, id).changes > 0,
  cambiarClave: (nombre, hash) => q.cambiarClave.run(hash, nombre).changes > 0,
  cambiarRol: (nombre, rol) => q.cambiarRol.run(rol, nombre).changes > 0,
  activar: (nombre, valor) => q.activar.run(valor ? 1 : 0, nombre).changes > 0,
  eliminar: (nombre) => q.eliminar.run(nombre).changes > 0,
  listar: () => q.listar.all(),
};
