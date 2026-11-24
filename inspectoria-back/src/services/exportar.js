// Exportar datos (ventana "Exportar / Importar"): asistencia y atrasos en Excel o PDF,
// y el Master de inasistencias justificadas (Excel; con todos los cursos, un ZIP).
// Siempre del año escolar más reciente.
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');
const { ErrorRegistro, exportarMaster } = require('./registroMaster');
const { exportarAsistenciaMensual } = require('./asistenciaMensual');

const ANIO = '(SELECT MAX(anio) FROM matricula)';
const TIPOS = {
  excel: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf: { ext: 'pdf', mime: 'application/pdf' },
  zip: { ext: 'zip', mime: 'application/zip' },
};

const fechaCorta = (iso) => (iso ? iso.split('-').reverse().join('-') : '');
const diaMes = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
const nombreAlumno = (a) => `${a.apellidos}, ${a.nombres}`.trim();

// ---------- Datos ----------

function filtros({ curso, desde, hasta }) {
  return { curso: curso || null, desde: desde || null, hasta: hasta || null };
}

const FILTRO_SQL = `anio = ${ANIO}
  AND (@curso IS NULL OR curso = @curso)
  AND (@desde IS NULL OR fecha >= @desde)
  AND (@hasta IS NULL OR fecha <= @hasta)`;

// Rango real cubierto por las filas (cuando no se eligió uno)
function rangoDe(filas, { desde, hasta }) {
  const fechas = filas.map((f) => f.fecha).sort();
  return { desde: desde || fechas[0], hasta: hasta || fechas.at(-1) };
}

// Por curso: alumnos (orden alfabético), fechas con registro y estado de cada día.
// Código del día: P presente, A / F ausente, J ausencia justificada.
function datosAsistencia(db, opciones) {
  const filas = db.prepare(`
    SELECT rut, apellidos, nombres, curso, fecha, estado, justificada
    FROM v_asistencia
    WHERE ${FILTRO_SQL}
    ORDER BY curso, apellidos, nombres, fecha
  `).all(filtros(opciones));
  if (!filas.length) throw new ErrorRegistro(404, 'No hay asistencia cargada para ese curso y período.');

  const cursos = new Map();
  for (const f of filas) {
    if (!cursos.has(f.curso)) cursos.set(f.curso, { curso: f.curso, fechas: new Set(), alumnos: new Map() });
    const c = cursos.get(f.curso);
    c.fechas.add(f.fecha);
    if (!c.alumnos.has(f.rut)) {
      c.alumnos.set(f.rut, { rut: f.rut, nombre: nombreAlumno(f), dias: new Map() });
    }
    c.alumnos.get(f.rut).dias.set(f.fecha, f.estado === 'P' ? 'P' : (f.justificada ? 'J' : f.estado));
  }
  const resultado = [...cursos.values()].map((c) => ({
    curso: c.curso,
    fechas: [...c.fechas].sort(),
    alumnos: [...c.alumnos.values()].map((a) => {
      const codigos = [...a.dias.values()];
      const presentes = codigos.filter((x) => x === 'P').length;
      const ausencias = codigos.length - presentes;
      return {
        ...a,
        presentes,
        ausencias,
        justificadas: codigos.filter((x) => x === 'J').length,
        porcentaje: codigos.length ? Math.round((presentes / codigos.length) * 1000) / 10 : null,
      };
    }),
  }));
  return { cursos: resultado, rango: rangoDe(filas, opciones) };
}

// Por curso: cada atraso y un resumen por alumno
function datosAtrasos(db, opciones) {
  const filas = db.prepare(`
    SELECT rut, apellidos, nombres, curso, fecha, hora_llegada, justificado_portal, justificado_doc
    FROM v_atraso
    WHERE ${FILTRO_SQL}
    ORDER BY curso, fecha, hora_llegada, apellidos, nombres
  `).all(filtros(opciones));
  if (!filas.length) throw new ErrorRegistro(404, 'No hay atrasos registrados para ese curso y período.');

  const cursos = new Map();
  for (const f of filas) {
    if (!cursos.has(f.curso)) cursos.set(f.curso, { curso: f.curso, atrasos: [], resumen: new Map() });
    const c = cursos.get(f.curso);
    const justificado = Boolean(f.justificado_portal || f.justificado_doc);
    c.atrasos.push({ fecha: f.fecha, hora: f.hora_llegada, rut: f.rut, nombre: nombreAlumno(f), justificado });
    if (!c.resumen.has(f.rut)) c.resumen.set(f.rut, { rut: f.rut, nombre: nombreAlumno(f), total: 0, sinJustificar: 0 });
    const r = c.resumen.get(f.rut);
    r.total += 1;
    if (!justificado) r.sinJustificar += 1;
  }
  const resultado = [...cursos.values()].map((c) => ({
    curso: c.curso,
    atrasos: c.atrasos,
    resumen: [...c.resumen.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es')),
  }));
  return { cursos: resultado, rango: rangoDe(filas, opciones) };
}

// ---------- Excel ----------

const COLOR = { ausente: 'FFF8D7DA', justificada: 'FFFFF3CD', encabezado: 'FFE7EAF0' };
const relleno = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
// Excel no acepta \ / ? * [ ] : en el nombre de la hoja, y como máximo 31 caracteres
const nombreHoja = (texto) => texto.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

function encabezadoHoja(hoja, titulo, subtitulo, columnas) {
  hoja.getCell('A1').value = titulo;
  hoja.getCell('A1').font = { bold: true, size: 14 };
  hoja.getCell('A2').value = subtitulo;
  hoja.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };
  const fila = hoja.getRow(4);
  columnas.forEach((col, i) => {
    const celda = fila.getCell(i + 1);
    celda.value = col.titulo;
    celda.font = { bold: true };
    celda.fill = relleno(COLOR.encabezado);
    celda.alignment = { horizontal: col.alinear || 'left', vertical: 'middle' };
    hoja.getColumn(i + 1).width = col.ancho;
  });
}

async function excelAsistencia({ cursos, rango }) {
  const wb = new ExcelJS.Workbook();
  for (const c of cursos) {
    const hoja = wb.addWorksheet(nombreHoja(c.curso), { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
    const columnas = [
      { titulo: 'N°', ancho: 5, alinear: 'center' },
      { titulo: 'Alumno', ancho: 36 },
      { titulo: 'RUT', ancho: 13 },
      ...c.fechas.map((f) => ({ titulo: diaMes(f), ancho: 6.5, alinear: 'center' })),
      { titulo: 'Presentes', ancho: 10, alinear: 'center' },
      { titulo: 'Ausencias', ancho: 10, alinear: 'center' },
      { titulo: 'Justificadas', ancho: 12, alinear: 'center' },
      { titulo: '% Asistencia', ancho: 12, alinear: 'center' },
    ];
    encabezadoHoja(hoja, `Asistencia ${c.curso}`,
      `Período: ${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)} · P presente · A / F ausente · J ausencia justificada`,
      columnas);
    c.alumnos.forEach((a, i) => {
      const fila = hoja.getRow(5 + i);
      fila.values = [
        i + 1, a.nombre, a.rut,
        ...c.fechas.map((f) => a.dias.get(f) || ''),
        a.presentes, a.ausencias, a.justificadas, a.porcentaje == null ? '' : a.porcentaje / 100,
      ];
      c.fechas.forEach((f, j) => {
        const codigo = a.dias.get(f);
        const celda = fila.getCell(4 + j);
        celda.alignment = { horizontal: 'center' };
        if (codigo === 'A' || codigo === 'F') celda.fill = relleno(COLOR.ausente);
        if (codigo === 'J') celda.fill = relleno(COLOR.justificada);
      });
      const primeraTotal = 4 + c.fechas.length;
      for (let k = 0; k < 4; k += 1) fila.getCell(primeraTotal + k).alignment = { horizontal: 'center' };
      fila.getCell(primeraTotal + 3).numFmt = '0.0%';
      fila.getCell(1).alignment = { horizontal: 'center' };
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function excelAtrasos({ cursos, rango }) {
  const wb = new ExcelJS.Workbook();
  for (const c of cursos) {
    const hoja = wb.addWorksheet(nombreHoja(c.curso), { views: [{ state: 'frozen', ySplit: 4 }] });
    encabezadoHoja(hoja, `Atrasos ${c.curso}`,
      `Período: ${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)} · ${c.atrasos.length} atrasos`,
      [
        { titulo: 'Fecha', ancho: 12, alinear: 'center' },
        { titulo: 'Hora', ancho: 8, alinear: 'center' },
        { titulo: 'Alumno', ancho: 36 },
        { titulo: 'RUT', ancho: 13 },
        { titulo: 'Justificado', ancho: 12, alinear: 'center' },
      ]);
    c.atrasos.forEach((t, i) => {
      const fila = hoja.getRow(5 + i);
      fila.values = [fechaCorta(t.fecha), t.hora, t.nombre, t.rut, t.justificado ? 'Sí' : 'No'];
      [1, 2, 5].forEach((n) => { fila.getCell(n).alignment = { horizontal: 'center' }; });
      if (!t.justificado) fila.getCell(5).fill = relleno(COLOR.ausente);
    });

    // Resumen por alumno a la derecha (columnas G..J)
    const inicio = 7;
    const titulos = [['Resumen por alumno', 36], ['RUT', 13], ['Atrasos', 10], ['Sin justificar', 14]];
    titulos.forEach(([titulo, ancho], k) => {
      const celda = hoja.getRow(4).getCell(inicio + k);
      celda.value = titulo;
      celda.font = { bold: true };
      celda.fill = relleno(COLOR.encabezado);
      hoja.getColumn(inicio + k).width = ancho;
    });
    c.resumen.forEach((r, i) => {
      const fila = hoja.getRow(5 + i);
      [r.nombre, r.rut, r.total, r.sinJustificar].forEach((v, k) => { fila.getCell(inicio + k).value = v; });
      fila.getCell(inicio + 2).alignment = { horizontal: 'center' };
      fila.getCell(inicio + 3).alignment = { horizontal: 'center' };
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- PDF ----------

const PDF = { margen: 30, alto: 13, fuente: 7.5 };

function nuevoPdf() {
  // Sin página inicial: cada tabla empieza con su propia página
  const doc = new PDFDocument({
    size: 'A4', layout: 'landscape', margin: PDF.margen, bufferPages: true, autoFirstPage: false,
  });
  const partes = [];
  doc.on('data', (p) => partes.push(p));
  const terminado = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });
  return { doc, terminado };
}

// Dibuja una tabla desde una página nueva; repite el título y el encabezado en cada página
function tablaPdf(doc, { titulo, subtitulo, columnas, filas, colorCelda }) {
  doc.addPage();
  const limite = doc.page.height - PDF.margen - 18;
  const x0 = PDF.margen;

  const encabezado = () => {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(titulo, x0, PDF.margen);
    doc.font('Helvetica').fontSize(8.5).fillColor('#555').text(subtitulo, x0, PDF.margen + 18);
    let x = x0;
    const y = PDF.margen + 36;
    doc.rect(x0, y, columnas.reduce((s, c) => s + c.ancho, 0), PDF.alto).fill('#E7EAF0');
    doc.font('Helvetica-Bold').fontSize(PDF.fuente).fillColor('#111');
    for (const col of columnas) {
      doc.text(col.titulo, x + 2, y + 3, { width: col.ancho - 4, align: col.alinear || 'left', lineBreak: false });
      x += col.ancho;
    }
    return y + PDF.alto;
  };

  let y = encabezado();
  filas.forEach((fila, i) => {
    if (y + PDF.alto > limite) {
      doc.addPage();
      y = encabezado();
    }
    let x = x0;
    if (i % 2 === 1) doc.rect(x0, y, columnas.reduce((s, c) => s + c.ancho, 0), PDF.alto).fill('#F6F7F9');
    columnas.forEach((col, j) => {
      const color = colorCelda?.(i, j);
      if (color) doc.rect(x, y, col.ancho, PDF.alto).fill(color);
      doc.font('Helvetica').fontSize(PDF.fuente).fillColor('#111')
        .text(String(fila[j] ?? ''), x + 2, y + 3, { width: col.ancho - 4, align: col.alinear || 'left', lineBreak: false, ellipsis: true });
      x += col.ancho;
    });
    y += PDF.alto;
  });
  if (!filas.length) doc.font('Helvetica').fontSize(9).fillColor('#555').text('Sin registros.', x0, y + 6);
}

function pieDePagina(doc) {
  const generado = new Date();
  const texto = `Generado el ${fechaCorta(generado.toISOString().slice(0, 10))} `
    + `${String(generado.getHours()).padStart(2, '0')}:${String(generado.getMinutes()).padStart(2, '0')}`
    + ' · Sistema de Apoyo para Inspectoría';
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i += 1) {
    doc.switchToPage(i);
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // para que escribir en el borde no agregue otra página
    doc.font('Helvetica').fontSize(7).fillColor('#777')
      .text(`${texto} · Página ${i - start + 1} de ${count}`, PDF.margen, doc.page.height - PDF.margen + 6,
        { width: doc.page.width - PDF.margen * 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margenInferior;
  }
}

async function cerrarPdf(doc, terminado) {
  pieDePagina(doc);
  doc.end();
  return terminado;
}

const FECHAS_POR_PAGINA = 24;

async function pdfAsistencia({ cursos, rango }) {
  const { doc, terminado } = nuevoPdf();
  for (const c of cursos) {
    const bloques = [];
    for (let i = 0; i < c.fechas.length; i += FECHAS_POR_PAGINA) bloques.push(c.fechas.slice(i, i + FECHAS_POR_PAGINA));
    bloques.forEach((fechas, b) => {
      const columnas = [
        { titulo: 'N°', ancho: 18, alinear: 'center' },
        { titulo: 'Alumno', ancho: 170 },
        ...fechas.map((f) => ({ titulo: diaMes(f), ancho: 18.5, alinear: 'center' })),
        { titulo: 'Pres.', ancho: 34, alinear: 'center' },
        { titulo: 'Aus.', ancho: 34, alinear: 'center' },
        { titulo: 'Just.', ancho: 34, alinear: 'center' },
        { titulo: '% Asist.', ancho: 40, alinear: 'center' },
      ];
      const parte = bloques.length > 1 ? ` (parte ${b + 1} de ${bloques.length})` : '';
      tablaPdf(doc, {
        titulo: `Asistencia ${c.curso}${parte}`,
        subtitulo: `Período: ${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)} · P presente · A / F ausente · J ausencia justificada`,
        columnas,
        filas: c.alumnos.map((a, i) => [
          i + 1, a.nombre, ...fechas.map((f) => a.dias.get(f) || ''),
          a.presentes, a.ausencias, a.justificadas, a.porcentaje == null ? '' : `${a.porcentaje}%`,
        ]),
        colorCelda: (i, j) => {
          if (j < 2 || j >= 2 + fechas.length) return null;
          const codigo = c.alumnos[i].dias.get(fechas[j - 2]);
          if (codigo === 'A' || codigo === 'F') return '#F8D7DA';
          if (codigo === 'J') return '#FFF3CD';
          return null;
        },
      });
    });
  }
  return cerrarPdf(doc, terminado);
}

async function pdfAtrasos({ cursos, rango }) {
  const { doc, terminado } = nuevoPdf();
  for (const c of cursos) {
    const sub = `Período: ${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)}`;
    tablaPdf(doc, {
      titulo: `Atrasos ${c.curso}`,
      subtitulo: `${sub} · ${c.atrasos.length} atrasos`,
      columnas: [
        { titulo: 'Fecha', ancho: 70, alinear: 'center' },
        { titulo: 'Hora', ancho: 50, alinear: 'center' },
        { titulo: 'Alumno', ancho: 260 },
        { titulo: 'RUT', ancho: 80 },
        { titulo: 'Justificado', ancho: 70, alinear: 'center' },
      ],
      filas: c.atrasos.map((t) => [fechaCorta(t.fecha), t.hora, t.nombre, t.rut, t.justificado ? 'Sí' : 'No']),
      colorCelda: (i, j) => (j === 4 && !c.atrasos[i].justificado ? '#F8D7DA' : null),
    });
    tablaPdf(doc, {
      titulo: `Atrasos ${c.curso} · resumen por alumno`,
      subtitulo: sub,
      columnas: [
        { titulo: 'Alumno', ancho: 260 },
        { titulo: 'RUT', ancho: 80 },
        { titulo: 'Atrasos', ancho: 60, alinear: 'center' },
        { titulo: 'Sin justificar', ancho: 70, alinear: 'center' },
      ],
      filas: c.resumen.map((r) => [r.nombre, r.rut, r.total, r.sinJustificar]),
    });
  }
  return cerrarPdf(doc, terminado);
}

// ---------- Master (todos los cursos → ZIP) ----------

async function masterTodos(db) {
  const cursos = db.prepare(`
    SELECT DISTINCT c.nombre AS curso FROM curso c
    JOIN matricula m ON m.id_curso = c.id_curso
    WHERE m.anio = ${ANIO} ORDER BY c.nombre
  `).all().map((f) => f.curso);
  const zip = new JSZip();
  const advertencias = [];
  for (const curso of cursos) {
    try {
      const { buffer, nombreArchivo, advertencias: avisos } = await exportarMaster(db, curso);
      zip.file(nombreArchivo, buffer);
      advertencias.push(...avisos.map((a) => `${curso}: ${a}`));
    } catch (error) {
      if (!(error instanceof ErrorRegistro)) throw error;
      advertencias.push(`${curso}: ${error.message}`);
    }
  }
  if (!Object.keys(zip.files).length) throw new ErrorRegistro(404, 'No hay cursos con alumnos para exportar.');
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), advertencias };
}

// ---------- Entrada ----------

const DOCUMENTOS = {
  asistencia: 'Asistencia', asistenciaMensual: 'Asistencia mensual', atrasos: 'Atrasos', master: 'Master',
};

async function exportarDocumento(db, { documento, curso, formato, desde, hasta }) {
  // Formato del reporte mensual del portal: un Excel por curso y mes (varios → ZIP)
  if (documento === 'asistenciaMensual') {
    if (formato !== 'excel') throw new ErrorRegistro(400, 'La Asistencia mensual solo se exporta en Excel.');
    return exportarAsistenciaMensual(db, { curso, desde, hasta });
  }
  if (documento === 'master') {
    if (formato !== 'excel') throw new ErrorRegistro(400, 'El Master solo se exporta en Excel.');
    if (curso) {
      const r = await exportarMaster(db, curso);
      return { ...r, tipo: TIPOS.excel.mime };
    }
    const { buffer, advertencias } = await masterTodos(db);
    return {
      buffer,
      advertencias,
      tipo: TIPOS.zip.mime,
      nombreArchivo: 'Master de registro inasistencia justificadas (todos los cursos).zip',
    };
  }

  const opciones = { curso, desde, hasta };
  const datos = documento === 'asistencia' ? datosAsistencia(db, opciones) : datosAtrasos(db, opciones);
  const generar = {
    asistencia: { excel: excelAsistencia, pdf: pdfAsistencia },
    atrasos: { excel: excelAtrasos, pdf: pdfAtrasos },
  }[documento][formato];
  const buffer = await generar(datos);
  const quien = curso || 'todos los cursos';
  const periodo = `${fechaCorta(datos.rango.desde)} a ${fechaCorta(datos.rango.hasta)}`;
  return {
    buffer,
    advertencias: [],
    tipo: TIPOS[formato].mime,
    nombreArchivo: `${DOCUMENTOS[documento]} ${quien} ${periodo}.${TIPOS[formato].ext}`,
  };
}

module.exports = { exportarDocumento, DOCUMENTOS };
