const { app, BrowserWindow, dialog, Menu, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const PORT = 3005;
let mainWindow = null;
let backend = null;

// Evita abrir dos instancias (y dos backends)
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function startBackend() {
  // En desarrollo el back lo corres tú con "npm run dev" (usa tu Node normal)
  if (!app.isPackaged) return;

  const backendDir = path.join(process.resourcesPath, 'inspectoria-back');
  const backendEnv = { ...process.env };
  delete backendEnv.USUARIO;
  delete backendEnv.PASS;
  delete backendEnv.AUTH_SECRET;

  const proceso = fork(path.join(backendDir, 'src', 'index.js'), [], {
    cwd: backendDir,
    silent: true,
    env: {
      ...backendEnv,
      PORT: String(PORT),
      DATA_DIR: app.getPath('userData'),
      FRONT_DIR: path.join(process.resourcesPath, 'front-dist'),
      PLAYWRIGHT_BROWSERS_PATH: path.join(process.resourcesPath, 'browsers'), // <- nueva línea
      NODE_ENV: 'production',
    },
  });
  backend = proceso;

  proceso.stdout.on('data', (d) => console.log('[back]', d.toString()));
  proceso.stderr.on('data', (d) => console.error('[back]', d.toString()));
  proceso.on('error', (error) => console.error('Error del backend:', error.message));
  proceso.on('exit', (code) => {
    console.log('Backend terminó con código', code);
    backend = null;
  });
}

// Espera a que el backend responda antes de abrir la ventana
function waitForBackend(retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/salud' }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else if (n <= 0) {
          reject(new Error(`El backend respondió con HTTP ${res.statusCode}`));
        } else {
          setTimeout(() => attempt(n - 1), 500);
        }
      });
      req.on('error', () => {
        if (n <= 0) return reject(new Error('El backend no respondió'));
        setTimeout(() => attempt(n - 1), 500);
      });
    };
    attempt(retries);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1c1c1e', // evita el destello blanco al abrir
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const destino = new URL(url);
      const permitido = destino.protocol === 'http:' &&
        destino.hostname === '127.0.0.1' &&
        destino.port === String(PORT);
      if (!permitido) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  // Navegación sin menú: Alt+←/→ y botones laterales del mouse
  const historial = mainWindow.webContents.navigationHistory;
  const irAtras = () => { if (historial.canGoBack()) historial.goBack(); };
  const irAdelante = () => { if (historial.canGoForward()) historial.goForward(); };

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.alt && input.key === 'ArrowLeft') {
      irAtras();
      event.preventDefault();
    } else if (input.alt && input.key === 'ArrowRight') {
      irAdelante();
      event.preventDefault();
    } else if (!app.isPackaged && input.key === 'F5') {
      // Solo en desarrollo: recargar y DevTools (el menú ya no los trae)
      mainWindow.webContents.reload();
      event.preventDefault();
    } else if (!app.isPackaged && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('app-command', (_event, comando) => {
    if (comando === 'browser-backward') irAtras();
    if (comando === 'browser-forward') irAdelante();
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  // mainWindow.webContents.openDevTools(); // solo para depurar

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // quita la barra File/Edit/View/Window
  nativeTheme.themeSource = 'dark'; // barra de título oscura
  startBackend();
  try {
    await waitForBackend();
  } catch (e) {
    dialog.showErrorBox('Error', 'No se pudo iniciar el servidor interno.');
    app.quit();
    return;
  }
  createWindow();
});

let cleanupStarted = false;

function limpiarAlCerrarHabilitado() {
  const configPath = path.join(app.getPath('userData'), 'app.config.json');
  if (!fs.existsSync(configPath)) return true;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')).limpiarAlCerrar !== false;
  } catch (error) {
    console.error('No se pudo leer la configuración de cierre:', error.message);
    return true;
  }
}

app.on('before-quit', (event) => {
  if (cleanupStarted) return;
  const proceso = backend;
  if (!proceso) return;

  if (!limpiarAlCerrarHabilitado()) {
    cleanupStarted = true;
    proceso.kill();
    return;
  }

  event.preventDefault();
  cleanupStarted = true;
  let terminado = false;
  const terminar = () => {
    if (terminado) return;
    terminado = true;
    if (!proceso.killed) proceso.kill();
    app.quit();
  };
  const timeout = setTimeout(terminar, 2000);
  const recibirResultado = (message) => {
    if (message?.type !== 'limpiar-datos:ok' && message?.type !== 'limpiar-datos:error') {
      return;
    }
    proceso.removeListener('message', recibirResultado);
    clearTimeout(timeout);
    terminar();
  };
  proceso.on('message', recibirResultado);

  if (!proceso.connected) {
    terminar();
    return;
  }

  try {
    proceso.send({ type: 'limpiar-datos' }, (error) => {
      if (!error) return;
      console.error('No se pudo solicitar la limpieza al cerrar:', error.message);
      terminar();
    });
  } catch (error) {
    clearTimeout(timeout);
    console.error('No se pudo solicitar la limpieza al cerrar:', error.message);
    terminar();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});