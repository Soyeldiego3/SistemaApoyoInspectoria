// Administra los usuarios de la plataforma (guardados en data/usuarios.db).
//   npm run usuario -- crear <nombre> [contraseña]
//   npm run usuario -- clave <nombre> [contraseña]
//   npm run usuario -- desactivar <nombre>     |  activar <nombre>
//   npm run usuario -- eliminar <nombre>
//   npm run usuario -- listar
// Si no escribes la contraseña, se pide por teclado sin mostrarla.
const readline = require('readline');
const usuarios = require('../db/usuarios');
const { hashearPassword } = require('../services/auth');

const [, , accion, nombre, claveArg] = process.argv;
const MIN = 8;

function pedirClave() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (t) => { if (t.includes('\n') || t.includes('\r') || t.startsWith('Contraseña')) process.stdout.write(t); };
    rl.question('Contraseña: ', (c) => { rl.close(); process.stdout.write('\n'); resolve(c); });
  });
}
const falla = (msg) => { console.error(msg); process.exit(1); };
const necesitaNombre = () => { if (!nombre) falla('Falta el nombre de usuario.'); };

async function claveValida() {
  const c = claveArg ?? await pedirClave();
  if (c.length < MIN) falla(`La contraseña debe tener al menos ${MIN} caracteres.`);
  return c;
}

(async () => {
  switch (accion) {
    case 'crear': {
      necesitaNombre();
      if (usuarios.buscar(nombre)) falla(`El usuario "${nombre}" ya existe.`);
      usuarios.crear(nombre, hashearPassword(await claveValida()));
      console.log(`Usuario "${nombre}" creado.`);
      break;
    }
    case 'clave': {
      necesitaNombre();
      if (!usuarios.buscar(nombre)) falla(`El usuario "${nombre}" no existe.`);
      usuarios.cambiarClave(nombre, hashearPassword(await claveValida()));
      console.log(`Contraseña de "${nombre}" actualizada.`);
      break;
    }
    case 'activar':
    case 'desactivar': {
      necesitaNombre();
      if (!usuarios.activar(nombre, accion === 'activar')) falla(`El usuario "${nombre}" no existe.`);
      console.log(`Usuario "${nombre}" ${accion === 'activar' ? 'activado' : 'desactivado'}.`);
      break;
    }
    case 'eliminar': {
      necesitaNombre();
      if (!usuarios.eliminar(nombre)) falla(`El usuario "${nombre}" no existe.`);
      console.log(`Usuario "${nombre}" eliminado.`);
      break;
    }
    case 'listar': {
      const l = usuarios.listar();
      if (!l.length) console.log('No hay usuarios.');
      l.forEach((u) => console.log(`${u.nombre.padEnd(20)} ${u.activo ? 'activo' : 'desactivado'}  creado ${u.creado_en}`));
      break;
    }
    default:
      falla('Uso: npm run usuario -- <crear|clave|activar|desactivar|eliminar|listar> [nombre] [contraseña]');
  }
})();
