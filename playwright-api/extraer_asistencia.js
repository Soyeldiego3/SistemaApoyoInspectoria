const { irAMenu } = require('./sesion_portal');

/** Descarga el Excel mensual de un curso y lo devuelve como Buffer (sin tocar el disco). */
async function descargarAsistencia(page, curso, mes) {
  await irAMenu(page, 'mensual');
  await page.locator('#mCurso').selectOption({ label: curso });
  await page.locator('#mMes').selectOption({ label: mes });
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