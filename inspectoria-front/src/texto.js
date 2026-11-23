// Utilidades de texto compartidas: búsqueda (Alumnos, Auditar), RUT y plurales.
// Ignora tildes, mayúsculas, puntos y guion del RUT.
export const limpiar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f.\-]/g, '').toLowerCase();

// true si el término (ya escrito por el usuario) aparece en alguno de los campos
export const coincide = (termino, ...campos) => {
  const t = limpiar(String(termino ?? '').trim());
  return !t || limpiar(campos.join(' ')).includes(t);
};

// '25990754-3' → '25.990.754-3'
export function formatearRut(rut) {
  const [cuerpo, dv] = String(rut).split('-');
  if (!dv || !/^\d+$/.test(cuerpo)) return rut;
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

// plural(3, 'atraso') → '3 atrasos'
export const plural = (n, singular, pluralTexto = `${singular}s`) => `${n} ${n === 1 ? singular : pluralTexto}`;
