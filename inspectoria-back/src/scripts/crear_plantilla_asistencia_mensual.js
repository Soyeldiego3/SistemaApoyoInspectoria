// Crea la plantilla "Asistencia mensual" (formato del reporte mensual del portal) SIN datos
// personales, a partir de un archivo real. Se ejecuta una sola vez:
//   node src/scripts/crear_plantilla_asistencia_mensual.js "<Asistencia_CURSO_Mes_N>.xlsx"
//
// Del archivo real solo se toman la estructura y los anchos de columna:
//   fila 1 título · fila 2 fecha de generación · filas 3-4 encabezado (N°, Nombre, letra y
//   número de cada día en C..AG, Presente, Ausente, % Mes, % Anual) · desde la fila 5 alumnos.
// Nombres, marcas, totales, título y fecha quedan vacíos (los llena services/asistenciaMensual.js).
// Se agrega un formato mínimo (negrita, bordes, centrado) sin cambiar la estructura.
const path = require('path');
const ExcelJS = require('exceljs');

const SALIDA = path.join(__dirname, '..', '..', 'plantillas', 'asistencia-mensual.xlsx');
const COLUMNAS = 37; // A..AK
const COL_PRIMER_DIA = 3; // C
const COL_PRESENTE = 34; // AH
const FILA_MODELO = 5; // fila de alumno con el formato que se copia a cada alumno

const BORDE = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDES = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
const ENCABEZADO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EAF0' } };

async function main() {
  const origen = process.argv[2];
  if (!origen) throw new Error('Indica la ruta del archivo real como argumento.');
  const real = new ExcelJS.Workbook();
  await real.xlsx.readFile(origen);
  const hojaReal = real.worksheets[0];
  const encabezados = ['Presente', 'Ausente', '% Mes', '% Anual'];
  const reales = encabezados.map((_, i) => hojaReal.getRow(3).getCell(COL_PRESENTE + i).value);
  if (reales.join('|') !== encabezados.join('|')) {
    throw new Error(`El archivo no tiene el formato esperado (fila 3: ${reales.join(', ')}).`);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de Apoyo a Inspectoría';
  const hoja = wb.addWorksheet(hojaReal.name || 'Asistencia');

  // Anchos del original (las columnas de totales no traen ancho: se les da uno legible)
  // (ojo: exceljs no guarda un ancho de 9, porque es su valor por defecto)
  for (let col = 1; col <= COLUMNAS; col += 1) {
    hoja.getColumn(col).width = col < COL_PRESENTE ? hojaReal.getColumn(col).width : 10;
  }

  hoja.getCell('A1').font = { bold: true, size: 12 };
  hoja.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };

  // Encabezado: N° y Nombre ocupan las dos filas (como en el original)
  hoja.getCell('A3').value = 'N°';
  hoja.getCell('B3').value = 'Nombre';
  hoja.mergeCells('A3:A4');
  hoja.mergeCells('B3:B4');
  encabezados.forEach((texto, i) => { hoja.getRow(3).getCell(COL_PRESENTE + i).value = texto; });
  for (const fila of [3, 4]) {
    for (let col = 1; col <= COLUMNAS; col += 1) {
      const celda = hoja.getRow(fila).getCell(col);
      celda.font = { bold: true };
      celda.fill = ENCABEZADO;
      celda.border = BORDES;
      celda.alignment = { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle' };
    }
  }

  // Fila modelo de alumno: sin datos, solo formato
  for (let col = 1; col <= COLUMNAS; col += 1) {
    const celda = hoja.getRow(FILA_MODELO).getCell(col);
    celda.border = BORDES;
    celda.alignment = { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle' };
  }

  hoja.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }];
  await wb.xlsx.writeFile(SALIDA);
  console.log(`Plantilla creada en ${SALIDA}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
