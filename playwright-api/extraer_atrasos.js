const { irAMenu } = require('./sesion_portal.js');

/** Lee la tabla de la ventana "Atrasos" para un curso específico. Devuelve lo que espera parsearAtrasos(). */
async function extraerTablaAtrasos(page, curso) {
  await irAMenu(page, 'atrasos');

  const etiqueta = page.getByText(/\d+\s+registros/).first();   // "45 registros"
  await etiqueta.waitFor();

  // 1. Primero seleccionamos el curso en el selector
  await page.locator('#fCurso').selectOption({ label: curso });

  // 2. Esperamos a que la aplicación actualice los datos de la tabla (ajustable según tu backend)
  await page.waitForLoadState('networkidle');

  // 3. Obtenemos el total de registros *después* de aplicar el filtro del curso
  const totalDeclarado = +(await etiqueta.innerText()).match(/\d+/)[0];

  const tabla = page.locator('table').first();
  await tabla.waitFor();
  const headers = await tabla.locator('thead th').allInnerTexts();
  const filas = await tabla.locator('tbody tr').evaluateAll(trs =>
    trs.map(tr => [...tr.cells].map(td => td.innerText.trim())));

  return { headers, filas, totalDeclarado };
}

module.exports = { extraerTablaAtrasos };