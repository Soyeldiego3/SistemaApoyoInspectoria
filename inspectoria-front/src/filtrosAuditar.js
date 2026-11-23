// Memoria de los filtros de Auditar mientras la app siga abierta (se pierde al cerrarla).
// Así, al ir a otra sección y volver, Auditar queda donde estaba: pestaña, curso, tipo,
// período y los filtros internos de cada pestaña.
export const memoriaAuditar = {
  // { tab, tipo, curso, periodo, desde, hasta, q } o null si aún no se ha entrado a Auditar
  // (q = texto del buscador)
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

export const hayFiltrosAuditar = () => Boolean(memoriaAuditar.filtros);
