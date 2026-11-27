const { app, BrowserWindow, dialog, Menu, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const PORT = 3005;
// En un arranque en frío (recién instalado, o al iniciar con Windows) el antivirus revisa
// cada archivo de node_modules y el disco está ocupado: el backend puede tardar bastante.
const ESPERA_BACKEND_MS = 90_000;
const LOG_MAX_BYTES = 1024 * 1024;
let mainWindow = null;
let cargaWindow = null;
let backend = null;
let avisarSalidaBackend = null; // lo usa waitForBackend para no esperar a un backend caído
let logBackend = null;

const rutaLog = () => path.join(app.getPath('userData'), 'logs', 'backend.log');

// Salida del backend a un archivo, para poder diagnosticar en el equipo del usuario
function registrar(texto) {
  try {
    if (!logBackend) {
      const archivo = rutaLog();
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      try {
        if (fs.statSync(archivo).size > LOG_MAX_BYTES) {
          fs.renameSync(archivo, path.join(path.dirname(archivo), 'backend.old.log'));
        }
      } catch { /* aún no existe */ }
      logBackend = fs.createWriteStream(archivo, { flags: 'a' });
      logBackend.on('error', (error) => {
        console.error('Log del backend:', error.message);
        logBackend = null;
      });
    }
    logBackend.write(texto.endsWith('\n') ? texto : `${texto}\n`);
  } catch (error) {
    console.error('Log del backend:', error.message);
  }
}

// Evita abrir dos instancias (y dos backends). Si se abre otra vez, se muestra la ventana existente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  const ventana = mainWindow || cargaWindow;
  if (!ventana) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.show();
  ventana.focus();
});

// "Abrir al iniciar Windows" (Ajustes): el backend lo pide por mensajes (services/inicio_windows.js).
// En el build portable el .exe se descomprime en una carpeta temporal; se registra el .exe real.
const exeReal = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const inicioDisponible = () => app.isPackaged && process.platform === 'win32';
function estadoInicioWindows() {
  if (!inicioDisponible()) return { disponible: false, activo: false };
  return { disponible: true, activo: app.getLoginItemSettings({ path: exeReal() }).openAtLogin };
}
function atenderInicioWindows(proceso, message) {
  if (message?.type !== 'inicio-windows:consultar' && message?.type !== 'inicio-windows:cambiar') return;
  try {
    if (message.type === 'inicio-windows:cambiar' && inicioDisponible()) {
      app.setLoginItemSettings({ openAtLogin: Boolean(message.activo), path: exeReal() });
    }
    proceso.send({ type: 'inicio-windows:estado', ...estadoInicioWindows() });
  } catch (error) {
    console.error('Inicio con Windows:', error.message);
  }
}

// "Buscar carpeta…" de la copia externa de respaldos (routes/respaldo.js → /elegir-carpeta)
async function atenderElegirCarpeta(proceso, message) {
  if (message?.type !== 'respaldo:elegir-carpeta') return;
  let ruta = null;
  try {
    const opciones = {
      title: 'Carpeta para la copia de respaldo',
      buttonLabel: 'Elegir carpeta',
      properties: ['openDirectory', 'createDirectory'],
    };
    const { canceled, filePaths } = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opciones)
      : await dialog.showOpenDialog(opciones);
    if (!canceled && filePaths?.[0]) ruta = filePaths[0];
  } catch (error) {
    console.error('Elegir carpeta de respaldo:', error.message);
  }
  try {
    if (proceso.connected) proceso.send({ type: 'respaldo:carpeta', ruta });
  } catch (error) {
    console.error('Elegir carpeta de respaldo:', error.message);
  }
}

function startBackend() {
  // En desarrollo el back lo corres tú con "npm run dev" (usa tu Node normal)
  if (!app.isPackaged) return;

  const backendDir = path.join(process.resourcesPath, 'inspectoria-back');
  const backendEnv = { ...process.env };
  delete backendEnv.USUARIO;
  delete backendEnv.PASS;
  delete backendEnv.AUTH_SECRET;

  // Firefox incluido (solo en el build de Linux); en Windows se usa Edge del sistema
  const browsersDir = path.join(process.resourcesPath, 'browsers');
  if (fs.existsSync(browsersDir)) backendEnv.PLAYWRIGHT_BROWSERS_PATH = browsersDir;

  const proceso = fork(path.join(backendDir, 'src', 'index.js'), [], {
    cwd: backendDir,
    silent: true,
    env: {
      ...backendEnv,
      PORT: String(PORT),
      DATA_DIR: app.getPath('userData'),
      FRONT_DIR: path.join(process.resourcesPath, 'front-dist'),
      NODE_ENV: 'production',
    },
  });
  backend = proceso;
  registrar(`\n=== ${new Date().toISOString()} Iniciando backend (v${app.getVersion()}) ===`);

  proceso.stdout.on('data', (d) => {
    console.log('[back]', d.toString());
    registrar(d.toString());
  });
  proceso.stderr.on('data', (d) => {
    console.error('[back]', d.toString());
    registrar(`[error] ${d.toString()}`);
  });
  proceso.on('error', (error) => {
    console.error('Error del backend:', error.message);
    registrar(`Error del backend: ${error.message}`);
  });
  proceso.on('message', (message) => {
    atenderInicioWindows(proceso, message);
    atenderElegirCarpeta(proceso, message);
  });
  proceso.on('exit', (code, signal) => {
    console.log('Backend terminó con código', code);
    registrar(`${new Date().toISOString()} Backend terminó (código ${code}${signal ? `, señal ${signal}` : ''})`);
    if (backend === proceso) backend = null;
    avisarSalidaBackend?.(code);
  });
}

// Espera a que el backend responda antes de abrir la ventana. Se rinde al pasar `limiteMs`
// o apenas el backend termina (no tiene sentido seguir esperando a un proceso caído).
function waitForBackend(limiteMs = ESPERA_BACKEND_MS) {
  return new Promise((resolve, reject) => {
    const limite = Date.now() + limiteMs;
    let listo = false;
    const fin = (error) => {
      if (listo) return;
      listo = true;
      avisarSalidaBackend = null;
      if (error) reject(error);
      else resolve();
    };
    avisarSalidaBackend = (code) => fin(new Error(`El servidor interno se cerró (código ${code}).`));

    const reintentar = (error) => {
      if (listo) return;
      if (Date.now() >= limite) return fin(error);
      setTimeout(attempt, 500);
    };
    const attempt = () => {
      if (listo) return;
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/salud', timeout: 5000 }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) fin();
        else reintentar(new Error(`El servidor interno respondió con HTTP ${res.statusCode}.`));
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => reintentar(new Error('El servidor interno no respondió a tiempo.')));
    };
    attempt();
  });
}

// Ventana pequeña mientras arranca el backend, para que un arranque lento no parezca colgado
function mostrarCarga() {
  cargaWindow = new BrowserWindow({
    width: 360,
    height: 140,
    frame: false,
    resizable: false,
    maximizable: false,
    show: false,
    backgroundColor: '#1c1c1e',
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, devTools: false },
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#1c1c1e;color:#e5e5e7;font:15px system-ui,"Segoe UI",sans-serif;
      display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;user-select:none}
    .barra{width:200px;height:4px;border-radius:2px;background:#3a3a3c;overflow:hidden}
    .barra::after{content:"";display:block;width:40%;height:100%;background:#0a84ff;border-radius:2px;
      animation:ir 1.2s ease-in-out infinite}
    @keyframes ir{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
  </style></head><body><div>Iniciando Apoyo Inspectoría…</div><div class="barra"></div></body></html>`;
  cargaWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  cargaWindow.once('ready-to-show', () => cargaWindow?.show());
  cargaWindow.on('closed', () => { cargaWindow = null; });
}

// Arranca el backend y espera a que responda; si falla, ofrece reintentar.
// Devuelve false si el usuario prefirió salir.
async function iniciarBackend() {
  for (;;) {
    if (!backend) startBackend();
    try {
      await waitForBackend();
      return true;
    } catch (error) {
      registrar(`${new Date().toISOString()} No se pudo iniciar: ${error.message}`);
      if (cleanupStarted) return false; // la app ya se está cerrando (p. ej. Alt+F4 en la ventana de carga)
      const opciones = {
        type: 'error',
        title: 'Apoyo Inspectoría',
        message: 'No se pudo iniciar el servidor interno.',
        detail: `${error.message}\n\nPuede pasar la primera vez que se abre tras instalar o reiniciar el equipo. `
          + `Prueba con "Reintentar".${app.isPackaged ? `\n\nRegistro: ${rutaLog()}` : ''}`,
        buttons: ['Reintentar', 'Salir'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
      const { response } = cargaWindow
        ? await dialog.showMessageBox(cargaWindow, opciones)
        : await dialog.showMessageBox(opciones);
      if (response !== 0) return false;
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 1000,
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
  mostrarCarga();
  if (!(await iniciarBackend())) {
    app.quit();
    return;
  }
  createWindow();
  // Se cierra después de crear la principal: si no, "window-all-closed" cerraría la app
  cargaWindow?.close();
});

let cleanupStarted = false;

// Siempre se avisa al backend antes de cerrar: guarda el respaldo automático y,
// si "limpiarAlCerrar" está activo (lo decide el backend), borra los datos sincronizados.
app.on('before-quit', (event) => {
  if (cleanupStarted) return;
  const proceso = backend;
  if (!proceso) return;

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