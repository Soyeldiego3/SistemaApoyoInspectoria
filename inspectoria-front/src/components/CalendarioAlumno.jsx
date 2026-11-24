import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { DIAS, semanasDe } from './CalendarioInasistencias.jsx';
import { fechaLocal, tituloMes } from '../fechas.js';

// '2026-05' → '2026-05-31'
const finDeMes = (clave) => {
  const [anio, m] = clave.split('-').map(Number);
  return fechaLocal(new Date(anio, m, 0));
};

// Meses ('YYYY-MM') con asistencia cargada o con registros, de más antiguo a más reciente
export function mesesConDatos(registros, fechasRegistradas) {
  const meses = new Set([...fechasRegistradas, ...registros.map((r) => r.fecha)].map((f) => f.slice(0, 7)));
  return [...meses].sort();
}

// Ficha del alumno, vista calendario: un mes a la vez, de lunes a domingo.
// Inasistencias en rojo (fuerte = sin justificar, suave = justificada); atrasos en amarillo.
// Al hacer clic en un día se selecciona para justificar, igual que en la vista lista.
// onElegir(claves): alterna la selección de los registros del día (un día puede tener varios atrasos).
export default function CalendarioAlumno({
  vista, registros, fechasRegistradas = [], mes, onCambiarMes, seleccion, onElegir,
}) {
  const meses = mesesConDatos(registros, fechasRegistradas);
  if (!meses.length) return null;
  const actual = meses.includes(mes) ? mes : meses.at(-1);
  const indice = meses.indexOf(actual);

  const esAtraso = vista === 'atrasos';
  const claveDe = (r) => (esAtraso ? r.id_atraso : r.fecha);
  const registradas = new Set(fechasRegistradas);
  const porFecha = new Map();
  for (const r of registros) {
    if (!porFecha.has(r.fecha)) porFecha.set(r.fecha, []);
    porFecha.get(r.fecha).push(r);
  }
  const hoy = fechaLocal(new Date());

  const delMes = registros.filter((r) => r.fecha.startsWith(actual));
  const pendientesMes = delMes.filter((r) => !r.justificado).length;
  const nombre = esAtraso
    ? (delMes.length === 1 ? 'atraso' : 'atrasos')
    : (delMes.length === 1 ? 'inasistencia' : 'inasistencias');

  const celda = (iso, i) => {
    if (!iso) return <div key={`vacio-${i}`} className="calendario-dia vacio" aria-hidden="true" />;
    const numeroDia = Number(iso.slice(8, 10));
    const etiqueta = `${DIAS[i % 7]} ${iso.slice(8, 10)}-${iso.slice(5, 7)}${iso === hoy ? ' (hoy)' : ''}`;
    const claseHoy = iso === hoy ? ' hoy' : '';
    const delDia = porFecha.get(iso);

    if (!delDia) {
      if (registradas.has(iso)) {
        return (
          <div key={iso} className={`calendario-dia presente${claseHoy}`}
            title={`${etiqueta}: ${esAtraso ? 'sin atrasos' : 'presente'}`}>
            <span>{numeroDia}</span>
          </div>
        );
      }
      if (i % 7 >= 5) {
        return (
          <div key={iso} className={`calendario-dia finde${claseHoy}`} title={`${etiqueta}: fin de semana`}>
            <span>{numeroDia}</span>
          </div>
        );
      }
      return (
        <div key={iso} className={`calendario-dia sin-registro${claseHoy}`} title={`${etiqueta}: sin registro`}>
          <span>{numeroDia}</span><b>—</b>
        </div>
      );
    }

    const pendiente = delDia.some((r) => !r.justificado);
    // Lo justificado en el portal no se cambia aquí (igual que en la vista lista)
    const seleccionables = delDia.filter((r) => !r.justificado_portal).map(claveDe);
    const seleccionado = seleccionables.length > 0 && seleccionables.every((c) => seleccion.includes(c));
    const estado = pendiente ? 'Sin just.' : 'Justif.';
    let detalle;
    if (esAtraso) {
      detalle = delDia.length === 1 ? (delDia[0].hora_llegada || '').slice(0, 5) : `${delDia.length} atrasos`;
    } else {
      detalle = estado;
    }
    const motivos = [...new Set(delDia.map((r) => r.motivo).filter(Boolean))].join(', ');
    const texto = `${etiqueta}: ${esAtraso ? (delDia.length === 1 ? 'atraso' : `${delDia.length} atrasos`) : 'inasistencia'}`
      + ` ${pendiente ? 'sin justificar' : 'justificada'}${motivos ? ` (${motivos})` : ''}`;
    const clase = `calendario-dia ${esAtraso ? 'atraso' : 'inasistencia'} ${pendiente ? 'pendiente' : 'justificada'}`
      + `${seleccionado ? ' sel' : ''}${claseHoy}`;
    const contenido = (
      <>
        <span>{numeroDia}</span>
        <b className="calendario-estado">{detalle}</b>
        {esAtraso && <small className="calendario-estado-sub">{estado}</small>}
        {seleccionado && <i className="calendario-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></i>}
      </>
    );
    if (!seleccionables.length) {
      return <div key={iso} className={clase} title={texto}>{contenido}</div>;
    }
    return (
      <button key={iso} type="button" className={clase} aria-pressed={seleccionado}
        title={`${texto} · clic para ${seleccionado ? 'quitar de' : 'agregar a'} la selección`}
        onClick={() => onElegir(seleccionables)}>
        {contenido}
      </button>
    );
  };

  return (
    <section className="card calendario-alumno" role="tabpanel">
      <div className="row">
        <button type="button" className="iconbtn audit-sync" onClick={() => onCambiarMes(meses[indice - 1])}
          disabled={indice === 0} aria-label="Mes anterior">
          <ChevronLeft size={20} />
        </button>
        <div className="calendario-alumno-titulo">
          <b>{tituloMes(actual)}</b>
          <span className="muted">
            {delMes.length ? `${delMes.length} ${nombre}` : `Sin ${esAtraso ? 'atrasos' : 'inasistencias'}`}
            {pendientesMes > 0 && <> · <span style={{ color: 'var(--bad)' }}>{pendientesMes} sin justificar</span></>}
          </span>
        </div>
        <button type="button" className="iconbtn audit-sync" onClick={() => onCambiarMes(meses[indice + 1])}
          disabled={indice === meses.length - 1} aria-label="Mes siguiente">
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="calendario">
        {DIAS.map((d) => <span key={d} className="calendario-cab">{d}</span>)}
        {semanasDe(`${actual}-01`, finDeMes(actual)).flat().map(celda)}
      </div>

      <div className="calendario-alumno-leyenda" aria-hidden="true">
        <span><i className={`${esAtraso ? 'atraso' : 'inasistencia'} pendiente`} />Sin justificar</span>
        <span><i className={`${esAtraso ? 'atraso' : 'inasistencia'} justificada`} />Justificad{esAtraso ? 'o' : 'a'}</span>
        <span><i className="presente" />{esAtraso ? 'Sin atrasos' : 'Presente'}</span>
        <span><i className="sin-registro" />Sin registro</span>
      </div>
    </section>
  );
}
