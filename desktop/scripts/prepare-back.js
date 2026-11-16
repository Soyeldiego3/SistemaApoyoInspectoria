const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, '..', 'inspectoria-back');
const dest = path.join(root, 'back-build');

// 1. Copiar el backend sin node_modules, .env ni data
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, {
  recursive: true,
  filter: (p) => {
    const top = path.relative(src, p).split(path.sep)[0];
    return !['node_modules', '.env', 'data'].includes(top);
  },
});

// La DB existente se usa como semilla y se copia a userData en el primer arranque.
const seed = path.join(src, 'data', 'inspectoria.db');
const seedDest = path.join(dest, 'data', 'inspectoria.db');
if (!fs.existsSync(seed)) {
  throw new Error(`No se encontró la semilla de la base de datos: ${seed}`);
}
fs.mkdirSync(path.dirname(seedDest), { recursive: true });
fs.copyFileSync(seed, seedDest);

// 2. Instalar solo dependencias de producción
execSync('npm install --omit=dev', {
  cwd: dest,
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
});

// 3. Recompilar better-sqlite3 para la versión de Electron
const electronVersion = require('electron/package.json').version;
execSync(`npx @electron/rebuild -f -w better-sqlite3 -v ${electronVersion} -m "${dest}"`, {
  cwd: root,
  stdio: 'inherit',
});

console.log('Backend listo en', dest);