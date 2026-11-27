// "Asistencia mensual": el reporte mensual de asistencia por curso del portal
// (p. ej. "Asistencia_TERCERO MEDIO A_Mes_8.xlsx"). Exportar e importar en ese formato.
//
// Formato (ver plantillas/asistencia-mensual.xlsx):
//   A1  "Asistencia mensual ( TERCERO MEDIO A - agosto  2026)"
//   A2  fecha y hora de generación ("19/8/2026 22:29:02")
//   3-4 encabezado: A "N°", B "Nombre" (combinadas en las dos filas); C..AG letra (fila 3) y
//       número (fila 4) de cada día del mes; AH Presente, AI Ausente, AJ % Mes, AK % Anual
//   5.. un alumno por fila: ● presente, x ausente, vacío = sin clases o sin registro
//   después: Total Presentes, Total Ausentes, Matrícula, % Asistencia, % Inasistencia (por
//       día) y Promedios finales (AH..AK), con A:B combinadas
// No trae RUT: al importar, los alumnos se buscan por nombre en el curso.
//
// También se importa el Excel mensual que descarga la sincronización (A2 "Curso 7°A · Julio
// 2026 · …", con RUT), reutilizando parsearAsistencia/guardar.
const path = require('path');
// exceljs se carga recién al usarlo (es pesado y alarga el arranque del backend)
const ExcelJS = { get Workbook() { return require('exceljs').Workbook; } };
const JSZip = require('jszip');
const XLSX = require('xlsx');
const { sinTildes } = require('./justificativos');
const {
  ErrorRegistro, claveCurso, cursoDesdeTexto, buscadorDeAlumnos, alumnosDelCurso,
} = require('./registroMaster');
const { parsearAsistencia, guardar } = require('./asistencia');

const PLANTILLA = path.join(__dirname, '..', '..', 'plantillas', 'asistencia-mensual.xlsx');
const COL_PRIMER_DIA = 3; // C
const DIAS_COLUMNAS = 31; // C..AG
const COL_PRESENTE = 34; // AH
const COL_AUSENTE = 35;
const COL_PCT_MES = 36;
const COL_PCT_ANUAL = 37;
const COLUMNAS = 37; // A..AK
const FILA_LETRAS = 3;
const FILA_NUMEROS = 4;
const FILA_PRIMER_ALUMNO = 5;
const LETRAS = ['D', 'L', 'M', 'Mi', 'J', 'V', 'S']; // por getUTCDay()
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ORDINALES = ['PRIMERO', 'SEGUNDO', 'TERCERO', 'CUARTO', 'QUINTO', 'SEXTO', 'SEPTIMO', 'OCTAVO'];
// Las faltas justificadas también son "x", igual que en el portal
const MARCA = { P: '●', A: 'x', F: 'x' };
const ESTADO_DE_MARCA = { '●': 'P', x: 'A', X: 'A', '✕': 'A', '✗': 'A', '×': 'A' };
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const dos = (n) => String(n).padStart(2, '0');
const diasDelMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
const letraDelDia = (anio, mes, dia) => LETRAS[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
const redondear = (valor) => (valor == null ? null : Math.round(valor));
const promedio = (lista) => {
  const valores = lista.filter((v) => v != null);
  return valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
};
const fechaCorta = (iso) => (iso ? iso.split('-').reverse().join('-') : '');

// ---------- Cursos: "3°M A" ↔ "TERCERO MEDIO A", "7°A" ↔ "SEPTIMO BASICO A" ----------
function nombreCursoLargo(curso) {
  const medio = /^(\d+)\s*[°º]\s*M\s*([A-Z])$/i.exec(curso);
  const basico = medio ? null : /^(\d+)\s*[°º]\s*([A-Z])$/i.exec(curso);
  const partes = medio || basico;
  if (!partes || !ORDINALES[partes[1] - 1]) return sinTildes(curso);
  return `${ORDINALES[partes[1] - 1]} ${medio ? 'MEDIO' : 'BASICO'} ${partes[2].toUpperCase()}`;
}

function cursoDesdeNombreLargo(texto) {
  const t = sinTildes(texto);
  const largo = new RegExp(`\\b(${ORDINALES.join('|')})\\s+(MEDIO|BASICO)\\s+([A-Z])\\b`).exec(t);
  if (largo) {
    const n = ORDINALES.indexOf(largo[1]) + 1;
    return largo[2] === 'MEDIO' ? `${n}°M ${largo[3]}` : `${n}°${largo[3]}`;
  }
  return cursoDesdeTexto(texto); // "3 medio A", "7 básico B"
}

// Curso del archivo tal como está en la app (o error), respetando el curso elegido si lo hay
function resolverCurso(db, cursoArchivo, cursoElegido) {
  const enApp = cursoArchivo && db.prepare('SELECT nombre FROM curso').all()
    .map((c) => c.nombre).find((n) => claveCurso(n) === claveCurso(cursoArchivo));
  if (cursoElegido && cursoArchivo && claveCurso(cursoArchivo) !== claveCurso(cursoElegido)) {
    throw new ErrorRegistro(409, `El archivo parece ser del curso ${cursoArchivo}, pero elegiste ${cursoElegido}.`,
      { cursoArchivo });
  }
  if (!enApp) {
    throw new ErrorRegistro(400, cursoArchivo
      ? `El archivo es del curso ${cursoArchivo}, que no está cargado en la app. Sincroniza primero.`
      : 'No se pudo detectar el curso del archivo.');
  }
  return enApp;
}

// ---------- Exportar ----------

// "19/8/2026 22:29:02", como el portal
function marcaDeTiempo(fecha) {
  return `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()} `
    + `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}`;
}

const BASE_ASISTENCIA = `
  FROM asistencia a
  JOIN matricula m ON m.id_matricula = a.id_matricula
  JOIN alumno al ON al.rut = m.rut_alumno
  JOIN curso c ON c.id_curso = m.id_curso
  WHERE m.anio = (SELECT MAX(anio) FROM matricula)`;

// Por curso y mes: alumnos con registro ese mes y el estado de cada día
function datosMensuales(db, { curso, desde, hasta }) {
  const filas = db.prepare(`
    SELECT al.rut, al.apellidos, al.nombres, c.nombre AS curso, a.fecha, a.estado
    ${BASE_ASISTENCIA}
      AND (@curso IS NULL OR c.nombre = @curso)
      AND (@desde IS NULL OR a.fecha >= @desde)
      AND (@hasta IS NULL OR a.fecha <= @hasta)
    ORDER BY c.nombre, a.fecha
  `).all({ curso: curso || null, desde: desde || null, hasta: hasta || null });
  if (!filas.length) throw new ErrorRegistro(404, 'No hay asistencia cargada para ese curso y período.');

  const grupos = new Map();
  for (const f of filas) {
    const clave = `${f.curso}|${f.fecha.slice(0, 7)}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        curso: f.curso, anio: Number(f.fecha.slice(0, 4)), mes: Number(f.fecha.slice(5, 7)), alumnos: new Map(),
      });
    }
    const grupo = grupos.get(clave);
    if (!grupo.alumnos.has(f.rut)) {
      grupo.alumnos.set(f.rut, { rut: f.rut, nombre: `${f.apellidos}, ${f.nombres}`.toUpperCase(), dias: new Map() });
    }
    grupo.alumnos.get(f.rut).dias.set(Number(f.fecha.slice(8, 10)), f.estado);
  }
  const fechas = filas.map((f) => f.fecha);
  return {
    grupos: [...grupos.values()].map((g) => ({
      ...g,
      alumnos: [...g.alumnos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    })),
    rango: { desde: desde || fechas[0], hasta: hasta || fechas.at(-1) },
  };
}

// % anual de cada alumno del curso: desde el 1 de enero hasta el fin del mes del reporte
function porcentajesAnuales(db, curso, anio, mes) {
  const filas = db.prepare(`
    SELECT al.rut, COUNT(*) AS dias, SUM(a.estado = 'P') AS presentes
    ${BASE_ASISTENCIA}
      AND c.nombre = ? AND a.fecha BETWEEN ? AND ?
    GROUP BY al.rut
  `).all(curso, `${anio}-01-01`, `${anio}-${dos(mes)}-${dos(diasDelMes(anio, mes))}`);
  return new Map(filas.map((f) => [f.rut, f.dias ? (f.presentes / f.dias) * 100 : null]));
}

async function excelMes(grupo, anual) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(PLANTILLA);
  const hoja = wb.worksheets[0];
  const { anio, mes, alumnos } = grupo;
  const largo = nombreCursoLargo(grupo.curso);
  const totalDias = diasDelMes(anio, mes);

  hoja.getCell('A1').value = `Asistencia mensual ( ${largo} - ${MESES[mes - 1]}  ${anio})`;
  hoja.getCell('A2').value = marcaDeTiempo(new Date());
  for (let dia = 1; dia <= Math.min(totalDias, DIAS_COLUMNAS); dia += 1) {
    hoja.getRow(FILA_LETRAS).getCell(COL_PRIMER_DIA + dia - 1).value = letraDelDia(anio, mes, dia);
    hoja.getRow(FILA_NUMEROS).getCell(COL_PRIMER_DIA + dia - 1).value = dia;
  }

  // El formato de la fila modelo (5) se copia a cada alumno. Se copia el objeto: en exceljs
  // los estilos pueden estar compartidos y cambiar uno alteraría otros.
  const modelo = Array.from({ length: COLUMNAS }, (_, i) => hoja.getRow(FILA_PRIMER_ALUMNO).getCell(i + 1).style);
  const darFormato = (fila) => {
    for (let col = 1; col <= COLUMNAS; col += 1) fila.getCell(col).style = { ...modelo[col - 1] };
  };

  const porDia = new Map(); // dia → { presentes, ausentes }
  const resumenes = alumnos.map((alumno, i) => {
    const fila = hoja.getRow(FILA_PRIMER_ALUMNO + i);
    darFormato(fila);
    fila.getCell(1).value = i + 1;
    fila.getCell(2).value = alumno.nombre;
    let presentes = 0;
    let ausentes = 0;
    for (const [dia, estado] of alumno.dias) {
      fila.getCell(COL_PRIMER_DIA + dia - 1).value = MARCA[estado];
      const totales = porDia.get(dia) || { presentes: 0, ausentes: 0 };
      if (estado === 'P') { presentes += 1; totales.presentes += 1; } else { ausentes += 1; totales.ausentes += 1; }
      porDia.set(dia, totales);
    }
    const pctMes = presentes + ausentes ? (presentes / (presentes + ausentes)) * 100 : null;
    const pctAnual = anual.get(alumno.rut) ?? null;
    fila.getCell(COL_PRESENTE).value = presentes;
    fila.getCell(COL_AUSENTE).value = ausentes;
    fila.getCell(COL_PCT_MES).value = redondear(pctMes);
    fila.getCell(COL_PCT_ANUAL).value = redondear(pctAnual);
    return { presentes, ausentes, pctMes, pctAnual };
  });

  // Totales por día y promedios finales
  const primera = FILA_PRIMER_ALUMNO + alumnos.length;
  const etiquetas = ['Total Presentes', 'Total Ausentes', 'Matrícula', '% Asistencia', '% Inasistencia', 'Promedios finales'];
  etiquetas.forEach((etiqueta, k) => {
    const n = primera + k;
    const fila = hoja.getRow(n);
    darFormato(fila);
    fila.getCell(1).value = etiqueta;
    fila.getCell(1).font = { bold: true };
    fila.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    hoja.mergeCells(n, 1, n, 2);
  });
  for (const [dia, { presentes, ausentes }] of porDia) {
    const col = COL_PRIMER_DIA + dia - 1;
    const matricula = presentes + ausentes;
    [presentes, ausentes, matricula, redondear((presentes / matricula) * 100), redondear((ausentes / matricula) * 100)]
      .forEach((valor, k) => { hoja.getRow(primera + k).getCell(col).value = valor; });
  }
  const filaPromedios = hoja.getRow(primera + etiquetas.length - 1);
  filaPromedios.getCell(COL_PRESENTE).value = redondear(promedio(resumenes.map((r) => r.presentes)));
  filaPromedios.getCell(COL_AUSENTE).value = redondear(promedio(resumenes.map((r) => r.ausentes)));
  filaPromedios.getCell(COL_PCT_MES).value = redondear(promedio(resumenes.map((r) => r.pctMes)));
  filaPromedios.getCell(COL_PCT_ANUAL).value = redondear(promedio(resumenes.map((r) => r.pctAnual)));

  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    nombreArchivo: `Asistencia_${largo}_Mes_${mes}.xlsx`,
  };
}

// Un Excel por curso y mes; con más de uno, un ZIP
async function exportarAsistenciaMensual(db, { curso, desde, hasta }) {
  const { grupos, rango } = datosMensuales(db, { curso, desde, hasta });
  const archivos = [];
  for (const grupo of grupos) {
    archivos.push(await excelMes(grupo, porcentajesAnuales(db, grupo.curso, grupo.anio, grupo.mes)));
  }
  if (archivos.length === 1) return { ...archivos[0], tipo: MIME_XLSX, advertencias: [] };

  const zip = new JSZip();
  for (const { nombreArchivo, buffer } of archivos) zip.file(nombreArchivo, buffer);
  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    tipo: 'application/zip',
    advertencias: [],
    nombreArchivo: `Asistencia mensual ${curso || 'todos los cursos'} ${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)}.zip`,
  };
}

// ---------- Importar ----------

// 'mensual' (este formato), 'portal' (el Excel que descarga la sincronización) o null
function formatoAsistencia(wb) {
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const a1 = String(hoja?.A1?.v ?? '');
  const a2 = String(hoja?.A2?.v ?? '');
  if (/^\s*Asistencia mensual\s*\(/i.test(a1)) return 'mensual';
  if (/Curso\s+.+·\s*\p{L}+\s+\d{4}/u.test(a2)) return 'portal';
  return null;
}

const anioDeLaApp = (db) => db.prepare('SELECT MAX(anio) AS anio FROM matricula').get().anio;

// Compara lo guardado con lo nuevo (Map fecha → estado) y devuelve los contadores
function contarCambios(antes, despues) {
  const r = { nuevos: 0, cambiados: 0, sinCambios: 0, eliminados: 0 };
  for (const [fecha, estado] of despues) {
    if (!antes.has(fecha)) r.nuevos += 1;
    else if (antes.get(fecha) !== estado) r.cambiados += 1;
    else r.sinCambios += 1;
  }
  for (const fecha of antes.keys()) if (!despues.has(fecha)) r.eliminados += 1;
  return r;
}
const sumar = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + b[k]]));

function importarMensual(db, wb, cursoElegido, { transaccion }) {
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, raw: true });
  const titulo = /Asistencia mensual\s*\(\s*(.+?)\s+-\s+(\p{L}+)\s+(\d{4})\s*\)/u.exec(String(filas[0]?.[0] ?? ''));
  if (!titulo) throw new ErrorRegistro(400, 'No se pudo leer el curso y el mes del título (celda A1).');
  const mes = MESES.indexOf(sinTildes(titulo[2]).toLowerCase()) + 1;
  const anio = Number(titulo[3]);
  if (!mes) throw new ErrorRegistro(400, `Mes desconocido en el título: ${titulo[2]}.`);
  const curso = resolverCurso(db, cursoDesdeNombreLargo(titulo[1]), cursoElegido);
  const anioApp = anioDeLaApp(db);
  if (anioApp && anio !== anioApp) {
    throw new ErrorRegistro(400, `El archivo es de ${anio}, pero la app tiene cargado el año ${anioApp}.`);
  }

  // Encabezado: la fila con "Presente"; la siguiente trae el número de cada día
  const iHead = filas.findIndex((f) => f?.includes('Presente'));
  if (iHead < 0) throw new ErrorRegistro(400, 'No se encontró el encabezado (columna "Presente").');
  const head = filas[iHead];
  const numeros = filas[iHead + 1] || [];
  const colPresente = head.indexOf('Presente');
  const colAusente = head.indexOf('Ausente');
  const totalDias = diasDelMes(anio, mes);
  const dias = [];
  for (let col = 2; col < colPresente; col += 1) {
    const dia = Number(numeros[col]);
    if (Number.isInteger(dia) && dia >= 1 && dia <= totalDias) dias.push({ col, dia });
  }
  if (!dias.length) throw new ErrorRegistro(400, 'No se encontraron las columnas de los días (fila con los números del 1 al 31).');

  const buscar = buscadorDeAlumnos(alumnosDelCurso(db, curso));
  const resumen = { noEncontrados: [], filasInvalidas: [] };
  const leidos = [];
  for (let i = iHead + 2; i < filas.length; i += 1) {
    const f = filas[i];
    if (!f || /^total/i.test(String(f[0] ?? '').trim())) break;
    const nombre = String(f[1] ?? '').trim();
    if (!nombre) continue;
    const registros = new Map();
    let invalida = null;
    for (const { col, dia } of dias) {
      const marca = String(f[col] ?? '').replace(/[​-‍﻿]/g, '').trim();
      if (!marca) continue;
      const estado = ESTADO_DE_MARCA[marca];
      if (!estado) { invalida = `${nombre}: marca desconocida "${marca}" el día ${dia}.`; break; }
      registros.set(`${anio}-${dos(mes)}-${dos(dia)}`, estado);
    }
    if (invalida) { resumen.filasInvalidas.push(invalida); continue; }
    // Control: las marcas deben cuadrar con los totales del propio reporte
    const presentes = [...registros.values()].filter((e) => e === 'P').length;
    const ausentes = registros.size - presentes;
    const pReporte = f[colPresente];
    const aReporte = f[colAusente];
    if ((typeof pReporte === 'number' && pReporte !== presentes) || (typeof aReporte === 'number' && aReporte !== ausentes)) {
      resumen.filasInvalidas.push(`${nombre}: las marcas (${presentes} presentes, ${ausentes} ausentes) no cuadran con los totales del archivo (${pReporte}/${aReporte}).`);
      continue;
    }
    const alumno = buscar(nombre);
    if (!alumno) { resumen.noEncontrados.push(nombre); continue; }
    leidos.push({ alumno, registros });
  }

  const desde = `${anio}-${dos(mes)}-01`;
  const hasta = `${anio}-${dos(mes)}-${dos(totalDias)}`;
  const actuales = db.prepare('SELECT fecha, estado FROM asistencia WHERE id_matricula = ? AND fecha BETWEEN ? AND ?');
  const borrar = db.prepare('DELETE FROM asistencia WHERE id_matricula = ? AND fecha BETWEEN ? AND ?');
  const insertar = db.prepare('INSERT INTO asistencia (id_matricula, fecha, estado) VALUES (?, ?, ?)');
  let cambios = { nuevos: 0, cambiados: 0, sinCambios: 0, eliminados: 0 };
  let registros = 0;
  transaccion(db, () => {
    // El archivo manda: la asistencia del mes de cada alumno encontrado se reemplaza por la del archivo
    for (const { alumno, registros: nuevos } of leidos) {
      const antes = new Map(actuales.all(alumno.id_matricula, desde, hasta).map((r) => [r.fecha, r.estado]));
      cambios = sumar(cambios, contarCambios(antes, nuevos));
      borrar.run(alumno.id_matricula, desde, hasta);
      for (const [fecha, estado] of nuevos) insertar.run(alumno.id_matricula, fecha, estado);
      registros += nuevos.size;
    }
  });

  return {
    tipo: 'asistencia', curso, periodo: `${MESES[mes - 1]} ${anio}`,
    alumnos: leidos.length, registros, ...cambios, ...resumen,
  };
}

function importarPortal(db, buffer, cursoElegido, { transaccion }) {
  let data;
  try {
    data = parsearAsistencia(buffer);
  } catch (error) {
    throw new ErrorRegistro(400, `No se pudo leer el archivo de asistencia: ${error.message}`);
  }
  if (cursoElegido && claveCurso(data.curso) !== claveCurso(cursoElegido)) {
    throw new ErrorRegistro(409, `El archivo es del curso ${data.curso}, pero elegiste ${cursoElegido}.`, { cursoArchivo: data.curso });
  }
  const desde = `${data.anio}-${dos(data.mes)}-01`;
  const hasta = `${data.anio}-${dos(data.mes)}-${dos(diasDelMes(data.anio, data.mes))}`;
  const actuales = db.prepare(`
    SELECT m.rut_alumno AS rut, a.fecha, a.estado
    FROM asistencia a
    JOIN matricula m ON m.id_matricula = a.id_matricula
    JOIN curso c ON c.id_curso = m.id_curso
    WHERE c.nombre = ? AND m.anio = ? AND a.fecha BETWEEN ? AND ?
  `).all(data.curso, data.anio, desde, hasta);
  const antes = new Map(actuales.map((r) => [`${r.rut}|${r.fecha}`, r.estado]));
  const despues = new Map(data.alumnos.flatMap((al) => al.registros.map((r) => [`${al.rut}|${r.fecha}`, r.estado])));
  // guardar() reemplaza el curso completo en ese mes (el reporte es la fuente completa)
  const registros = transaccion(db, () => guardar(db, data, { transaccionar: false }));
  return {
    tipo: 'asistencia', curso: data.curso, periodo: `${MESES[data.mes - 1]} ${data.anio}`,
    alumnos: data.alumnos.length, registros, ...contarCambios(antes, despues),
    noEncontrados: [], filasInvalidas: [],
  };
}

// Importa un Excel de asistencia (formato mensual o el del portal). `wb` ya leído con XLSX.
function importarAsistencia(db, wb, buffer, cursoElegido, opciones) {
  const formato = formatoAsistencia(wb);
  if (formato === 'mensual') return importarMensual(db, wb, cursoElegido, opciones);
  if (formato === 'portal') return importarPortal(db, buffer, cursoElegido, opciones);
  return null;
}

module.exports = {
  exportarAsistenciaMensual, importarAsistencia, formatoAsistencia, nombreCursoLargo, cursoDesdeNombreLargo,
};
