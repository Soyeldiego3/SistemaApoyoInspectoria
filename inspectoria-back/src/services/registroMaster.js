// Importar y exportar el "Master de registro inasistencia justificadas" (un Excel por curso).
//
// Formato (ver plantillas/master-inasistencias.xlsx):
//   MASTER  D1 = días trabajados, E1 = "Registrado al …", B2 = "Nombre Alumnos <curso>",
//           filas 4..43 = alumnos (A = Nº, B = "APELLIDOS, NOMBRES"; C..L son fórmulas).
//   HojaN   una por alumno (N = Nº). A1 = =MASTER!B{N+3}. Filas 3..152: B = fecha,
//           C = código 1..6, D = fórmula con el texto, O = observación.
// Solo inasistencias: los atrasos no forman parte de este formato.
const path = require('path');
// exceljs se carga recién al usarlo (es pesado y alarga el arranque del backend)
const ExcelJS = { get Workbook() { return require('exceljs').Workbook; } };
const XLSX = require('xlsx');
const {
  CODIGOS, sinTildes, codigoDeTipo, sqlUltimoTipo, recortarSuperpuestos,
} = require('./justificativos');

const PLANTILLA = path.join(__dirname, '..', '..', 'plantillas', 'master-inasistencias.xlsx');
const FILA_PRIMER_ALUMNO = 4;
const ALUMNOS_PLANTILLA = 40;
const FILA_PRIMER_REGISTRO = 3;
const MAX_REGISTROS = 150;
// Fecha corta como en el registro original ("18-nov"). En la plantilla solo algunas celdas
// traen este formato (el resto es General), por eso se aplica a toda la columna.
const FORMATO_FECHA = 'd-mmm';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };

class ErrorRegistro extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    Object.assign(this, extra);
  }
}

// ---------- Cursos: "2°M A" ↔ "2 medio A", "7°A" ↔ "7 basico A" ----------
function cursoLegible(curso) {
  const medio = /^(\d+)\s*[°º]\s*M\s*([A-Z])$/i.exec(curso);
  if (medio) return `${medio[1]} medio ${medio[2].toUpperCase()}`;
  const basico = /^(\d+)\s*[°º]\s*([A-Z])$/i.exec(curso);
  if (basico) return `${basico[1]} basico ${basico[2].toUpperCase()}`;
  return curso;
}

const claveCurso = (c) => sinTildes(c).replace(/[\s°º]/g, '');

// Busca "2 medio A" / "7 básico B" dentro de un texto y lo pasa al formato de la app
function cursoDesdeTexto(texto) {
  const t = sinTildes(texto || '');
  const medio = /(\d+)\s*[°º]?\s*MEDIO\s*([A-Z])\b/.exec(t);
  if (medio) return `${medio[1]}°M ${medio[2]}`;
  const basico = /(\d+)\s*[°º]?\s*BASICO\s*([A-Z])\b/.exec(t);
  if (basico) return `${basico[1]}°${basico[2]}`;
  return null;
}

// ---------- Nombres ----------
const claveNombre = (n) => sinTildes(n).replace(/\s+/g, ' ').replace(/\s*,\s*/, ', ');

function buscadorDeAlumnos(alumnos) {
  const exacto = new Map(alumnos.map((a) => [claveNombre(`${a.apellidos}, ${a.nombres}`), a]));
  return (nombre) => {
    const clave = claveNombre(nombre);
    if (exacto.has(clave)) return exacto.get(clave);
    // Respaldo: mismos apellidos y mismo primer nombre, si hay uno solo
    const [apellidos, nombres = ''] = clave.split(', ');
    const primerNombre = nombres.split(' ')[0];
    const candidatos = alumnos.filter((a) => claveNombre(a.apellidos) === apellidos
      && claveNombre(a.nombres).split(' ')[0] === primerNombre);
    return candidatos.length === 1 ? candidatos[0] : null;
  };
}

function alumnosDelCurso(db, curso) {
  return db.prepare(`
    SELECT a.rut, a.nombres, a.apellidos, m.id_matricula
    FROM alumno a
    JOIN matricula m ON m.rut_alumno = a.rut
    JOIN curso c ON c.id_curso = m.id_curso
    WHERE c.nombre = ? AND m.anio = (SELECT MAX(anio) FROM matricula)
    ORDER BY a.apellidos, a.nombres
  `).all(curso);
}

// ---------- Exportar ----------
// Texto que produce la fórmula de la columna D para un código (con los acentos del Excel)
function textosDeFormula(formula) {
  const mapa = {};
  for (const [, cod, texto] of String(formula).matchAll(/C\d+=(\d),"([^"]+)"/g)) mapa[cod] = texto;
  return mapa;
}

// Desplaza las referencias de fila de una fórmula de MASTER (fila 43 → fila nueva)
function desplazarFormula(formula, delta, hoja) {
  return formula
    .replace(/Hoja\d+!/g, `${hoja}!`)
    .replace(/(^|[^!A-Za-z])([A-L])(\d+)/g, (m, pre, col, fila) => (
      fila === '1' ? m : `${pre}${col}${Number(fila) + delta}`));
}

function agregarAlumnoExtra(wb, master, n) {
  const filaBase = FILA_PRIMER_ALUMNO + ALUMNOS_PLANTILLA - 1; // 43
  const filaNueva = FILA_PRIMER_ALUMNO + n - 1;
  const base = master.getRow(filaBase);
  const nueva = master.getRow(filaNueva);
  nueva.height = base.height;
  base.eachCell({ includeEmpty: true }, (celda, col) => {
    const destino = nueva.getCell(col);
    destino.style = { ...celda.style };
    // celda.formula entrega el texto también en fórmulas compartidas (sharedFormula)
    if (celda.formulaType && celda.formula) {
      destino.value = { formula: desplazarFormula(celda.formula, filaNueva - filaBase, `Hoja${n}`) };
    } else if (col === 1) destino.value = n;
  });
  // Copia la hoja del último alumno de la plantilla
  const origen = wb.getWorksheet(`Hoja${ALUMNOS_PLANTILLA}`);
  const hoja = wb.addWorksheet(`Hoja${n}`);
  hoja.model = { ...origen.model, mergeCells: origen.model.merges, name: `Hoja${n}`, id: hoja.id };
  hoja.getCell('A1').value = { formula: `MASTER!B${filaNueva}` };
  return hoja;
}

async function exportarMaster(db, curso) {
  const alumnos = alumnosDelCurso(db, curso);
  if (!alumnos.length) throw new ErrorRegistro(404, `No hay alumnos cargados para el curso ${curso}.`);

  const dias = db.prepare(`
    SELECT COUNT(DISTINCT s.fecha) AS total, MAX(s.fecha) AS ultima
    FROM asistencia s
    JOIN matricula m ON m.id_matricula = s.id_matricula
    JOIN curso c ON c.id_curso = m.id_curso
    WHERE c.nombre = ? AND m.anio = (SELECT MAX(anio) FROM matricula)
  `).get(curso);

  const consultaInasistencias = db.prepare(`
    SELECT s.fecha,
      ${sqlUltimoTipo('@rut', 's.fecha', 'inasistencia')} AS tipo,
      ${sqlUltimoTipo('@rut', 's.fecha', 'inasistencia', 'observacion')} AS observacion
    FROM asistencia s
    WHERE s.id_matricula = @id_matricula AND s.estado IN ('A', 'F')
    ORDER BY s.fecha
  `);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(PLANTILLA);
  const master = wb.getWorksheet('MASTER');
  const legible = cursoLegible(curso);
  const advertencias = [];

  master.getCell('D1').value = dias.total || 0;
  if (dias.ultima) {
    const [, mm, dd] = dias.ultima.split('-').map(Number);
    master.getCell('E1').value = `Registrado al ${dd} de ${MESES[mm - 1]}`;
  }
  const b2 = master.getCell('B2');
  if (b2.value?.richText?.length > 1) {
    b2.value = { richText: b2.value.richText.map((r, i) => (i === 1 ? { ...r, text: legible } : r)) };
  } else {
    b2.value = `Nombre Alumnos  ${legible}`;
  }

  alumnos.forEach((alumno, i) => {
    const n = i + 1;
    const nombre = `${alumno.apellidos}, ${alumno.nombres}`.toUpperCase();
    const hoja = n > ALUMNOS_PLANTILLA ? agregarAlumnoExtra(wb, master, n) : wb.getWorksheet(`Hoja${n}`);
    master.getCell(`B${FILA_PRIMER_ALUMNO + n - 1}`).value = nombre;
    hoja.getCell('A1').value = { formula: `MASTER!B${FILA_PRIMER_ALUMNO + n - 1}`, result: nombre };

    let registros = consultaInasistencias.all({ rut: alumno.rut, id_matricula: alumno.id_matricula });
    if (registros.length > MAX_REGISTROS) {
      advertencias.push(`${nombre}: tiene ${registros.length} inasistencias; el formato admite ${MAX_REGISTROS}.`);
      registros = registros.slice(0, MAX_REGISTROS);
    }
    registros.forEach((r, j) => {
      const fila = FILA_PRIMER_REGISTRO + j;
      const [y, m, d] = r.fecha.split('-').map(Number);
      const codigo = codigoDeTipo(r.tipo);
      hoja.getCell(`B${fila}`).value = new Date(Date.UTC(y, m - 1, d));
      hoja.getCell(`C${fila}`).value = codigo;
      if (r.observacion) hoja.getCell(`O${fila}`).value = r.observacion;
      // Resultado en caché de la fórmula D, para visores que no recalculan. Se conserva la
      // estructura (fórmula normal o compartida) y solo se agrega el resultado.
      const celdaD = hoja.getCell(`D${fila}`);
      if (celdaD.formulaType && celdaD.formula) {
        celdaD.value = { ...celdaD.value, result: textosDeFormula(celdaD.formula)[codigo] };
      }
    });
  });

  // Formato de fecha corta en toda la columna B de cada hoja de alumno (también filas vacías,
  // para lo que se escriba a mano después). Se copia el estilo: en exceljs puede estar
  // compartido entre celdas y cambiarlo en una alteraría otras.
  // La letra, el relleno y la alineación también se igualan a los de la primera fila (en el
  // original cada fila quedó con un formato distinto); los bordes de cada fila se respetan.
  for (const hoja of wb.worksheets) {
    if (hoja.name === 'MASTER') continue;
    const modelo = hoja.getCell(`B${FILA_PRIMER_REGISTRO}`).style;
    for (let fila = FILA_PRIMER_REGISTRO; fila < FILA_PRIMER_REGISTRO + MAX_REGISTROS; fila += 1) {
      const celdaB = hoja.getCell(`B${fila}`);
      celdaB.style = {
        ...celdaB.style,
        font: modelo.font,
        fill: modelo.fill,
        alignment: modelo.alignment,
        numFmt: FORMATO_FECHA,
      };
    }
  }

  wb.calcProperties.fullCalcOnLoad = true;
  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    nombreArchivo: `Master de registro inasistencia justificadas ${legible}.xlsx`,
    advertencias,
  };
}

// ---------- Importar ----------
const valor = (hoja, ref) => hoja?.[ref]?.v;

// Lee la columna B: fecha de Excel, texto, o solo el día (hereda mes/año de la fila anterior)
function leerFecha(v, anterior, anioPorDefecto) {
  const armar = (y, m, d) => {
    const f = new Date(Date.UTC(y, m - 1, d));
    if (f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
    return { y, m, d };
  };
  if (typeof v === 'number') {
    if (v >= 1 && v <= 31 && Number.isInteger(v)) {
      if (!anterior) return null;
      // Si el día es menor al anterior, se asume el mes siguiente
      let { y, m } = anterior;
      if (v < anterior.d) { m += 1; if (m > 12) { m = 1; y += 1; } }
      return armar(y, m, v);
    }
    const p = XLSX.SSF.parse_date_code(v);
    return p ? armar(p.y, p.m, p.d) : null;
  }
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (r) return armar(+r[1], +r[2], +r[3]);
    r = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t);
    if (r) return armar(r[3].length === 2 ? 2000 + +r[3] : +r[3], +r[2], +r[1]);
    r = /^(\d{1,2})[\s/-]*([a-zñ]{3})/.exec(t);
    if (r && MESES_CORTOS[r[2]]) return armar(anterior?.y ?? anioPorDefecto, MESES_CORTOS[r[2]], +r[1]);
  }
  return null;
}

function importarMaster(db, cursoElegido, buffer, { transaccion }) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new ErrorRegistro(400, 'No se pudo leer el archivo. Debe ser un Excel (.xlsx).');
  }
  const master = wb.Sheets.MASTER;
  if (!master) {
    throw new ErrorRegistro(400, 'Este archivo no es un Master de registro de inasistencias justificadas (no tiene la hoja MASTER).');
  }

  const cursoArchivo = cursoDesdeTexto(String(valor(master, 'B2') ?? ''));
  if (!cursoElegido) {
    // Sin curso elegido se usa el del archivo, con el nombre tal como está en la app
    const enApp = cursoArchivo && db.prepare('SELECT nombre FROM curso').all()
      .map((c) => c.nombre).find((n) => claveCurso(n) === claveCurso(cursoArchivo));
    if (!enApp) {
      throw new ErrorRegistro(400, cursoArchivo
        ? `El archivo es del curso ${cursoArchivo}, que no está cargado en la app. Sincroniza primero.`
        : 'No se pudo detectar el curso del archivo (celda B2 de la hoja MASTER).');
    }
    cursoElegido = enApp;
  } else if (cursoArchivo && claveCurso(cursoArchivo) !== claveCurso(cursoElegido)) {
    throw new ErrorRegistro(409, `El archivo parece ser del curso ${cursoArchivo}, pero elegiste ${cursoElegido}.`,
      { cursoArchivo });
  }

  const alumnos = alumnosDelCurso(db, cursoElegido);
  if (!alumnos.length) throw new ErrorRegistro(404, `No hay alumnos cargados para el curso ${cursoElegido}. Sincroniza primero.`);
  const buscar = buscadorDeAlumnos(alumnos);

  const anioPorDefecto = db.prepare('SELECT MAX(anio) AS anio FROM matricula').get().anio || new Date().getFullYear();
  const tipoActual = db.prepare(`
    SELECT ${sqlUltimoTipo('@rut', '@fecha', 'inasistencia')} AS tipo,
           ${sqlUltimoTipo('@rut', '@fecha', 'inasistencia', 'observacion')} AS observacion
  `);
  const esInasistencia = db.prepare(`
    SELECT 1 FROM asistencia WHERE id_matricula = ? AND fecha = ? AND estado IN ('A', 'F')
  `);
  const insertar = db.prepare(`
    INSERT INTO justificativo
      (rut_alumno, tipo_documento, fecha_inicio, fecha_fin, estado_documento, duracion_ms, creado_en, aplica_a, observacion)
    VALUES (?, ?, ?, ?, 'APROBADO', NULL, ?, 'inasistencia', ?)
  `);
  const porId = db.prepare('SELECT * FROM justificativo WHERE id_justificativo = ?');

  const resumen = {
    alumnos: 0, registros: 0, nuevos: 0, cambiados: 0, sinCambios: 0, fueraDeDatos: 0,
    noEncontrados: [], filasInvalidas: [],
  };
  const ahora = new Date().toISOString();

  transaccion(db, () => {
    for (const nombreHoja of wb.SheetNames) {
      if (nombreHoja === 'MASTER') continue;
      const hoja = wb.Sheets[nombreHoja];
      // Nombre del alumno: valor de A1, o la celda de MASTER a la que apunta su fórmula
      let nombre = valor(hoja, 'A1');
      const ref = /MASTER!\$?B\$?(\d+)/i.exec(hoja.A1?.f || '');
      if (!nombre && ref) nombre = valor(master, `B${ref[1]}`);
      nombre = typeof nombre === 'string' ? nombre.trim() : '';

      const filas = [];
      for (let fila = FILA_PRIMER_REGISTRO; fila < FILA_PRIMER_REGISTRO + MAX_REGISTROS; fila += 1) {
        const b = valor(hoja, `B${fila}`);
        const c = valor(hoja, `C${fila}`);
        const o = valor(hoja, `O${fila}`);
        if ((b === undefined || b === '') && (c === undefined || c === '')) continue;
        filas.push({ fila, b, c, o });
      }
      if (!filas.length) continue;
      if (!nombre) {
        resumen.filasInvalidas.push(`${nombreHoja}: tiene registros pero no tiene nombre de alumno.`);
        continue;
      }
      const alumno = buscar(nombre);
      if (!alumno) { resumen.noEncontrados.push(nombre); continue; }
      resumen.alumnos += 1;

      let anterior = null;
      for (const { fila, b, c, o } of filas) {
        const fecha = leerFecha(b, anterior, anioPorDefecto);
        const codigo = Number(c);
        if (!fecha) { resumen.filasInvalidas.push(`${nombre}, fila ${fila}: fecha no válida (${b ?? 'vacía'}).`); continue; }
        anterior = fecha;
        if (!CODIGOS[codigo]) { resumen.filasInvalidas.push(`${nombre}, fila ${fila}: código no válido (${c ?? 'vacío'}).`); continue; }

        const iso = `${fecha.y}-${String(fecha.m).padStart(2, '0')}-${String(fecha.d).padStart(2, '0')}`;
        const tipo = CODIGOS[codigo];
        const observacion = o === undefined || o === null || String(o).trim() === '' ? null : String(o).trim();
        resumen.registros += 1;
        if (!esInasistencia.get(alumno.id_matricula, iso)) resumen.fueraDeDatos += 1;

        const actual = tipoActual.get({ rut: alumno.rut, fecha: iso });
        // Sin justificativo en la app equivale a código 1: si el Excel dice 1 sin observación, no hay cambio
        const codigoActual = actual.tipo ? codigoDeTipo(actual.tipo) : 1;
        if (codigoActual === codigo && (actual.observacion ?? null) === observacion) {
          resumen.sinCambios += 1;
          continue;
        }
        // El Excel manda: el nuevo registro sobrescribe lo que hubiera ese día
        const { lastInsertRowid } = insertar.run(alumno.rut, tipo, iso, iso, ahora, observacion);
        recortarSuperpuestos(db, porId.get(lastInsertRowid));
        if (actual.tipo) resumen.cambiados += 1; else resumen.nuevos += 1;
      }
    }
  });

  return { curso: cursoElegido, cursoArchivo, ...resumen };
}

module.exports = {
  ErrorRegistro, exportarMaster, importarMaster, cursoLegible, cursoDesdeTexto,
  claveCurso, buscadorDeAlumnos, alumnosDelCurso,
};
