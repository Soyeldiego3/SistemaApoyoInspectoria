const { chromium } = require('playwright');

const URL_PORTAL_POR_DEFECTO = 'http://50.19.6.170:8080';
const TIMEOUT_NAVEGACION = 15000;
const TIMEOUT_LOGIN = 12000;

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

async function abrirNavegador() {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true });
  } catch (error) {
    throw errorPortal('NAVEGADOR_NO_DISPONIBLE',
      'No se encontró Microsoft Edge disponible para abrir el portal.', error);
  }
}

async function esperarLogin(page) {
  try {
    await page.waitForSelector('#side', { state: 'visible', timeout: TIMEOUT_LOGIN });
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
      await page.locator('#loginForm > button').click();
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
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close().catch(() => {});
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