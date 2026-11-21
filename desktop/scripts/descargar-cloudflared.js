// Descarga cloudflared (acceso desde otra red, experimental) en desktop/bin para incluirlo en el build.
// Versión fija y SHA256 verificado: si el archivo no coincide, el build se detiene.
// Uso: node scripts/descargar-cloudflared.js [win|linux|all]   (por defecto, el sistema actual)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '2026.10.7';
const BINARIOS = {
  win: {
    asset: 'cloudflared-windows-amd64.exe',
    destino: 'cloudflared.exe',
    sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343',
  },
  linux: {
    asset: 'cloudflared-linux-amd64',
    destino: 'cloudflared',
    sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872',
  },
};

const binDir = path.join(__dirname, '..', 'bin');
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function descargar(plataforma) {
  const { asset, destino, sha256: esperado } = BINARIOS[plataforma];
  const archivo = path.join(binDir, destino);

  if (fs.existsSync(archivo) && sha256(fs.readFileSync(archivo)) === esperado) {
    console.log(`cloudflared ${VERSION} (${plataforma}) ya está descargado.`);
    return;
  }

  const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${asset}`;
  console.log(`Descargando ${url}`);
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`No se pudo descargar cloudflared (HTTP ${respuesta.status}).`);
  const contenido = Buffer.from(await respuesta.arrayBuffer());

  const obtenido = sha256(contenido);
  if (obtenido !== esperado) {
    throw new Error(`El SHA256 de ${asset} no coincide.\n  esperado: ${esperado}\n  obtenido: ${obtenido}`);
  }

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(archivo, contenido, { mode: 0o755 });
  console.log(`cloudflared ${VERSION} (${plataforma}) guardado en ${archivo}`);
}

async function main() {
  const arg = process.argv[2] || (process.platform === 'win32' ? 'win' : 'linux');
  const plataformas = arg === 'all' ? Object.keys(BINARIOS) : [arg];
  for (const plataforma of plataformas) {
    if (!BINARIOS[plataforma]) throw new Error(`Plataforma desconocida: ${plataforma} (usa win, linux o all).`);
    await descargar(plataforma);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
