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
  if (response.status === 401 && path !== '/auth/login' && !rutaPortal && !data?.codigo) {
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
    throw error;
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

export function getAlumnos() {
  return request('/asistencia/alumnos');
}

export function getDashboard() {
  return request('/dashboard');
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

export function getAlumno(rut) {
  return request(`/asistencia/alumnos/${encodeURIComponent(rut)}`);
}

export function crearJustificativo(rut, datos) {
  return request(`/asistencia/alumnos/${encodeURIComponent(rut)}/justificativos`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export function iniciarSync(credenciales, options = {}) {
  return request('/sync/descargar-e-importar', {
    method: 'POST',
    body: JSON.stringify(credenciales || {}),
    signal: options.signal,
  });
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

export function getRedInfo() {
  return request('/red/info');
}

export function setRedEnabled(habilitada) {
  return request('/red/config', {
    method: 'PUT',
    body: JSON.stringify({ habilitada }),
  });
}

export function getUsuarios() {
  return request('/usuarios');
}

export function crearUsuario(nombre, password) {
  return request('/usuarios', {
    method: 'POST',
    body: JSON.stringify({ nombre, password }),
  });
}
