const API_BASE = '/api';

// Sesión: el token que entrega el login se guarda en el navegador y se envía en cada petición.
export const getToken = () => localStorage.getItem('token');
export const cerrarSesion = () => localStorage.removeItem('token');

async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // Sesión vencida o inválida: se limpia y se vuelve al login (salvo en el propio login, que muestra su error).
  if (response.status === 401 && path !== '/auth/login') {
    cerrarSesion();
    window.location.assign('/login');
    throw new Error('Tu sesión venció. Inicia sesión de nuevo.');
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof data === 'object' && data?.error
      ? data.error
      : `Error de API (${response.status})`;
    throw new Error(message);
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

export function getCursos() {
  return request('/sync/cursos');
}

export function iniciarSync() {
  return request('/sync/descargar-e-importar', {
    method: 'POST',
  });
}
