const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db/ruta');
const { interfacesPrivadas } = require('./red');

const KEY_PATH = path.join(DATA_DIR, 'red.key.pem');
const CERT_PATH = path.join(DATA_DIR, 'red.cert.pem');

// Certificado autofirmado para el HTTPS de "Acceso en red". Se genera una vez y se reutiliza,
// así el teléfono solo acepta el aviso de "conexión no privada" la primera vez.
async function obtenerCertificado() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
  }
  const selfsigned = require('selfsigned'); // solo se carga cuando hace falta
  const hasta = new Date();
  hasta.setFullYear(hasta.getFullYear() + 10);
  const { private: key, cert } = await selfsigned.generate([{ name: 'commonName', value: 'Inspectoria' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: hasta,
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        ...interfacesPrivadas().map(({ address }) => ({ type: 7, ip: address })),
      ],
    }],
  });
  fs.writeFileSync(KEY_PATH, key, { mode: 0o600 });
  fs.writeFileSync(CERT_PATH, cert);
  return { key, cert };
}

module.exports = { obtenerCertificado };
