// Utilidades para fechas 'YYYY-MM-DD' tal como vienen del backend.
// Se separan a mano (sin new Date('YYYY-MM-DD')) para evitar desfases de zona horaria.

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// '2026-11-25' → '25-11-2026'
export const fechaCorta = (fecha) => (fecha ? fecha.split('-').reverse().join('-') : '');

// '2026-11-25' → 'Miércoles'
export const diaSemana = (fecha) => {
  const [a, m, d] = fecha.split('-').map(Number);
  return DIAS_SEMANA[new Date(a, m - 1, d).getDay()];
};

// '2026-11-25' → { dia: 25, mes: 'Noviembre', mesCorto: 'NOV', anio: 2026 }
export const partesFecha = (fecha) => {
  const [anio, m, dia] = fecha.split('-').map(Number);
  const mes = MESES[m - 1];
  return { dia, mes, mesCorto: mes.slice(0, 3).toUpperCase(), anio };
};

// '2026-11' (o '2026-11-25') → 'Noviembre 2026'
export const tituloMes = (fecha) => {
  const [anio, m] = fecha.split('-').map(Number);
  return `${MESES[m - 1]} ${anio}`;
};
