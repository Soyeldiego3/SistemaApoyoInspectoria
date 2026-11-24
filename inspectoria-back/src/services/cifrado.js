// Cifrado simétrico compartido (credenciales del portal, respaldos, contraseña de respaldo).
// AES-256-GCM con una clave derivada por scrypt de un secreto (el del equipo o una contraseña)
// más una etiqueta por uso. Cada cifrado usa salt e IV aleatorios; el tag GCM detecta
// tanto un archivo alterado como una clave incorrecta.

const crypto = require('crypto');

// Clave de 32 bytes para `secreto` + `etiqueta` + `salt`
function derivarClave(secreto, etiqueta, salt) {
  return crypto.scryptSync(String(secreto), Buffer.concat([Buffer.from(etiqueta), salt]), 32);
}

// contenido: Buffer o string (utf8). Devuelve { salt, iv, tag, data } en base64.
function cifrar(contenido, secreto, etiqueta) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivarClave(secreto, etiqueta, salt), iv);
  const datos = Buffer.isBuffer(contenido) ? contenido : Buffer.from(String(contenido), 'utf8');
  const cifrado = Buffer.concat([cipher.update(datos), cipher.final()]);
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: cifrado.toString('base64'),
  };
}

// registro: { salt, iv, tag, data } en base64. Devuelve el Buffer original.
// Lanza un Error con code 'CLAVE_INCORRECTA' si el secreto no corresponde o el archivo fue alterado.
function descifrar(registro, secreto, etiqueta) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      derivarClave(secreto, etiqueta, Buffer.from(registro.salt, 'base64')),
      Buffer.from(registro.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(registro.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(registro.data, 'base64')), decipher.final()]);
  } catch (error) {
    const fallo = new Error('No se pudo descifrar: la clave no corresponde o el archivo está dañado.');
    fallo.code = 'CLAVE_INCORRECTA';
    fallo.cause = error;
    throw fallo;
  }
}

module.exports = { cifrar, descifrar };
