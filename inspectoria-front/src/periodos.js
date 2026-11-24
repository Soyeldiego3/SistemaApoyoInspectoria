// Períodos de los filtros de fecha (Auditoría y Alumnos): id → rango { desde, hasta } en YYYY-MM-DD.
import { fechaLocal } from './fechas.js';

export const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Esta semana' },
  { id: '30dias', label: 'Últimos 30 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mesAnterior', label: 'Mes anterior' },
  { id: '2meses', label: 'Últimos 2 meses' },
  { id: 'anio', label: 'Año escolar' },
  { id: 'personalizado', label: 'Elegir fechas…' },
];

// El año escolar parte en marzo (igual que INICIO_ANIO_ESCOLAR en el back, routes/sync.js)
const MES_INICIO_ANIO_ESCOLAR = 2;

// Un mes descargado puntual: 'mes:2026-10'
export const PREFIJO_MES = 'mes:';
export const esPeriodoMes = (id) => /^mes:\d{4}-(0[1-9]|1[0-2])$/.test(id || '');
export const claveMes = (fecha) => `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;

export function rangoPeriodo(periodo, personalizadoDesde = '', personalizadoHasta = '') {
  const hoy = new Date();
  const fin = fechaLocal(hoy);
  // Mes completo (o hasta hoy si es el mes en curso)
  const rangoMes = (anio, mesIndice) => {
    const ultimo = fechaLocal(new Date(anio, mesIndice + 1, 0));
    return { desde: fechaLocal(new Date(anio, mesIndice, 1)), hasta: ultimo < fin ? ultimo : fin };
  };
  if (periodo === 'mesAnterior') return rangoMes(hoy.getFullYear(), hoy.getMonth() - 1);
  if (esPeriodoMes(periodo)) {
    const [anio, mes] = periodo.slice(PREFIJO_MES.length).split('-').map(Number);
    return rangoMes(anio, mes - 1);
  }
  if (periodo === 'ayer') {
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    const fecha = fechaLocal(ayer);
    return { desde: fecha, hasta: fecha };
  }
  if (periodo === 'semana') {
    const inicio = new Date(hoy);
    inicio.setDate(hoy.getDate() - (hoy.getDay() === 0 ? 6 : hoy.getDay() - 1));
    return { desde: fechaLocal(inicio), hasta: fin };
  }
  if (periodo === 'mes') {
    return { desde: fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fin };
  }
  if (periodo === '30dias') {
    const inicio = new Date(hoy);
    inicio.setDate(hoy.getDate() - 29);
    return { desde: fechaLocal(inicio), hasta: fin };
  }
  if (periodo === '2meses') {
    // Mes anterior + actual: lo mismo que se sincroniza por defecto
    return { desde: fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), hasta: fin };
  }
  if (periodo === 'anio') {
    return { desde: fechaLocal(new Date(hoy.getFullYear(), MES_INICIO_ANIO_ESCOLAR, 1)), hasta: fin };
  }
  if (periodo === 'personalizado') {
    return { desde: personalizadoDesde, hasta: personalizadoHasta };
  }
  return { desde: fin, hasta: fin };
}
