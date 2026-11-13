const { irAMenu } = require('./sesion_portal.js');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function normalizarTexto(texto) {
  return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

async function seleccionarMes(select, mes) {
  const mesNormalizado = normalizarTexto(mes);
  const numeroMes = MESES.indexOf(mesNormalizado) + 1;
  const opciones = await select.locator('option').evaluateAll((elements) =>
    elements.map((option) => ({
      label: option.textContent.trim(),
      value: option.value.trim(),
    }))
  );
  const opcion = opciones.find(({ label, value }) => {
    const labelNormalizado = normalizarTexto(label);
    const valueNormalizado = normalizarTexto(value);
    return labelNormalizado === mesNormalizado
      || labelNormalizado.startsWith(`${mesNormalizado} `)
      || labelNormalizado.startsWith(mesNormalizado.slice(0, 3))
      || valueNormalizado === mesNormalizado
      || valueNormalizado === String(numeroMes)
      || valueNormalizado === String(numeroMes).padStart(2, '0')
      || labelNormalizado === String(numeroMes);
  });

  if (!opcion) {
    throw new Error(`No se encontró el mes "${mes}" en el portal.`);
  }

  await select.selectOption({ value: opcion.value });
}

/** Descarga el Excel mensual de un curso y lo devuelve como Buffer (sin tocar el disco). */
async function descargarAsistencia(page, curso, mes) {
  await irAMenu(page, 'mensual');
  await page.locator('#mCurso').selectOption({ label: curso });
  await seleccionarMes(page.locator('#mMes'), mes);
  await page.locator('#tbl table').waitFor();
  await page.locator('#tbl > table > tbody > tr > td:nth-child(4) > button').click();

  const descarga = page.waitForEvent('download');
  await page.locator('#xls').click();
  const download = await descarga;

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = { descargarAsistencia };