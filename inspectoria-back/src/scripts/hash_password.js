// Uso: node src/scripts/hash_password.js "mi contraseña"
// Imprime el valor para AUTH_PASSWORD_HASH en el archivo .env
const { hashearPassword } = require('../services/auth');
const clave = process.argv[2];
if (!clave) { console.error('Uso: node src/scripts/hash_password.js "contraseña"'); process.exit(1); }
console.log(`AUTH_PASSWORD_HASH=${hashearPassword(clave)}`);
