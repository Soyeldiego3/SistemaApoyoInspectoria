const express = require('express');
const usuarios = require('../db/usuarios');
const { hashearPassword } = require('../services/auth');
const { requerirRol } = require('../middleware/roles');
const auditoria = require('../services/auditoria_sistema');

const router = express.Router();
const NOMBRE_OK = /^[a-z0-9._-]{3,30}$/i;
const CLAVE_MIN = 8;
const CLAVE_MAX = 128;
const ROLES = new Set(['admin', 'inspector']);

router.use(requerirRol('admin'));

router.get('/', (req, res) => {
  res.json({
    usuarios: usuarios.listar().map((u) => ({
      id: u.id,
      nombre: u.nombre,
      activo: !!u.activo,
      rol: u.rol,
      creadoEn: u.creado_en,
    })),
  });
});

router.post('/', (req, res) => {
  const { nombre, password, rol = 'inspector', activo = true } = req.body ?? {};
  if (typeof nombre !== 'string' || !NOMBRE_OK.test(nombre.trim())) {
    return res.status(400).json({ ok: false, codigo: 'USUARIO_INVALIDO', mensaje: 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.' });
  }
  if (typeof password !== 'string' || password.length < CLAVE_MIN || password.length > CLAVE_MAX) {
    return res.status(400).json({ ok: false, codigo: 'CLAVE_INVALIDA', mensaje: `La contraseña debe tener entre ${CLAVE_MIN} y ${CLAVE_MAX} caracteres.` });
  }
  if (!ROLES.has(rol)) {
    return res.status(400).json({ ok: false, codigo: 'ROL_INVALIDO', mensaje: 'El rol debe ser admin o inspector.' });
  }
  const limpio = nombre.trim();
  if (usuarios.buscar(limpio)) {
    return res.status(409).json({ ok: false, codigo: 'USUARIO_EXISTE', mensaje: `El usuario "${limpio}" ya existe.` });
  }
  usuarios.crear(limpio, hashearPassword(password), rol);
  if (activo === false) usuarios.activar(limpio, false);
  auditoria.registrar('usuario.creado', req.usuario.nombre, { nombre: limpio, rol, activo: activo !== false });
  res.status(201).json({ ok: true, nombre: limpio, rol, activo: activo !== false });
});

router.put('/:nombre', (req, res) => {
  const actual = usuarios.buscar(req.params.nombre);
  if (!actual) return res.status(404).json({ ok: false, codigo: 'USUARIO_NO_ENCONTRADO', mensaje: 'El usuario no existe.' });

  const { nombre, rol, activo, password } = req.body ?? {};
  if (rol !== undefined && !ROLES.has(rol)) {
    return res.status(400).json({ ok: false, codigo: 'ROL_INVALIDO', mensaje: 'El rol debe ser admin o inspector.' });
  }
  if (activo !== undefined && typeof activo !== 'boolean') {
    return res.status(400).json({ ok: false, codigo: 'ESTADO_INVALIDO', mensaje: 'El estado activo debe ser verdadero o falso.' });
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < CLAVE_MIN || password.length > CLAVE_MAX)) {
    return res.status(400).json({ ok: false, codigo: 'CLAVE_INVALIDA', mensaje: `La contraseña debe tener entre ${CLAVE_MIN} y ${CLAVE_MAX} caracteres.` });
  }

  const nuevoNombre = typeof nombre === 'string' && nombre.trim() ? nombre.trim() : actual.nombre;
  if (!NOMBRE_OK.test(nuevoNombre)) {
    return res.status(400).json({ ok: false, codigo: 'USUARIO_INVALIDO', mensaje: 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.' });
  }
  if (nuevoNombre !== actual.nombre && usuarios.buscar(nuevoNombre)) {
    return res.status(409).json({ ok: false, codigo: 'USUARIO_EXISTE', mensaje: `El usuario "${nuevoNombre}" ya existe.` });
  }

  if (actual.rol === 'admin' && actual.activo === 1 &&
      ((rol === 'inspector') || activo === false) &&
      usuarios.cantidadAdminsActivos() <= 1) {
    return res.status(409).json({
      ok: false,
      codigo: 'ULTIMO_ADMIN',
      mensaje: 'No puedes desactivar, degradar o eliminar al último administrador activo.',
    });
  }

  if (nuevoNombre !== actual.nombre) usuarios.actualizarNombre(actual.id, nuevoNombre);
  if (rol !== undefined) usuarios.cambiarRol(nuevoNombre, rol);
  if (activo !== undefined) usuarios.activar(nuevoNombre, activo);
  if (password !== undefined) usuarios.cambiarClave(nuevoNombre, hashearPassword(password));

  auditoria.registrar('usuario.modificado', req.usuario.nombre, {
    nombre: nuevoNombre,
    rol: rol ?? actual.rol,
    activo: activo !== undefined ? activo : !!actual.activo,
    cambioNombre: nuevoNombre !== actual.nombre,
    cambioClave: password !== undefined,
  });
  res.json({ ok: true, nombre: nuevoNombre, rol: rol ?? actual.rol, activo: activo !== undefined ? activo : !!actual.activo });
});

router.delete('/:nombre', (req, res) => {
  const actual = usuarios.buscar(req.params.nombre);
  if (!actual) return res.status(404).json({ ok: false, codigo: 'USUARIO_NO_ENCONTRADO', mensaje: 'El usuario no existe.' });
  if (actual.activo === 1 && actual.rol === 'admin' && usuarios.cantidadAdminsActivos() <= 1) {
    return res.status(409).json({ ok: false, codigo: 'ULTIMO_ADMIN', mensaje: 'No puedes desactivar, degradar o eliminar al último administrador activo.' });
  }
  usuarios.eliminar(actual.nombre);
  auditoria.registrar('usuario.eliminado', req.usuario.nombre, { nombre: actual.nombre, rol: actual.rol });
  res.json({ ok: true, mensaje: 'Usuario eliminado.' });
});

module.exports = router;
