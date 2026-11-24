// Respaldo de la información que solo existe en esta app: la gestión de alertas
// (estado + nota) y los justificativos aprobados. La asistencia y los atrasos NO se
// respaldan: se borran al cerrar a propósito y se vuelven a sincronizar desde el portal.
//
// Los archivos (.inspbak) van comprimidos (gzip) y cifrados (AES-256-GCM, services/cifrado.js):
// - con la "contraseña de respaldo" que define el admin → se pueden restaurar en otro equipo;
// - sin contraseña, con el secreto de este equipo (secret.key) → solo se restauran aquí.
// Con contraseña y una carpeta externa (pendrive) configuradas, cada respaldo automático
// también se copia ahí. Los respaldos v1 (JSON sin cifrar) se siguen pudiendo restaurar.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DATA_DIR } = require('../db/ruta');
const { transaccion, normalizarRut } = require('./asistencia');
const { TIPOS_ALERTA, ESTADOS_GESTION } = require('./alertas');
const { cifrar, descifrar } = require('./cifrado');
const { obtenerSecreto } = require('./secreto');
const configuracion = require('./configuracion');
const auditoriaSistema = require('./auditoria_sistema');

const VERSION = 1; // versión del contenido (alertas + justificativos)
const VERSION_ARCHIVO = 2; // versión del archivo cifrado
const EXTENSION = '.inspbak';
const ETIQUETA_RESPALDO = 'apoyo-inspectoria-respaldo';
const ETIQUETA_CONTRASENA = 'apoyo-inspectoria-clave-respaldo';
const ARCHIVO_CONTRASENA = path.join(DATA_DIR, 'respaldo.clave.json');
const MIN_CONTRASENA = 8;
const DIR_AUTOMATICOS = path.join(DATA_DIR, 'respaldos');
const MAX_AUTOMATICOS = 7;
const ARCHIVO_AUTOMATICO = /^respaldo-\d{4}-\d{2}-\d{2}\.(json|inspbak)$/;
const CLAVE_ALERTA = new RegExp(`^([0-9kK.-]{3,15}):(${TIPOS_ALERTA.join('|')})(?::[0-9]{1,4})?$`);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const APLICA_A = ['inasistencia', 'atraso'];

class ErrorRespaldo extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.status = 400;
    this.codigo = codigo;
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

// ---- Contraseña de respaldo y carpeta externa ----

function escribirSeguro(ruta, contenido) {
  const temporal = `${ruta}.tmp`;
  fs.writeFileSync(temporal, contenido, { mode: 0o600 });
  fs.renameSync(temporal, ruta); // así un corte a mitad de escritura no deja un archivo dañado
}

// La contraseña se guarda cifrada con el secreto del equipo (igual que las credenciales del portal)
function leerContrasena() {
  if (!fs.existsSync(ARCHIVO_CONTRASENA)) return null;
  try {
    const registro = JSON.parse(fs.readFileSync(ARCHIVO_CONTRASENA, 'utf8'));
    return descifrar(registro, obtenerSecreto(), ETIQUETA_CONTRASENA).toString('utf8') || null;
  } catch (error) {
    console.error('No se pudo leer la contraseña de respaldo:', error.message);
    return null;
  }
}

function configRespaldo() {
  return {
    conContrasena: Boolean(leerContrasena()),
    carpetaExterna: configuracion.leer().carpetaRespaldoExterna || '',
    minContrasena: MIN_CONTRASENA,
  };
}

// { contrasena?: string, carpetaExterna?: string ('' la quita) }
function configurarRespaldo({ contrasena, carpetaExterna } = {}) {
  if (contrasena !== undefined) {
    if (typeof contrasena !== 'string' || contrasena.length < MIN_CONTRASENA || contrasena.length > 200) {
      throw new ErrorRespaldo(`La contraseña de respaldo debe tener al menos ${MIN_CONTRASENA} caracteres.`);
    }
    const registro = { version: 1, ...cifrar(contrasena, obtenerSecreto(), ETIQUETA_CONTRASENA) };
    escribirSeguro(ARCHIVO_CONTRASENA, JSON.stringify(registro));
  }
  if (carpetaExterna !== undefined) {
    if (typeof carpetaExterna !== 'string' || carpetaExterna.length > 500) {
      throw new ErrorRespaldo('La carpeta externa no es válida.');
    }
    const carpeta = carpetaExterna.trim();
    if (carpeta) {
      if (!path.isAbsolute(carpeta)) throw new ErrorRespaldo('Escribe la ruta completa de la carpeta (por ejemplo E:\\Respaldos).');
      try {
        if (!fs.statSync(carpeta).isDirectory()) throw new Error('no es carpeta');
        fs.accessSync(carpeta, fs.constants.W_OK);
      } catch {
        throw new ErrorRespaldo('No se encontró esa carpeta o no se puede escribir en ella. Revisa que el pendrive esté conectado.');
      }
    }
    configuracion.guardar({ carpetaRespaldoExterna: carpeta || null });
  }
  return configRespaldo();
}

// ---- Formato del archivo (.inspbak) ----

// Objeto del respaldo → Buffer del archivo cifrado (con la contraseña si hay, si no con el equipo)
function empaquetar(respaldo) {
  const contrasena = leerContrasena();
  const comprimido = zlib.gzipSync(Buffer.from(JSON.stringify(respaldo), 'utf8'));
  return Buffer.from(JSON.stringify({
    app: 'inspectoria',
    tipo: 'respaldo-cifrado',
    version: VERSION_ARCHIVO,
    clave: contrasena ? 'contrasena' : 'equipo',
    creado_en: respaldo.creado_en || new Date().toISOString(),
    ...cifrar(comprimido, contrasena || obtenerSecreto(), ETIQUETA_RESPALDO),
  }), 'utf8');
}

// Buffer del archivo → objeto del respaldo. Acepta el JSON plano v1 y el cifrado v2.
// `contrasena` solo se usa si el archivo se cifró con contraseña.
function desempaquetar(buffer, contrasena) {
  let archivo;
  try {
    archivo = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new ErrorRespaldo('El archivo no es un respaldo válido.');
  }
  if (archivo?.app !== 'inspectoria' || archivo.tipo !== 'respaldo-cifrado') return archivo; // v1 o ajeno
  if (archivo.version !== VERSION_ARCHIVO) {
    throw new ErrorRespaldo('La versión del respaldo no es compatible con esta versión del sistema.');
  }
  let secreto;
  if (archivo.clave === 'contrasena') {
    if (!contrasena) {
      throw new ErrorRespaldo('Este respaldo está protegido con contraseña. Escríbela para restaurarlo.', 'CLAVE_REQUERIDA');
    }
    secreto = contrasena;
  } else {
    secreto = obtenerSecreto();
  }
  try {
    const comprimido = descifrar(archivo, secreto, ETIQUETA_RESPALDO);
    return JSON.parse(zlib.gunzipSync(comprimido).toString('utf8'));
  } catch (error) {
    if (error.code !== 'CLAVE_INCORRECTA') throw new ErrorRespaldo('El respaldo está dañado.');
    throw archivo.clave === 'contrasena'
      ? new ErrorRespaldo('La contraseña no corresponde a este respaldo.', 'CLAVE_INCORRECTA')
      : new ErrorRespaldo('Este respaldo se hizo en otro equipo sin contraseña de respaldo, así que solo se puede restaurar allí.', 'OTRO_EQUIPO');
  }
}

// Modo de cifrado de un archivo ya escrito ('contrasena' | 'equipo' | 'plano')
function claveDeArchivo(buffer) {
  try {
    const archivo = JSON.parse(buffer.toString('utf8'));
    return archivo.tipo === 'respaldo-cifrado' ? archivo.clave : 'plano';
  } catch {
    return 'plano';
  }
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

// Los respaldos automáticos antiguos (JSON sin cifrar, v1) se cifran y se borra el plano
function migrarPlanos() {
  for (const { nombre } of listarAutomaticos()) {
    if (!nombre.endsWith('.json')) continue;
    const origen = path.join(DIR_AUTOMATICOS, nombre);
    const destino = path.join(DIR_AUTOMATICOS, nombre.replace(/\.json$/, EXTENSION));
    try {
      if (!fs.existsSync(destino)) {
        const datos = JSON.parse(fs.readFileSync(origen, 'utf8').replace(/^\uFEFF/, ''));
        escribirSeguro(destino, empaquetar(datos));
      }
      fs.rmSync(origen, { force: true });
    } catch (error) {
      console.error(`No se pudo cifrar el respaldo antiguo ${nombre}:`, error.message);
    }
  }
}

// Copia el respaldo a la carpeta externa (pendrive) si está configurada y hay contraseña
// (sin contraseña no se podría restaurar en otro equipo). Deja ahí los últimos MAX_AUTOMATICOS.
function copiarExterno(nombre) {
  const carpeta = configuracion.leer().carpetaRespaldoExterna;
  if (!carpeta || !nombre) return;
  const origen = path.join(DIR_AUTOMATICOS, nombre);
  try {
    if (claveDeArchivo(fs.readFileSync(origen)) !== 'contrasena') return;
    fs.copyFileSync(origen, path.join(carpeta, nombre));
    const enCarpeta = fs.readdirSync(carpeta).filter((n) => ARCHIVO_AUTOMATICO.test(n) && n.endsWith(EXTENSION)).sort().reverse();
    for (const viejo of enCarpeta.slice(MAX_AUTOMATICOS)) fs.rmSync(path.join(carpeta, viejo), { force: true });
  } catch (error) {
    // Pendrive desconectado u otra falla: el respaldo local ya quedó guardado
    console.error('No se pudo copiar el respaldo a la carpeta externa:', error.message);
    try {
      auditoriaSistema.registrar('respaldo.copia_externa_fallida', null, { carpeta, error: error.code || error.message });
    } catch { /* sin log */ }
  }
}

/**
 * Guarda el respaldo de hoy si los datos (o la forma de cifrarlo) cambiaron desde el último
 * y deja solo los últimos MAX_AUTOMATICOS. Con { soloSiFaltaHoy: true } no hace nada si ya
 * hay uno de hoy. Si hay carpeta externa, le copia el más reciente.
 * Devuelve el nombre del archivo escrito o null.
 */
function respaldoAutomatico(db, { soloSiFaltaHoy = false } = {}) {
  fs.mkdirSync(DIR_AUTOMATICOS, { recursive: true, mode: 0o700 });
  migrarPlanos();
  const nombre = `respaldo-${fechaLocal()}${EXTENSION}`;
  const ruta = path.join(DIR_AUTOMATICOS, nombre);
  if (soloSiFaltaHoy && fs.existsSync(ruta)) {
    copiarExterno(nombre);
    return null;
  }

  const datos = leerDatos(db);
  const vacio = !datos.alerta_gestion.length && !datos.justificativos.length;
  const ultimo = listarAutomaticos()[0];
  const modo = leerContrasena() ? 'contrasena' : 'equipo';
  if (ultimo) {
    try {
      const buffer = fs.readFileSync(path.join(DIR_AUTOMATICOS, ultimo.nombre));
      const anterior = desempaquetar(buffer, leerContrasena());
      const igual = claveDeArchivo(buffer) === modo
        && JSON.stringify(datos.alerta_gestion) === JSON.stringify(anterior.alerta_gestion)
        && JSON.stringify(datos.justificativos) === JSON.stringify(anterior.justificativos);
      if (igual) {
        copiarExterno(ultimo.nombre);
        return null;
      }
    } catch {
      // respaldo anterior ilegible (o de otra contraseña): se escribe uno nuevo
    }
  } else if (vacio) {
    return null; // nada que respaldar todavía
  }

  escribirSeguro(ruta, empaquetar({ ...generarRespaldo(db), ...datos }));
  for (const viejo of listarAutomaticos().slice(MAX_AUTOMATICOS)) {
    fs.rmSync(path.join(DIR_AUTOMATICOS, viejo.nombre), { force: true });
  }
  copiarExterno(nombre);
  return nombre;
}

module.exports = {
  generarRespaldo,
  restaurarRespaldo,
  respaldoAutomatico,
  listarAutomaticos,
  rutaAutomatico,
  fechaLocal,
  empaquetar,
  desempaquetar,
  claveDeArchivo,
  configRespaldo,
  configurarRespaldo,
  EXTENSION,
  ErrorRespaldo,
};
