// Respaldo de la información que solo existe en esta app: la gestión de alertas
// (estado + nota) y los justificativos aprobados. La asistencia y los atrasos NO se
// respaldan: se borran al cerrar a propósito y se vuelven a sincronizar desde el portal.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db/ruta');
const { transaccion, normalizarRut } = require('./asistencia');
const { TIPOS_ALERTA, ESTADOS_GESTION } = require('./alertas');

const VERSION = 1;
const DIR_AUTOMATICOS = path.join(DATA_DIR, 'respaldos');
const MAX_AUTOMATICOS = 7;
const ARCHIVO_AUTOMATICO = /^respaldo-\d{4}-\d{2}-\d{2}\.json$/;
const CLAVE_ALERTA = new RegExp(`^([0-9kK.-]{3,15}):(${TIPOS_ALERTA.join('|')})(?::[0-9]{1,4})?$`);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const APLICA_A = ['inasistencia', 'atraso'];

class ErrorRespaldo extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.status = 400;
  }
}

function fechaLocal(fecha = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
}

function leerDatos(db) {
  const alertaGestion = db.prepare(`
    SELECT clave, rut, estado, nota, actualizado_en, usuario
    FROM alerta_gestion ORDER BY clave
  `).all();
  const justificativos = db.prepare(`
    SELECT j.rut_alumno AS rut, a.nombres, a.apellidos, j.tipo_documento, j.fecha_inicio, j.fecha_fin,
           j.estado_documento, j.aplica_a, j.observacion, j.creado_en, j.duracion_ms
    FROM justificativo j
    JOIN alumno a ON a.rut = j.rut_alumno
    WHERE j.estado_documento = 'APROBADO'
    ORDER BY j.rut_alumno, j.fecha_inicio, j.id_justificativo
  `).all();
  return { alerta_gestion: alertaGestion, justificativos };
}

function generarRespaldo(db) {
  return {
    app: 'inspectoria',
    tipo: 'respaldo',
    version: VERSION,
    creado_en: new Date().toISOString(),
    ...leerDatos(db),
  };
}

const esTexto = (valor, max) => typeof valor === 'string' && valor.length <= max;
const esTextoOpcional = (valor, max) => valor === null || valor === undefined || esTexto(valor, max);

function validarAlerta(fila, i) {
  const error = (detalle) => new ErrorRespaldo(`La nota ${i + 1} del respaldo no es válida (${detalle}).`);
  if (!fila || typeof fila !== 'object') throw error('formato');
  const coincidencia = esTexto(fila.clave, 60) && CLAVE_ALERTA.exec(fila.clave);
  if (!coincidencia) throw error('clave');
  if (!ESTADOS_GESTION.includes(fila.estado)) throw error('estado');
  if (!esTextoOpcional(fila.nota, 500)) throw error('la nota supera los 500 caracteres');
  if (!esTexto(fila.actualizado_en, 40) || Number.isNaN(Date.parse(fila.actualizado_en))) throw error('fecha');
  if (!esTextoOpcional(fila.usuario, 100)) throw error('usuario');
  return {
    clave: fila.clave,
    rut: coincidencia[1],
    estado: fila.estado,
    nota: fila.nota?.trim() || null,
    actualizado_en: fila.actualizado_en,
    usuario: fila.usuario || null,
  };
}

function validarJustificativo(fila, i) {
  const error = (detalle) => new ErrorRespaldo(`El justificativo ${i + 1} del respaldo no es válido (${detalle}).`);
  if (!fila || typeof fila !== 'object') throw error('formato');
  if (!esTexto(fila.rut, 15) || !/^[0-9kK.-]{3,15}$/.test(fila.rut)) throw error('RUT');
  if (!esTexto(fila.nombres, 200) || !esTexto(fila.apellidos, 200)) throw error('nombre del alumno');
  if (!esTexto(fila.tipo_documento, 100) || !fila.tipo_documento.trim()) throw error('tipo');
  if (!FECHA.test(fila.fecha_inicio) || !FECHA.test(fila.fecha_fin) || fila.fecha_fin < fila.fecha_inicio) {
    throw error('fechas');
  }
  if (fila.estado_documento !== 'APROBADO') throw error('estado');
  if (fila.aplica_a !== null && fila.aplica_a !== undefined && !APLICA_A.includes(fila.aplica_a)) throw error('aplica a');
  if (!esTextoOpcional(fila.observacion, 1000) || !esTextoOpcional(fila.creado_en, 40)) throw error('observación');
  if (fila.duracion_ms !== null && fila.duracion_ms !== undefined
    && (!Number.isSafeInteger(fila.duracion_ms) || fila.duracion_ms < 0)) throw error('duración');
  return {
    rut: normalizarRut(fila.rut),
    nombres: fila.nombres.trim(),
    apellidos: fila.apellidos.trim(),
    tipo_documento: fila.tipo_documento.trim(),
    fecha_inicio: fila.fecha_inicio,
    fecha_fin: fila.fecha_fin,
    aplica_a: fila.aplica_a ?? null,
    observacion: fila.observacion ?? null,
    creado_en: fila.creado_en ?? null,
    duracion_ms: fila.duracion_ms ?? null,
  };
}

// Valida todo el archivo antes de escribir: si una fila está mal, no se restaura nada
function validarRespaldo(datos) {
  if (!datos || typeof datos !== 'object' || datos.app !== 'inspectoria' || datos.tipo !== 'respaldo') {
    throw new ErrorRespaldo('El archivo no es un respaldo de este sistema.');
  }
  if (datos.version !== VERSION) {
    throw new ErrorRespaldo('La versión del respaldo no es compatible con esta versión del sistema.');
  }
  const alertas = datos.alerta_gestion ?? [];
  const justificativos = datos.justificativos ?? [];
  if (!Array.isArray(alertas) || !Array.isArray(justificativos)) {
    throw new ErrorRespaldo('El respaldo está incompleto o dañado.');
  }
  return {
    alertas: alertas.map(validarAlerta),
    justificativos: justificativos.map(validarJustificativo),
  };
}

// Combina el respaldo con lo que ya hay: nunca pisa una nota más reciente ni un
// justificativo que ya cubra esas fechas.
function restaurarRespaldo(db, datos) {
  const { alertas, justificativos } = validarRespaldo(datos);
  const resumen = {
    alertas: { nuevas: 0, actualizadas: 0, omitidas: 0 },
    justificativos: { nuevos: 0, omitidos: 0 },
  };

  const getAlerta = db.prepare('SELECT actualizado_en FROM alerta_gestion WHERE clave = ?');
  const upAlerta = db.prepare(`
    INSERT INTO alerta_gestion (clave, rut, estado, nota, actualizado_en, usuario)
    VALUES (@clave, @rut, @estado, @nota, @actualizado_en, @usuario)
    ON CONFLICT(clave) DO UPDATE SET estado = excluded.estado, nota = excluded.nota,
      actualizado_en = excluded.actualizado_en, usuario = excluded.usuario
  `);
  const upAlumno = db.prepare(`
    INSERT INTO alumno (rut, nombres, apellidos) VALUES (@rut, @nombres, @apellidos)
    ON CONFLICT(rut) DO NOTHING
  `);
  // Ya cubierto: otro justificativo aprobado del alumno que se cruza en fechas y tipo de falta
  const yaCubierto = db.prepare(`
    SELECT 1 FROM justificativo
    WHERE rut_alumno = @rut AND estado_documento = 'APROBADO'
      AND fecha_inicio <= @fecha_fin AND @fecha_inicio <= fecha_fin
      AND (aplica_a IS NULL OR @aplica_a IS NULL OR aplica_a = @aplica_a)
    LIMIT 1
  `);
  const insJustificativo = db.prepare(`
    INSERT INTO justificativo
      (rut_alumno, tipo_documento, fecha_inicio, fecha_fin, estado_documento,
       duracion_ms, creado_en, aplica_a, observacion)
    VALUES (@rut, @tipo_documento, @fecha_inicio, @fecha_fin, 'APROBADO',
       @duracion_ms, @creado_en, @aplica_a, @observacion)
  `);

  transaccion(db, () => {
    for (const alerta of alertas) {
      const actual = getAlerta.get(alerta.clave);
      if (actual && Date.parse(actual.actualizado_en) >= Date.parse(alerta.actualizado_en)) {
        resumen.alertas.omitidas += 1;
        continue;
      }
      upAlerta.run(alerta);
      resumen.alertas[actual ? 'actualizadas' : 'nuevas'] += 1;
    }
    for (const justificativo of justificativos) {
      upAlumno.run(justificativo);
      if (yaCubierto.get(justificativo)) {
        resumen.justificativos.omitidos += 1;
        continue;
      }
      insJustificativo.run(justificativo);
      resumen.justificativos.nuevos += 1;
    }
  });
  return resumen;
}

// ---- Respaldos automáticos (DATA_DIR/respaldos) ----

function listarAutomaticos() {
  if (!fs.existsSync(DIR_AUTOMATICOS)) return [];
  return fs.readdirSync(DIR_AUTOMATICOS)
    .filter((nombre) => ARCHIVO_AUTOMATICO.test(nombre))
    .sort()
    .reverse()
    .map((nombre) => {
      const { size, mtime } = fs.statSync(path.join(DIR_AUTOMATICOS, nombre));
      return { nombre, fecha: nombre.slice(9, 19), bytes: size, modificado: mtime.toISOString() };
    });
}

function rutaAutomatico(nombre) {
  if (typeof nombre !== 'string' || !ARCHIVO_AUTOMATICO.test(nombre)) return null;
  const ruta = path.join(DIR_AUTOMATICOS, nombre);
  return fs.existsSync(ruta) ? ruta : null;
}

function escribirSeguro(ruta, contenido) {
  const temporal = `${ruta}.tmp`;
  fs.writeFileSync(temporal, contenido, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporal, ruta); // así un corte a mitad de escritura no deja un archivo dañado
}

/**
 * Guarda el respaldo de hoy si los datos cambiaron desde el último y deja solo los
 * últimos MAX_AUTOMATICOS. Con { soloSiFaltaHoy: true } no hace nada si ya hay uno de hoy.
 * Devuelve el nombre del archivo escrito o null.
 */
function respaldoAutomatico(db, { soloSiFaltaHoy = false } = {}) {
  fs.mkdirSync(DIR_AUTOMATICOS, { recursive: true, mode: 0o700 });
  const nombre = `respaldo-${fechaLocal()}.json`;
  const ruta = path.join(DIR_AUTOMATICOS, nombre);
  if (soloSiFaltaHoy && fs.existsSync(ruta)) return null;

  const datos = leerDatos(db);
  const vacio = !datos.alerta_gestion.length && !datos.justificativos.length;
  const ultimo = listarAutomaticos()[0];
  if (ultimo) {
    try {
      const anterior = JSON.parse(fs.readFileSync(path.join(DIR_AUTOMATICOS, ultimo.nombre), 'utf8'));
      const igual = JSON.stringify(datos.alerta_gestion) === JSON.stringify(anterior.alerta_gestion)
        && JSON.stringify(datos.justificativos) === JSON.stringify(anterior.justificativos);
      if (igual) return null;
    } catch {
      // respaldo anterior ilegible: se escribe uno nuevo
    }
  } else if (vacio) {
    return null; // nada que respaldar todavía
  }

  escribirSeguro(ruta, JSON.stringify({ ...generarRespaldo(db), ...datos }, null, 2));
  for (const viejo of listarAutomaticos().slice(MAX_AUTOMATICOS)) {
    fs.rmSync(path.join(DIR_AUTOMATICOS, viejo.nombre), { force: true });
  }
  return nombre;
}

module.exports = {
  generarRespaldo,
  restaurarRespaldo,
  respaldoAutomatico,
  listarAutomaticos,
  rutaAutomatico,
  fechaLocal,
  ErrorRespaldo,
};
