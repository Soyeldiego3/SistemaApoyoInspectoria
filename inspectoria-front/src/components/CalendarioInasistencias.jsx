import NumberFlow from '@number-flow/react';
import { Skeleton } from './Skeleton.jsx';
import { fechaLocal } from '../fechas.js';

export const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
// Opacidad de cada nivel de intensidad (también la usa la leyenda, así coinciden)
const NIVELES = [0.35, 0.55, 0.75, 1];

// "2026-11-03" como fecha local (sin desfase de zona horaria)
const aFecha = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

// Semanas de lunes a domingo que cubren desde..hasta; los días fuera del período quedan en null.
export function semanasDe(desde, hasta) {
  const inicio = aFecha(desde);
  inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7)); // lunes de la primera semana
  const semanas = [];
  for (const lunes = inicio; fechaLocal(lunes) <= hasta; lunes.setDate(lunes.getDate() + 7)) {
    semanas.push(DIAS.map((_, i) => {
      const dia = new Date(lunes);
      dia.setDate(lunes.getDate() + i);
      const iso = fechaLocal(dia);
      return iso >= desde && iso <= hasta ? iso : null;
    }));
  }
  return semanas;
}

// Calendario de inasistencias (Gráficos): una fila por semana, color más intenso = más inasistencias.
// dias: [{ fecha, inasistencias }] solo con los días que tienen registro de asistencia.
// onElegirDia(fecha): se llama al hacer clic en un día con inasistencias (abre la lista de alumnos).
export default function CalendarioInasistencias({ desde, hasta, dias = [], onElegirDia }) {
  if (!dias.length || !desde || !hasta) return <Skeleton h={160} />;
  const porFecha = new Map(dias.map((d) => [d.fecha, d.inasistencias]));
  const maximo = Math.max(1, ...dias.map((d) => d.inasistencias));
  const hoy = fechaLocal(new Date());

  return (
    <div>
      <div className="calendario">
        {DIAS.map((d) => <span key={d} className="calendario-cab">{d}</span>)}
        {semanasDe(desde, hasta).flat().map((iso, i) => {
          if (!iso) return <div key={`vacio-${i}`} className="calendario-dia vacio" aria-hidden="true" />;
          const esHoy = iso === hoy;
          const etiqueta = `${DIAS[i % 7]} ${iso.slice(8, 10)}-${iso.slice(5, 7)}${esHoy ? ' (hoy)' : ''}`;
          const numeroDia = Number(iso.slice(8, 10));
          const claseHoy = esHoy ? ' hoy' : '';
          if (!porFecha.has(iso)) {
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
          const n = porFecha.get(iso);
          const nivel = n > 0 ? Math.min(3, Math.ceil(n / maximo * 4) - 1) : -1;
          const texto = `${etiqueta}: ${n} ${n === 1 ? 'inasistencia' : 'inasistencias'}`;
          const contenido = (
            <>
              {nivel >= 0 && <i className="intensidad" style={{ opacity: NIVELES[nivel] }} />}
              <span style={nivel >= 2 ? { color: 'var(--on-accent)' } : undefined}>{numeroDia}</span>
              <b style={nivel >= 2 ? { color: 'var(--on-accent)' } : undefined}><NumberFlow value={n} /> <small className="calendario-unidad">inas.</small></b>
            </>
          );
          // Solo los días con inasistencias se pueden abrir para ver los alumnos
          if (n > 0 && onElegirDia) {
            return (
              <button key={iso} type="button" className={`calendario-dia${claseHoy}`}
                title={`${texto} · clic para ver alumnos`} onClick={() => onElegirDia(iso)}>
                {contenido}
              </button>
            );
          }
          return (
            <div key={iso} className={`calendario-dia${claseHoy}`} title={texto}>
              {contenido}
            </div>
          );
        })}
      </div>
      <div className="calendario-leyenda" aria-hidden="true">
        Menos {NIVELES.map((o) => <i key={o} style={{ opacity: o }} />)} Más inasistencias
      </div>
    </div>
  );
}
