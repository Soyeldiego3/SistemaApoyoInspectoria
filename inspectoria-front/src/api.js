const API_BASE = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

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
