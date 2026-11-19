import { useEffect, useRef, useState } from 'react';

// Se guarda como registro (mismo formato que el portal), pero deja las fechas SIN justificar:
// para cada día manda el justificativo más reciente.
export const SIN_JUSTIFICAR = 'NO SE HA JUSTIFICADO';

// Tipos de justificativo disponibles. Para agregar o quitar opciones basta con editar esta lista.
const TIPOS_JUSTIFICATIVO = [
  SIN_JUSTIFICAR,
  'EL APODERADO JUSTIFICA CON LICENCIA MÉDICA',
  'EL APODERADO JUSTIFICA PERSONALMENTE',
  'EL APODERADO JUSTIFICA CON CORREO ELECTRÓNICO',
  'EL ALUMNO(A) INGRESA TARDE AL ESTABLECIMIENTO',
  'SUSPENDIDO COMO ACCIÓN DISCIPLINARIA',
];

// Texto corto para mostrar el motivo en las filas de la ficha
const MOTIVOS_CORTOS = {
  'EL APODERADO JUSTIFICA CON LICENCIA MÉDICA': 'Licencia médica',
  'EL APODERADO JUSTIFICA PERSONALMENTE': 'Apoderado en persona',
  'EL APODERADO JUSTIFICA CON CORREO ELECTRÓNICO': 'Correo electrónico',
  'EL ALUMNO(A) INGRESA TARDE AL ESTABLECIMIENTO': 'Ingresa tarde',
  'SUSPENDIDO COMO ACCIÓN DISCIPLINARIA': 'Suspensión',
};
export const motivoCorto = (tipo) => {
  if (!tipo) return '';
  if (MOTIVOS_CORTOS[tipo]) return MOTIVOS_CORTOS[tipo];
  const t = tipo.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Lista desplegable propia: a diferencia del <select> nativo, permite que los textos largos
// hagan salto de línea y que el menú quede siempre dentro del ancho del panel.
function Selector({ id, value, opciones, onChange }) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const raiz = useRef(null);
  const lista = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => { if (!raiz.current?.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  useEffect(() => {
    if (abierto) lista.current?.children[activo]?.scrollIntoView({ block: 'nearest' });
  }, [abierto, activo]);

  const abrir = () => { setActivo(Math.max(0, opciones.indexOf(value))); setAbierto(true); };
  const elegir = (op) => { onChange(op); setAbierto(false); };

  const teclas = (e) => {
    if (!abierto) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((i) => Math.min(opciones.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(opciones[activo]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); setAbierto(false); }
  };

  return (
    <div className="selector" ref={raiz}>
      <button type="button" id={id} className="input selector-btn" aria-haspopup="listbox" aria-expanded={abierto}
        aria-activedescendant={abierto ? `${id}-op-${activo}` : undefined}
        onClick={() => (abierto ? setAbierto(false) : abrir())} onKeyDown={teclas}>
        <span>{value}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {abierto && (
        <ul className="selector-list" role="listbox" ref={lista}>
          {opciones.map((op, i) => (
            <li key={op} id={`${id}-op-${i}`} role="option" aria-selected={op === value}
              className={`${op === value ? 'sel' : ''} ${i === activo ? 'act' : ''}`}
              onMouseEnter={() => setActivo(i)} onClick={() => elegir(op)}>
              {op}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TIPO_ATRASO = 'EL ALUMNO(A) INGRESA TARDE AL ESTABLECIMIENTO';
const TIPO_INASISTENCIA = 'EL APODERADO JUSTIFICA CON LICENCIA MÉDICA';
const TITULOS = { inasistencia: 'Justificar inasistencias', atraso: 'Justificar atrasos' };

// Panel inferior: se abre sobre la misma pantalla, así no hay que cambiar de ventana.
// aplicaA: 'inasistencia' | 'atraso' → el justificativo solo cubre ese tipo de registro.
// quitar: la selección ya estaba justificada → se propone "NO SE HA JUSTIFICADO".
export default function JustifySheet({ abierto, onCerrar, resumen, desde = '', hasta = '', aplicaA, quitar = false, onGuardar }) {
  const tipoInicial = quitar ? SIN_JUSTIFICAR : aplicaA === 'atraso' ? TIPO_ATRASO : TIPO_INASISTENCIA;
  const [tipo, setTipo] = useState(tipoInicial);
  const [fechas, setFechas] = useState({ desde, hasta });
  const inicioRegistro = useRef(null);
  useEffect(() => {
    if (abierto) {
      setFechas({ desde, hasta });
      inicioRegistro.current = performance.now();
    } else {
      inicioRegistro.current = null;
    }
  }, [abierto, desde, hasta]);
  useEffect(() => {
    if (abierto) setTipo(tipoInicial);
  }, [abierto, tipoInicial]);
  // Mientras el panel está abierto se bloquea el scroll de la página de fondo.
  useEffect(() => {
    if (!abierto) return;
    const html = document.documentElement;
    const prev = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev.html;
      document.body.style.overflow = prev.body;
    };
  }, [abierto]);
  if (!abierto) return null;
  const mal = fechas.desde && fechas.hasta && fechas.hasta < fechas.desde;
  const ok = fechas.desde && fechas.hasta && !mal;

  return (
    <div className="overlay" onClick={onCerrar}>
      <form className="sheet" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) {
            const duracionMs = inicioRegistro.current == null
              ? null
              : Math.round(performance.now() - inicioRegistro.current);
            onGuardar?.({ tipo, ...fechas, duracionMs, aplicaA });
          }
        }}>
        <div className="grab" />
        <h2>{quitar ? 'Cambiar justificación' : TITULOS[aplicaA] || 'Agregar justificativo'}</h2>
        {resumen && <p className="muted">{resumen}</p>}
        <div className="field"><label htmlFor="tipo">Tipo</label>
          <Selector id="tipo" value={tipo} opciones={TIPOS_JUSTIFICATIVO} onChange={setTipo} /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="d">Desde</label>
            <input id="d" type="date" className="input" value={fechas.desde} onChange={(e) => setFechas({ ...fechas, desde: e.target.value })} /></div>
          <div className="field"><label htmlFor="h">Hasta</label>
            <input id="h" type="date" className="input" value={fechas.hasta} onChange={(e) => setFechas({ ...fechas, hasta: e.target.value })} /></div>
        </div>
        {mal && <p className="muted" style={{ color: 'var(--bad)' }}>La fecha final debe ser igual o posterior a la inicial.</p>}
        {tipo === SIN_JUSTIFICAR && <p className="muted">Las fechas de este rango quedarán sin justificar.</p>}
        <button className="btn" disabled={!ok}>
          {tipo === SIN_JUSTIFICAR ? 'Marcar como no justificado' : 'Guardar justificativo'}
        </button>
        <button type="button" className="btn ghost" onClick={onCerrar}>Cancelar</button>
      </form>
    </div>
  );
}
