// Respaldo de la información que solo existe en esta app: la gestión de alertas
// (estado + nota) y los justificativos aprobados. La asistencia y los atrasos NO se
// respaldan: se borran al cerrar a propósito y se vuelven a sincronizar desde el portal.
//
// Los archivos (.inspbak) van comprimidos (gzip) y cifrados (AES-256-GCM, services/cifrado.js):
// - por defecto con CLAVE_APP, fija en la app → se restauran en cualquier PC con la app, sin escribir nada;
// - con la "contraseña de respaldo" opcional (Ajustes → Más opciones), si se definió una.
// Con una carpeta externa (pendrive) configurada, cada respaldo automático también se copia ahí.
// Se siguen pudiendo restaurar los antiguos: v1 (JSON sin cifrar) y 'equipo' (secret.key de este PC).
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
// Clave fija de la app para los respaldos sin contraseña propia. Evita que el archivo se abra
// por casualidad (con un editor, desde el pendrive), pero NO protege contra alguien que tenga el
// código fuente: para eso está la contraseña de respaldo opcional. No cambiarla: los respaldos
// ya escritos con ella dejarían de poder restaurarse.
const CLAVE_APP = 'b6e1c94f2a7d3085e9f4c1a26d8b73f05c2e9a41d7b8f6031e4a9c5d2b7f8e60';
const DIR_AUTOMATICOS = path.join(DATA_DIR, 'respaldos');
const MAX_AUTOMATICOS = 7;
// respaldo-AAAA-MM-DD-HHmm.inspbak (los antiguos, uno por día, no llevan la hora)
const ARCHIVO_AUTOMATICO = /^respaldo-(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2}))?\.(json|inspbak)$/;
// Cada cuántos minutos se revisa si hay que respaldar (0 = solo al abrir y cerrar la app)
const INTERVALOS = [0, 30, 60, 180, 360, 720, 1440];
const INTERVALO_DEFECTO = 60;
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

const pad = (n) => String(n).padStart(2, '0');

function fechaLocal(fecha = new Date()) {
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
}

const horaLocal = (fecha = new Date()) => `${pad(fecha.getHours())}${pad(fecha.getMinutes())}`;

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
  const error = (detalle) => new ErrorRespaldo(`La nota ${i + 1} de la copia no es válida (${detalle}).`);
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
  const error = (detalle) => new ErrorRespaldo(`El justificativo ${i + 1} de la copia no es válido (${detalle}).`);
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
    throw new ErrorRespaldo('El archivo no es una copia de seguridad de esta app.');
  }
  if (datos.version !== VERSION) {
    throw new ErrorRespaldo('Esta copia es de otra versión de la app y no se puede recuperar.');
  }
  const alertas = datos.alerta_gestion ?? [];
  const justificativos = datos.justificativos ?? [];
  if (!Array.isArray(alertas) || !Array.isArray(justificativos)) {
    throw new ErrorRespaldo('La copia está incompleta o dañada.');
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

function intervaloMin(config = configuracion.leer()) {
  return INTERVALOS.includes(config.respaldoIntervaloMin) ? config.respaldoIntervaloMin : INTERVALO_DEFECTO;
}

// Cuándo toca la próxima revisión del temporizador (Date) o null si está desactivado.
// Si nunca se revisó o ya pasó la hora, toca ahora.
function proximoRespaldo(config = configuracion.leer()) {
  const minutos = intervaloMin(config);
  if (!minutos) return null;
  const ultima = Date.parse(config.respaldoUltimaRevision);
  const ahora = Date.now();
  if (Number.isNaN(ultima)) return new Date(ahora);
  return new Date(Math.max(ahora, ultima + minutos * 60_000));
}

function configRespaldo() {
  const config = configuracion.leer();
  return {
    conContrasena: Boolean(leerContrasena()),
    carpetaExterna: config.carpetaRespaldoExterna || '',
    minContrasena: MIN_CONTRASENA,
    intervaloMin: intervaloMin(config),
    intervalos: INTERVALOS,
    proximoRespaldo: proximoRespaldo(config)?.toISOString() ?? null,
    ultimaRevision: config.respaldoUltimaRevision || null,
    ultimoResultado: config.respaldoUltimoResultado || null,
    // Dentro de la app de escritorio se puede abrir el diálogo nativo para elegir la carpeta
    selectorCarpeta: typeof process.send === 'function' && process.connected,
  };
}

// { contrasena?: string (null la quita), carpetaExterna?: string ('' la quita), intervaloMin?: number }
function configurarRespaldo({ contrasena, carpetaExterna, intervaloMin: minutos } = {}) {
  if (minutos !== undefined && !INTERVALOS.includes(minutos)) {
    throw new ErrorRespaldo('La frecuencia de la copia automática no es válida.');
  }
  if (contrasena === null) {
    fs.rmSync(ARCHIVO_CONTRASENA, { force: true }); // vuelve a la clave de la app
  } else if (contrasena !== undefined) {
    if (typeof contrasena !== 'string' || contrasena.length < MIN_CONTRASENA || contrasena.length > 200) {
      throw new ErrorRespaldo(`La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres.`);
    }
    const registro = { version: 1, ...cifrar(contrasena, obtenerSecreto(), ETIQUETA_CONTRASENA) };
    escribirSeguro(ARCHIVO_CONTRASENA, JSON.stringify(registro));
  }
  if (carpetaExterna !== undefined) {
    if (typeof carpetaExterna !== 'string' || carpetaExterna.length > 500) {
      throw new ErrorRespaldo('La carpeta no es válida.');
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
  if (minutos !== undefined) configuracion.guardar({ respaldoIntervaloMin: minutos });
  return configRespaldo();
}

// ---- Formato del archivo (.inspbak) ----

// Objeto del respaldo → Buffer del archivo cifrado (con la contraseña si hay, si no con la clave de la app)
function empaquetar(respaldo) {
  const contrasena = leerContrasena();
  const comprimido = zlib.gzipSync(Buffer.from(JSON.stringify(respaldo), 'utf8'));
  return Buffer.from(JSON.stringify({
    app: 'inspectoria',
    tipo: 'respaldo-cifrado',
    version: VERSION_ARCHIVO,
    clave: contrasena ? 'contrasena' : 'app',
    creado_en: respaldo.creado_en || new Date().toISOString(),
    ...cifrar(comprimido, contrasena || CLAVE_APP, ETIQUETA_RESPALDO),
  }), 'utf8');
}

// Buffer del archivo → objeto del respaldo. Acepta el JSON plano v1 y el cifrado v2.
// `contrasena` solo se usa si el archivo se cifró con contraseña.
function desempaquetar(buffer, contrasena) {
  let archivo;
  try {
    archivo = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new ErrorRespaldo('El archivo no es una copia de seguridad válida.');
  }
  if (archivo?.app !== 'inspectoria' || archivo.tipo !== 'respaldo-cifrado') return archivo; // v1 o ajeno
  if (archivo.version !== VERSION_ARCHIVO) {
    throw new ErrorRespaldo('Esta copia es de otra versión de la app y no se puede recuperar.');
  }
  let secreto;
  if (archivo.clave === 'contrasena') {
    if (!contrasena) {
      throw new ErrorRespaldo('Esta copia tiene contraseña. Escríbela para recuperarla.', 'CLAVE_REQUERIDA');
    }
    secreto = contrasena;
  } else if (archivo.clave === 'app') {
    secreto = CLAVE_APP;
  } else {
    secreto = obtenerSecreto(); // 'equipo': respaldos antiguos, solo de este PC
  }
  try {
    const comprimido = descifrar(archivo, secreto, ETIQUETA_RESPALDO);
    return JSON.parse(zlib.gunzipSync(comprimido).toString('utf8'));
  } catch (error) {
    if (error.code !== 'CLAVE_INCORRECTA') throw new ErrorRespaldo('La copia está dañada.');
    if (archivo.clave === 'contrasena') {
      throw new ErrorRespaldo('La contraseña no corresponde a esta copia.', 'CLAVE_INCORRECTA');
    }
    throw archivo.clave === 'app'
      ? new ErrorRespaldo('La copia está dañada.')
      : new ErrorRespaldo('Esta copia antigua se hizo en otro computador y solo se puede recuperar allí.', 'OTRO_EQUIPO');
  }
}

// Modo de cifrado de un archivo ya escrito ('app' | 'contrasena' | 'equipo' | 'plano')
function claveDeArchivo(buffer) {
  try {
    const archivo = JSON.parse(buffer.toString('utf8'));
    return archivo.tipo === 'respaldo-cifrado' ? archivo.clave : 'plano';
  } catch {
    return 'plano';
  }
}

// ---- Respaldos automáticos (DATA_DIR/respaldos) ----

// Nombres de respaldo automático de una carpeta, del más nuevo al más antiguo.
// Se ordena por fecha+hora: por orden alfabético "…-24.inspbak" quedaría después de "…-24-1800.inspbak".
function nombresAutomaticos(carpeta, filtro = () => true) {
  const orden = (nombre) => {
    const [, fecha, hh = '00', mm = '00'] = ARCHIVO_AUTOMATICO.exec(nombre);
    return `${fecha}${hh}${mm}`;
  };
  return fs.readdirSync(carpeta)
    .filter((nombre) => ARCHIVO_AUTOMATICO.test(nombre) && filtro(nombre))
    .sort((a, b) => orden(b).localeCompare(orden(a)) || b.localeCompare(a));
}

function listarAutomaticos() {
  if (!fs.existsSync(DIR_AUTOMATICOS)) return [];
  return nombresAutomaticos(DIR_AUTOMATICOS).map((nombre) => {
    const [, fecha, hh, mm] = ARCHIVO_AUTOMATICO.exec(nombre);
    const { size, mtime } = fs.statSync(path.join(DIR_AUTOMATICOS, nombre));
    return { nombre, fecha, hora: hh ? `${hh}:${mm}` : null, bytes: size, modificado: mtime.toISOString() };
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

// Copia el respaldo a la carpeta externa (pendrive) si está configurada. Solo los que se pueden
// restaurar en otro equipo (clave de la app o contraseña). Deja ahí los últimos MAX_AUTOMATICOS.
function copiarExterno(nombre) {
  const carpeta = configuracion.leer().carpetaRespaldoExterna;
  if (!carpeta || !nombre) return;
  const origen = path.join(DIR_AUTOMATICOS, nombre);
  try {
    if (!['app', 'contrasena'].includes(claveDeArchivo(fs.readFileSync(origen)))) return;
    fs.copyFileSync(origen, path.join(carpeta, nombre));
    const enCarpeta = nombresAutomaticos(carpeta, (n) => n.endsWith(EXTENSION));
    for (const viejo of enCarpeta.slice(MAX_AUTOMATICOS)) fs.rmSync(path.join(carpeta, viejo), { force: true });
  } catch (error) {
    // Pendrive desconectado u otra falla: el respaldo local ya quedó guardado
    console.error('No se pudo copiar el respaldo a la carpeta externa:', error.message);
    try {
      auditoriaSistema.registrar('respaldo.copia_externa_fallida', null, { carpeta, error: error.code || error.message });
    } catch { /* sin log */ }
  }
}

// Deja anotado cuándo se revisó por última vez y con qué resultado (lo muestra Ajustes
// y el temporizador cuenta desde ahí)
function anotarRevision(resultado) {
  try {
    configuracion.guardar({ respaldoUltimaRevision: new Date().toISOString(), respaldoUltimoResultado: resultado });
  } catch (error) {
    console.error('No se pudo anotar la revisión del respaldo:', error.message);
  }
}

/**
 * Guarda un respaldo nuevo si los datos (o la forma de cifrarlo) cambiaron desde el último
 * —el primero se guarda aunque esté vacío— y deja solo los últimos MAX_AUTOMATICOS.
 * Con { soloSiFaltaHoy: true } no hace nada si ya hay uno de hoy. Si hay carpeta externa,
 * le copia el más reciente.
 * Devuelve { archivo, resultado: 'creado' | 'sin_cambios' | 'omitido' }.
 */
function respaldoAutomatico(db, { soloSiFaltaHoy = false } = {}) {
  fs.mkdirSync(DIR_AUTOMATICOS, { recursive: true, mode: 0o700 });
  migrarPlanos();
  const ahora = new Date();
  const ultimo = listarAutomaticos()[0];
  if (soloSiFaltaHoy && ultimo?.fecha === fechaLocal(ahora)) {
    copiarExterno(ultimo.nombre);
    return { archivo: null, resultado: 'omitido' };
  }

  const datos = leerDatos(db);
  const modo = leerContrasena() ? 'contrasena' : 'app';
  if (ultimo) {
    try {
      const buffer = fs.readFileSync(path.join(DIR_AUTOMATICOS, ultimo.nombre));
      const anterior = desempaquetar(buffer, leerContrasena());
      const igual = claveDeArchivo(buffer) === modo
        && JSON.stringify(datos.alerta_gestion) === JSON.stringify(anterior.alerta_gestion)
        && JSON.stringify(datos.justificativos) === JSON.stringify(anterior.justificativos);
      if (igual) {
        copiarExterno(ultimo.nombre);
        anotarRevision('sin_cambios');
        return { archivo: null, resultado: 'sin_cambios' };
      }
    } catch {
      // respaldo anterior ilegible (o de otra contraseña): se escribe uno nuevo
    }
  }

  const nombre = `respaldo-${fechaLocal(ahora)}-${horaLocal(ahora)}${EXTENSION}`;
  escribirSeguro(path.join(DIR_AUTOMATICOS, nombre), empaquetar({ ...generarRespaldo(db), ...datos }));
  for (const viejo of listarAutomaticos().slice(MAX_AUTOMATICOS)) {
    fs.rmSync(path.join(DIR_AUTOMATICOS, viejo.nombre), { force: true });
  }
  copiarExterno(nombre);
  anotarRevision('creado');
  return { archivo: nombre, resultado: 'creado' };
}

// Restaura uno de los respaldos automáticos de la lista. Si se hizo con contraseña y no
// llega una, prueba con la contraseña guardada en este equipo.
function restaurarAutomatico(db, nombre, contrasena) {
  const ruta = rutaAutomatico(nombre);
  if (!ruta) {
    const error = new ErrorRespaldo('No se encontró esa copia.');
    error.status = 404;
    throw error;
  }
  const buffer = fs.readFileSync(ruta);
  let datos;
  try {
    datos = desempaquetar(buffer, contrasena || leerContrasena());
  } catch (error) {
    // Se hizo con una contraseña anterior: hay que pedírsela a la persona
    if (!contrasena && error.codigo === 'CLAVE_INCORRECTA') {
      throw new ErrorRespaldo('Esta copia tiene contraseña. Escríbela para recuperarla.', 'CLAVE_REQUERIDA');
    }
    throw error;
  }
  return restaurarRespaldo(db, datos);
}

module.exports = {
  generarRespaldo,
  restaurarRespaldo,
  restaurarAutomatico,
  respaldoAutomatico,
  proximoRespaldo,
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
