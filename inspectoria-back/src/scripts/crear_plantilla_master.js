// Crea la plantilla del "Master de registro inasistencia justificadas" SIN datos personales,
// a partir de un archivo real del establecimiento. Se ejecuta una sola vez:
//   node src/scripts/crear_plantilla_master.js "<archivo real>.xlsx"
// Conserva estilos, celdas combinadas y fórmulas; borra nombres, fechas, códigos,
// observaciones y los resultados en caché de las fórmulas.
const path = require('path');
const ExcelJS = require('exceljs');

const SALIDA = path.join(__dirname, '..', '..', 'plantillas', 'master-inasistencias.xlsx');

function limpiarResultado(celda) {
  const v = celda.value;
  if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) {
    const { result, ...sinResultado } = v;
    celda.value = sinResultado;
  }
}

async function main() {
  const origen = process.argv[2];
  if (!origen) throw new Error('Indica la ruta del archivo real como argumento.');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(origen);

  const master = wb.getWorksheet('MASTER');
  master.getCell('D1').value = 0;
  master.getCell('E1').value = 'Registrado al';
  const b2 = master.getCell('B2');
  if (b2.value?.richText) {
    b2.value = { richText: b2.value.richText.map((r, i) => (i === 0 ? r : { ...r, text: '' })) };
  }
  for (let fila = 4; fila <= 43; fila += 1) master.getCell(`B${fila}`).value = null;

  for (const hoja of wb.worksheets) {
    if (hoja.name !== 'MASTER') {
      for (let fila = 3; fila <= 152; fila += 1) {
        for (const col of ['B', 'C', 'O']) hoja.getCell(`${col}${fila}`).value = null;
      }
    }
    hoja.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, limpiarResultado));
  }

  wb.creator = 'Sistema de Apoyo a Inspectoría';
  wb.lastModifiedBy = '';
  await wb.xlsx.writeFile(SALIDA);
  console.log(`Plantilla creada en ${SALIDA}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
