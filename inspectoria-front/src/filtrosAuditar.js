// Memoria de los filtros de Auditar mientras la app siga abierta (se pierde al cerrarla).
// Así, al ir a otra sección y volver, Auditar queda donde estaba: pestaña, curso, tipo,
// período y los filtros internos de cada pestaña.
export const memoriaAuditar = {
  // { tab, tipo, curso, periodo, desde, hasta, q, diaClase, fechaClase } o null si aún no se ha entrado a Auditar
  // (q = texto del buscador; diaClase/fechaClase = día de la pestaña "Por clase")
  filtros: null,
  // "A quién citar": todos | alta | media
  nivel: 'todos',
  // "Alertas": nuevas | gestionadas | todas
  filtroAlertas: 'nuevas',
  // "Alertas": todos | mismo_dia | fin_de_semana | licencias | caida
  tipoAlerta: 'todos',
  // "Alertas": todas | alta | media
  prioridadAlerta: 'todas',
};

// Aviso del menú (número rojo sobre "Auditoría"): cuenta las alertas pendientes de este
// período, en todos los cursos. Al hacer clic se abre exactamente esa vista
// (Alertas → Pendientes, sin filtros), así el número coincide con lo que se ve.
export const PERIODO_AVISO = '30dias';
export const RUTA_AVISO = '/auditar?tab=alertas&origen=aviso';
export function prepararAvisoAlertas() {
  memoriaAuditar.filtroAlertas = 'nuevas';
  memoriaAuditar.tipoAlerta = 'todos';
  memoriaAuditar.prioridadAlerta = 'todas';
}
