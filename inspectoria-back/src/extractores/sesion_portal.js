const { chromium, firefox } = require('playwright');
const configuracion = require('../services/configuracion');

const URL_PORTAL_POR_DEFECTO = 'http://50.19.6.170:8080';
const TIMEOUT_NAVEGACION = 15000;
const TIMEOUT_LOGIN = 12000;
const TIMEOUT_LAUNCH = 10000;
const TIMEOUT_SIDE = 12000;

// Prefijo del grupo "Asistencia" en el menú
const MENU_ASISTENCIA = '#nav > ul > li:nth-child(2) > div > ul > li:nth-child(1)';
// Posición de cada opción dentro del grupo.
const POSICION = { atrasos: 2, mensual: 5 };

function errorPortal(codigo, mensaje, causa) {
  const error = new Error(mensaje);
  error.code = codigo;
  if (causa) error.cause = causa;
  return error;
}

// Lanza un navegador con límite de tiempo. Si vence, lo cierra cuando termine de abrir.
async function lanzarConTimeout(lanzar, nombre) {
  let temporizador;
  let vencido = false;

  const lanzamiento = lanzar();
  lanzamiento
    .then((browser) => {
      if (vencido) {
        browser.close().catch(() => {
          browser.process()?.kill();
        });
      }
    })
    .catch(() => {});

  const timeout = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => {
      vencido = true;
      rechazar(errorPortal(
        'NAVEGADOR_NO_DISPONIBLE',
        `${nombre} no respondió al abrirse.`,
      ));
    }, TIMEOUT_LAUNCH);
  });

  try {
    return await Promise.race([lanzamiento, timeout]);
  } finally {
    clearTimeout(temporizador);
  }
}

// Lee el modo headless desde la configuración; si falla, muestra el navegador.
function modoHeadless() {
  try {
    return configuracion.leer().navegadorHeadless === true;
  } catch {
    return false;
  }
}

// Lista de navegadores a intentar, en orden de preferencia.
function candidatosNavegador() {
  const headless = modoHeadless();
  const candidatos = [];
  // Edge solo se intenta fuera de Linux
  if (process.platform !== 'linux') {
    candidatos.push({
      nombre: 'Microsoft Edge',
      lanzar: () => chromium.launch({ channel: 'msedge', headless }),
    });
  }
  candidatos.push({
    nombre: 'Firefox',
    lanzar: () => firefox.launch({ headless }),
  });
  return candidatos;
}

async function abrirNavegador() {
  const fallos = [];
  for (const { nombre, lanzar } of candidatosNavegador()) {
    try {
      return await lanzarConTimeout(lanzar, nombre);
    } catch (error) {
      fallos.push(`${nombre}: ${error.message}`);
    }
  }
  throw errorPortal(
    'NAVEGADOR_NO_DISPONIBLE',
    'No se encontró un navegador disponible (Microsoft Edge o Firefox) para abrir el portal.',
    new Error(fallos.join(' | ')),
  );
}

async function cerrarBrowser(browser) {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    try {
      browser.process()?.kill();
    } catch {}
  }
}

async function esperarLogin(page) {
  try {
    await page.waitForSelector('#side', { state: 'visible', timeout: TIMEOUT_SIDE });
  } catch (error) {
    const formularioVisible = await page.locator('#loginForm').isVisible().catch(() => false);
    const mensajeVisible = await page.locator(
      '#loginForm .error, #loginForm .alert, #loginForm [role="alert"], .error, .alert, [role="alert"]',
    ).first().isVisible().catch(() => false);
    if (formularioVisible || mensajeVisible) {
      throw errorPortal('LOGIN_RECHAZADO', 'El portal rechazó las credenciales.', error);
    }
    throw errorPortal('ESTRUCTURA_CAMBIADA',
      'El portal cambió y no se encontró la pantalla posterior al login.', error);
  }
}

// Abre el navegador y hace login UNA sola vez.
async function abrirSesion({ usuario, pass, urlPortal } = {}) {
  const browser = await abrirNavegador();
  try {
    const page = await browser.newPage();
    try {
      let respuesta;
      try {
        respuesta = await page.goto(urlPortal || URL_PORTAL_POR_DEFECTO, {
          waitUntil: 'domcontentloaded',
          timeout: TIMEOUT_NAVEGACION,
        });
      } catch (error) {
        throw errorPortal('PORTAL_INACCESIBLE', 'No se pudo conectar con el portal.', error);
      }
      if (respuesta && respuesta.status() >= 400) {
        throw errorPortal('PORTAL_INACCESIBLE', 'No se pudo conectar con el portal.');
      }

      try {
        await page.locator('#user').fill(usuario);
        await page.locator('#pass').fill(pass);
        await page.locator('#loginForm > button').click({ timeout: TIMEOUT_LOGIN });
      } catch (error) {
        throw errorPortal('ESTRUCTURA_CAMBIADA',
          'El portal cambió y no se encontraron los controles de acceso.', error);
      }
      await esperarLogin(page);
      let cerrado = false;
      return {
        page,
        cerrar: async () => {
          if (cerrado) return;
          cerrado = true;
          await cerrarBrowser(browser);
        },
      };
    } catch (error) {
      await cerrarBrowser(browser);
      throw error.code ? error : errorPortal(
        'ESTRUCTURA_CAMBIADA',
        'El portal cambió y no se pudo completar el acceso.',
        error,
      );
    }
  } catch (error) {
    await cerrarBrowser(browser);
    throw error.code ? error : errorPortal('ESTRUCTURA_CAMBIADA',
      'El portal cambió y no se pudo completar el acceso.', error);
  }
}

async function probarConexion(credenciales) {
  let sesion;
  try {
    sesion = await abrirSesion(credenciales);
  } finally {
    await sesion?.cerrar();
  }
}

/** Navega a una opción del menú Asistencia, desplegándolo si hace falta. */
async function irAMenu(page, clave) {
  try {
    const boton = page.locator(`${MENU_ASISTENCIA} > div > ul > li:nth-child(${POSICION[clave]}) > button`);
    if (!(await boton.isVisible())) {
      await page.locator(`${MENU_ASISTENCIA} > button`).click();
    }
    await boton.click();
  } catch (error) {
    throw errorPortal('ESTRUCTURA_CAMBIADA',
      'El portal cambió y no se encontró el menú de asistencia.', error);
  }
}

module.exports = { abrirSesion, probarConexion, irAMenu };