const { chromium } = require('playwright');

const URL_PORTAL = process.env.PORTAL_URL || 'http://127.0.0.1:3000';

// Prefijo del grupo "Asistencia" en el menú
const MENU_ASISTENCIA = '#nav > ul > li:nth-child(2) > div > ul > li:nth-child(1)';
// Posición de cada opción dentro del grupo.
const POSICION = { atrasos: 2, mensual: 5 };

// Abre el navegador y hace login UNA sola vez
async function abrirSesion() {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await page.goto(URL_PORTAL);
    await page.locator('#user').fill(process.env.USUARIO);
    await page.locator('#pass').fill(process.env.PASS);
    await page.locator('#loginForm > button').click();
    await page.waitForSelector('#side');
    return { page, cerrar: () => browser.close() };
  } catch (err) {
    await browser.close();   // si el login falla cerramos el navegador para no dejar procesos colgados
    throw err;
  }
}

/** Navega a una opción del menú Asistencia, desplegándolo si hace falta. */
async function irAMenu(page, clave) {
  const boton = page.locator(`${MENU_ASISTENCIA} > div > ul > li:nth-child(${POSICION[clave]}) > button`);
  if (!(await boton.isVisible())) {
    await page.locator(`${MENU_ASISTENCIA} > button`).click();
  }
  await boton.click();
}

module.exports = { abrirSesion, irAMenu };