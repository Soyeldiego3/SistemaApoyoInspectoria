const { irAMenu } = require('./sesion_portal.js');

// Selectores de la ventana "Asistencia por clase".
// Playwright acepta CSS ('#cCurso') o XPath: todo selector que empieza con '//' se trata como XPath.
const SELECTORES = {
  curso: '//*[@id="cCurso"]',   // <select> Curso
  fecha: '//*[@id="cFecha"]',   // <input type="date"> Fecha
  bloque: '//*[@id="cBloque"]',  // <select> Bloque
  tabla: '//*[@id="tbl"]/table',   // <table> con N.°, Alumno, RUT, Estado
  resumen: '//*[@id="cnt"]', // texto "20 presentes · 2 ausentes · 0 atrasos"
};

const MARCA = 'data-extractor-leida';

function errorEstructura(mensaje, causa) {
  const error = new Error(mensaje);
  error.code = 'ESTRUCTURA_CAMBIADA';
  if (causa) error.cause = causa;
  return error;
}

async function leerOpcionesBloque(page) {
  const select = page.locator(SELECTORES.bloque);
  await select.waitFor();
  const opciones = await select.locator('option').evaluateAll((elements) =>
    elements.map((option) => ({ label: option.textContent.trim(), value: option.value })));
  // Descarta opciones vacías tipo "Seleccione..."
  return opciones.filter(({ label, value }) => value !== '' && /\d{1,2}:\d{2}/.test(label));
}

// Texto actual de la tabla + resumen. evaluateAll no espera: si aún no existen devuelve ''.
async function firmaVista(page) {
  const leer = (selector) => page.locator(selector)
    .evaluateAll((elementos) => elementos.map((e) => e.innerText).join('\n'));
  return `${await leer(SELECTORES.tabla)}\u0000${await leer(SELECTORES.resumen)}`;
}

// Marca la tabla actual. Si el portal la vuelve a dibujar, la tabla nueva no trae la marca,
// así se detecta el cambio de bloque al instante aunque los datos sean idénticos.
async function marcarTabla(page) {
  await page.locator(SELECTORES.tabla)
    .evaluateAll((tablas, marca) => tablas.forEach((t) => t.setAttribute(marca, '1')), MARCA);
}

// 'nueva': hay tabla y ninguna trae la marca. 'marcada': sigue la anterior. 'ninguna': se está dibujando.
async function estadoTabla(page) {
  return page.locator(SELECTORES.tabla).evaluateAll((tablas, marca) => {
    if (!tablas.length) return 'ninguna';
    return tablas.every((t) => !t.hasAttribute(marca)) ? 'nueva' : 'marcada';
  }, MARCA);
}

// Tras elegir un bloque, espera a que la tabla se redibuje (sin la marca) o a que su texto cambie.
// Hace falta porque el portal dibuja sin pedir nada a la red (networkidle no sirve aquí).
// Si el portal actualiza la tabla en el mismo lugar y los datos son idénticos, sigue al vencer `limite`.
async function esperarActualizacion(page, antes, { limite = 1500, intervalo = 50 } = {}) {
  const inicio = Date.now();
  while (Date.now() - inicio < limite) {
    const estado = await estadoTabla(page);
    if (estado === 'nueva') return;
    // Actualización en el mismo <table>: basta con que cambie el texto
    if (estado === 'marcada' && await firmaVista(page) !== antes) return;
    await page.waitForTimeout(intervalo);
  }
}

// Lee encabezados y filas de una vez: sirve con o sin <thead>, y si el estado
// es un <select> o un botón se toma el texto visible/seleccionado.
function leerTabla(page) {
  return page.locator(SELECTORES.tabla).first().evaluate((table) => {
    const texto = (celda) => {
      const select = celda.querySelector('select');
      if (select) return (select.selectedOptions[0]?.textContent || '').trim();
      return celda.innerText.trim();
    };
    const filasTabla = [...table.rows];
    const cabecera = filasTabla.find((tr) => tr.querySelector('th') && !tr.querySelector('td'));
    return {
      headers: cabecera ? [...cabecera.cells].map(texto) : [],
      filas: filasTabla.filter((tr) => tr.querySelector('td')).map((tr) => [...tr.cells].map(texto)),
    };
  });
}

/** Todos los bloques de un curso en una fecha, con la ventana ya abierta. */
async function leerCurso(page, curso, fecha) {
  const selectCurso = page.locator(SELECTORES.curso);
  // Límite corto: si el curso no existe en esta vista, se anota el error y se sigue con el resto
  await selectCurso.locator('option').filter({ hasText: curso }).first().waitFor({ state: 'attached', timeout: 5000 });
  // Cambiar de curso también redibuja la tabla: se espera ese redibujado para no confundirlo
  // con el del primer bloque
  const antesCurso = await firmaVista(page);
  await marcarTabla(page);
  await selectCurso.selectOption({ label: curso });
  // <input type="date"> se llena siempre en ISO, aunque el navegador lo muestre "25 - 11 - 2026"
  await page.locator(SELECTORES.fecha).fill(fecha);
  await esperarActualizacion(page, antesCurso);

  const tablas = [];
  for (const { label, value } of await leerOpcionesBloque(page)) {
    const antes = await firmaVista(page);
    await marcarTabla(page);
    await page.locator(SELECTORES.bloque).selectOption({ value });
    await esperarActualizacion(page, antes);
    await page.locator(SELECTORES.tabla).first().waitFor();
    const { headers, filas } = await leerTabla(page);
    const resumen = (await page.locator(SELECTORES.resumen).first().innerText()).trim();
    tablas.push({ curso, fecha, bloque: label, headers, filas, resumen });
  }
  return tablas;
}

/**
 * Asistencia por clase de varios cursos en una fecha (YYYY-MM-DD), con la sesión ya abierta.
 * Abre el menú una sola vez. Si un curso falla se anota en `errores` y se sigue con el resto.
 * Devuelve { tablas: [{ curso, fecha, bloque, headers, filas, resumen }], errores: [{ curso, mensaje }] }.
 */
async function extraerAsistenciaClaseDia(page, { fecha, cursos }) {
  await irAMenu(page, 'clase');
  const tablas = [];
  const errores = [];
  for (const curso of cursos) {
    try {
      tablas.push(...await leerCurso(page, curso, fecha));
    } catch (error) {
      errores.push({ curso, mensaje: error.message });
    }
  }
  // Si fallaron todos, lo más probable es que el portal cambió: se avisa como tal
  if (cursos.length && errores.length === cursos.length) {
    throw errorEstructura('El portal cambió y no se pudo leer la asistencia por clase.', new Error(errores[0].mensaje));
  }
  return { tablas, errores };
}

module.exports = { extraerAsistenciaClaseDia, SELECTORES };
