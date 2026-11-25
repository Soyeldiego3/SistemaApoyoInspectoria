const API_BASE = '/api';
const API_URL = window.location.protocol === 'file:' ? 'http://localhost:3005' : window.location.origin;

// Sesión: el token que entrega el login se guarda en el navegador y se envía en cada petición.
export const getToken = () => localStorage.getItem('token');
export const cerrarSesion = () => localStorage.removeItem('token');

async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_URL}${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  // Solo una 401 de una ruta del sistema invalida la sesión.
  // Las rutas del portal y sincronización pueden reportar 422/502/503/504 sin cerrar sesión.
  const rutaPortal = path.startsWith('/portal/') || path.startsWith('/sync/');
  const rutaLogin = path === '/auth/login' || path === '/auth/qr';
  if (response.status === 401 && !rutaLogin && !rutaPortal && !data?.codigo) {
    cerrarSesion();
    window.location.hash = '#/login';
    throw new Error('Tu sesión venció. Inicia sesión de nuevo.');
  }

  if (!response.ok) {
    const message = typeof data === 'object' && (data?.mensaje || data?.error)
      ? data.mensaje || data.error
      : `Error de API (${response.status})`;
    const error = new Error(message);
    error.code = typeof data === 'object' ? (data?.codigo || data?.code) : undefined;
    error.datos = typeof data === 'object' ? data : undefined;
    throw error;
  }

  // Cualquier cambio de datos (sincronizar, justificar, gestionar o importar alertas…)
  // puede cambiar las alertas pendientes: se avisa al menú para actualizar su número
  const metodo = (options.method || 'GET').toUpperCase();
  if (metodo !== 'GET' && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event('alertas-actualizadas'));
  }

  return data;
}

export async function login(usuario, password) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ usuario, password }),
  });
  localStorage.setItem('token', data.token);
  return data;
}

// Canjea el código del QR (teléfono) por una sesión normal
export async function loginConQr(codigo) {
  const data = await request('/auth/qr', {
    method: 'POST',
    body: JSON.stringify({ codigo }),
  });
  localStorage.setItem('token', data.token);
  return data;
}

// Solo desde el PC: { codigo, url, expiraEnMs, usuario } para armar el QR con inicio de sesión
export function crearCodigoQr() {
  return request('/red/qr-login', { method: 'POST' });
}

export function getSetupEstado() {
  return request('/setup/estado');
}

export function crearAdministrador(datos) {
  return request('/setup/admin', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export function getCuenta() {
  return request('/cuenta');
}

export function cambiarPasswordCuenta(actual, nueva) {
  return request('/cuenta/password', {
    method: 'PUT',
    body: JSON.stringify({ actual, nueva }),
  });
}

// Pendientes por alumno; con desde/hasta (YYYY-MM-DD) cuenta solo ese rango
export function getAlumnos({ desde, hasta } = {}, options = {}) {
  const p = new URLSearchParams();
  if (desde) p.set('desde', desde);
  if (hasta) p.set('hasta', hasta);
  return request(`/asistencia/alumnos${p.toString() ? `?${p}` : ''}`, { signal: options.signal });
}

export function getDashboard() {
  return request('/dashboard');
}

export function getGraficos({ curso, desde, hasta } = {}) {
  const p = new URLSearchParams();
  if (curso) p.set('curso', curso);
  if (desde && hasta) { p.set('desde', desde); p.set('hasta', hasta); }
  return request(`/graficos${p.toString() ? `?${p}` : ''}`);
}

export function getInasistenciasDia({ fecha, curso }) {
  const p = new URLSearchParams({ fecha });
  if (curso) p.set('curso', curso);
  return request(`/graficos/dia?${p}`);
}

export function getCursos() {
  return request('/cursos');
}

export function getAuditoriaEstado(options = {}) {
  return request('/auditoria/estado', { signal: options.signal });
}

export function getAuditoriaPrioridad(params = {}, options = {}) {
  return request(`/auditoria/prioridad?${new URLSearchParams(params)}`, { signal: options.signal });
}

export function getAuditoriaCursos(params = {}, options = {}) {
  return request(`/auditoria/cursos?${new URLSearchParams(params)}`, { signal: options.signal });
}

export function getAlertas(params = {}, options = {}) {
  return request(`/auditoria/alertas?${new URLSearchParams(params)}`, { signal: options.signal });
}

export function getConteoAlertas(params = {}, options = {}) {
  return request(`/auditoria/alertas/conteo?${new URLSearchParams(params)}`, { signal: options.signal });
}

// estado: 'revisada' | 'citado' | 'descartada' | null (reabrir)
export async function gestionarAlerta(clave, datos) {
  const respuesta = await request(`/auditoria/alertas/${encodeURIComponent(clave)}`, {
    method: 'PUT',
    body: JSON.stringify(datos),
  });
  return respuesta;
}

export function getAlumno(rut) {
  return request(`/asistencia/alumnos/${encodeURIComponent(rut)}`);
}

export function crearJustificativo(rut, datos) {
  return request(`/asistencia/alumnos/${encodeURIComponent(rut)}/justificativos`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

// ---------- Exportar / importar (ventana "Exportar / Importar") ----------
export function getRangoDatos() {
  return request('/registro/rango');
}

// { documento: 'asistencia'|'atrasos'|'master', curso?, formato: 'excel'|'pdf', desde?, hasta? }
// Devuelve { blob, nombre, advertencias } para descargar el archivo
export async function exportarDocumento(params) {
  const token = getToken();
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  const response = await fetch(`${API_URL}${API_BASE}/exportar?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Error de API (${response.status})`);
  }
  const disposicion = response.headers.get('content-disposition') || '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposicion);
  const simple = /filename="([^"]+)"/i.exec(disposicion);
  const nombre = utf8 ? decodeURIComponent(utf8[1]) : simple?.[1] || 'Exportación';
  let advertencias = [];
  try { advertencias = JSON.parse(decodeURIComponent(response.headers.get('x-advertencias') || '[]')); } catch { /* sin avisos */ }
  return { blob: await response.blob(), nombre, advertencias };
}

// Importa un Master de registro. Sin curso, el backend lo detecta desde el archivo.
export function importarRegistro(archivo, curso) {
  const query = curso ? `?${new URLSearchParams({ curso })}` : '';
  return request(`/registro/importar${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: archivo,
  });
}

// ---------- Respaldo de información (notas de alertas y justificativos) ----------
async function descargarArchivo(path, nombrePorDefecto) {
  const token = getToken();
  const response = await fetch(`${API_URL}${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.mensaje || `Error de API (${response.status})`);
  }
  const simple = /filename="([^"]+)"/i.exec(response.headers.get('content-disposition') || '');
  return {
    blob: await response.blob(),
    nombre: simple?.[1] || nombrePorDefecto,
    // 'app' | 'contrasena' | 'equipo' | 'plano': con 'equipo' (antiguos) solo se restaura en este PC
    clave: response.headers.get('x-respaldo-clave') || null,
  };
}

// Devuelve { blob, nombre, clave } con el respaldo cifrado (.inspbak)
export function descargarRespaldo() {
  return descargarArchivo('/respaldo', 'respaldo-inspectoria.inspbak');
}

// Devuelve { ok, resumen: { alertas: {nuevas, actualizadas, omitidas}, justificativos: {nuevos, omitidos} } }
// Si el respaldo tiene contraseña y falta o no corresponde, lanza un Error con code
// 'CLAVE_REQUERIDA' | 'CLAVE_INCORRECTA'.
export function restaurarRespaldo(archivo, contrasena) {
  return request('/respaldo/restaurar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      // Un header solo admite ASCII: la contraseña va codificada
      ...(contrasena ? { 'X-Clave-Respaldo': encodeURIComponent(contrasena) } : {}),
    },
    body: archivo,
  });
}

// { conContrasena, carpetaExterna, minContrasena, intervaloMin, intervalos, proximoRespaldo,
//   ultimaRevision, ultimoResultado, selectorCarpeta } (solo desde el PC)
export function getConfigRespaldo() {
  return request('/respaldo/config');
}

// { contrasena? (null la quita), carpetaExterna? ('' la quita), intervaloMin? } → misma forma que getConfigRespaldo
export function setConfigRespaldo(cambios) {
  return request('/respaldo/config', { method: 'PUT', body: JSON.stringify(cambios) });
}

// Abre el diálogo de carpeta de la app de escritorio → configuración (con `cancelado: true` si se cerró)
export function elegirCarpetaRespaldo() {
  return request('/respaldo/elegir-carpeta', { method: 'POST' });
}

export function listarRespaldosAutomaticos() {
  return request('/respaldo/automaticos');
}

// "Guardar copia ahora" → { archivo, resultado: 'creado' | 'sin_cambios' }
export function guardarCopiaAhora() {
  return request('/respaldo/automaticos', { method: 'POST' });
}

// Recupera una copia de la lista; mismos errores y respuesta que restaurarRespaldo
export function recuperarCopiaGuardada(nombre, contrasena) {
  return request(`/respaldo/automaticos/${encodeURIComponent(nombre)}/restaurar`, {
    method: 'POST',
    headers: contrasena ? { 'X-Clave-Respaldo': encodeURIComponent(contrasena) } : {},
  });
}

export function iniciarSync(credenciales, options = {}) {
  return request('/sync/descargar-e-importar', {
    method: 'POST',
    body: JSON.stringify(credenciales || {}),
    signal: options.signal,
  });
}

// ---------- Asistencia por clase (bloques horarios) ----------
// Lee lo guardado en la BD: { curso, fecha, bloques: [{ hora_inicio, hora_fin, alumnos: [{ rut, apellidos, nombres, estado }] }] }
// Sin curso (todos los cursos): { fecha, cursos: [{ curso, bloques }] }
export function getAsistenciaClase({ curso, fecha }) {
  return request(`/asistencia/clase?${new URLSearchParams({ ...(curso ? { curso } : {}), fecha })}`);
}

// Abre el portal una vez y trae la asistencia por clase de TODOS los cursos en esa fecha.
// Devuelve { cursos: string[], bloques, filas, advertencias, duracionMs }
export function extraerAsistenciaClase(fecha, options = {}) {
  return request('/sync/asistencia-clase', {
    method: 'POST',
    body: JSON.stringify({ fecha }),
    signal: options.signal,
  });
}

// ---------- Sincronización como tarea en el PC (la usa el teléfono) ----------
// El PC responde al tiro { tarea } y extrae en segundo plano; el estado se consulta con getTareaSync.
// Tarea: { id, tipo: 'completa'|'clase', parametros, origen, estado: 'en_curso'|'ok'|'error', resultado, error }
export function iniciarTareaSync(cuerpo) {
  return request('/sync/descargar-e-importar', {
    method: 'POST',
    body: JSON.stringify({ ...(cuerpo || {}), segundoPlano: true }),
  });
}

export function iniciarTareaClase(fecha) {
  return request('/sync/asistencia-clase', {
    method: 'POST',
    body: JSON.stringify({ fecha, segundoPlano: true }),
  });
}

// Sin id: la tarea en curso o la última terminada ({ tarea: null } si no hay)
export function getTareaSync(id) {
  return request(id ? `/sync/tarea/${encodeURIComponent(id)}` : '/sync/tarea');
}

export function getCredencialesPortal() {
  return request('/portal/credenciales');
}

export function olvidarCredencialesPortal() {
  return request('/portal/credenciales', { method: 'DELETE' });
}

export function guardarCredencialesPortal(credenciales, options = {}) {
  return request('/portal/credenciales', {
    method: 'PUT',
    body: JSON.stringify(credenciales),
    signal: options.signal,
  });
}

export function probarCredencialesPortal(credenciales, options = {}) {
  return request('/portal/probar', {
    method: 'POST',
    body: JSON.stringify(credenciales || {}),
    signal: options.signal,
  });
}

// { activo: boolean } → { inicioWindows: { disponible, activo } } (admin, solo desde el PC)
export function setInicioWindows(activo) {
  return request('/ajustes/inicio-windows', {
    method: 'PUT',
    body: JSON.stringify({ activo }),
  });
}

export function getRedInfo() {
  return request('/red/info');
}

export function setRedEnabled(habilitada) {
  return request('/red/config', {
    method: 'PUT',
    body: JSON.stringify({ habilitada }),
  });
}

export function getAjustes() {
  return request('/ajustes');
}

export function setNavegadorHeadless(headless) {
  return request('/ajustes/navegador', {
    method: 'PUT',
    body: JSON.stringify({ headless }),
  });
}

export function getUsuarios() {
  return request('/usuarios');
}

export function crearUsuario(nombre, password, rol = 'inspector', activo = true) {
  return request('/usuarios', {
    method: 'POST',
    body: JSON.stringify({ nombre, password, rol, activo }),
  });
}

export function editarUsuario(nombre, cambios) {
  return request(`/usuarios/${encodeURIComponent(nombre)}`, {
    method: 'PUT',
    body: JSON.stringify(cambios),
  });
}

export function eliminarUsuario(nombre) {
  return request(`/usuarios/${encodeURIComponent(nombre)}`, {
    method: 'DELETE',
  });
}
