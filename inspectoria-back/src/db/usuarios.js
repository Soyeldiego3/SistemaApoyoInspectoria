// Usuarios de la plataforma. Van en su propia base (data/usuarios.db), aparte de asistencia.db,
// porque esa se abre en solo lectura y esta sí se modifica.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const carpeta = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(carpeta, { recursive: true });

const db = new Database(path.join(carpeta, 'asistencia.db'));
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

const q = {
  buscar: db.prepare('SELECT id, nombre, password_hash, activo FROM usuario WHERE nombre = ?'),
  cantidad: db.prepare('SELECT COUNT(*) AS n FROM usuario'),
  crear: db.prepare('INSERT INTO usuario (nombre, password_hash) VALUES (?, ?)'),
  cambiarClave: db.prepare('UPDATE usuario SET password_hash = ? WHERE nombre = ?'),
  activar: db.prepare('UPDATE usuario SET activo = ? WHERE nombre = ?'),
  eliminar: db.prepare('DELETE FROM usuario WHERE nombre = ?'),
  listar: db.prepare('SELECT nombre, activo, creado_en FROM usuario ORDER BY nombre'),
};

module.exports = {
  buscar: (nombre) => q.buscar.get(String(nombre).trim()),
  hayUsuarios: () => q.cantidad.get().n > 0,
  crear: (nombre, hash) => q.crear.run(nombre, hash),
  cambiarClave: (nombre, hash) => q.cambiarClave.run(hash, nombre).changes > 0,
  activar: (nombre, valor) => q.activar.run(valor ? 1 : 0, nombre).changes > 0,
  eliminar: (nombre) => q.eliminar.run(nombre).changes > 0,
  listar: () => q.listar.all(),
};
