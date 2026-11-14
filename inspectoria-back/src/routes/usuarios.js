const express = require('express');
const usuarios = require('../db/usuarios');
const { hashearPassword } = require('../services/auth');

const router = express.Router(); // se monta detrás de requerirSesion (ver app.js)

const NOMBRE_OK = /^[a-z0-9._-]{3,30}$/i;
const CLAVE_MIN = 8, CLAVE_MAX = 128;

router.get('/', (req, res) => {
  res.json(usuarios.listar().map((u) => ({ nombre: u.nombre, activo: !!u.activo, creadoEn: u.creado_en })));
});

router.post('/', (req, res) => {
  const { nombre, password } = req.body ?? {};
  if (typeof nombre !== 'string' || !NOMBRE_OK.test(nombre.trim())) {
    return res.status(400).json({ error: 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.' });
  }
  if (typeof password !== 'string' || password.length < CLAVE_MIN || password.length > CLAVE_MAX) {
    return res.status(400).json({ error: `La contraseña debe tener entre ${CLAVE_MIN} y ${CLAVE_MAX} caracteres.` });
  }
  const limpio = nombre.trim();
  if (usuarios.buscar(limpio)) return res.status(409).json({ error: `El usuario "${limpio}" ya existe.` });
  usuarios.crear(limpio, hashearPassword(password));
  res.status(201).json({ nombre: limpio });
});

module.exports = router;
