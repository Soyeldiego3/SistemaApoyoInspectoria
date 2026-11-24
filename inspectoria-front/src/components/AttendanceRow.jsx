import { diaSemana, fechaCorta, partesFecha } from '../fechas.js';

// Fila de la ficha del alumno: calendario (día + mes), día de la semana, fecha y motivo,
// y a la derecha la hora (atrasos), el estado de justificación y el check de selección.
export default function AttendanceRow({
  fecha, motivo, hora, justificado, textoJustificado = 'Justificado',
  seleccionable, seleccionado, onClick,
}) {
  const { dia, mesCorto } = partesFecha(fecha);
  const detalle = [fechaCorta(fecha), justificado && motivo].filter(Boolean).join(' · ');
  return (
    <button type="button" className={`item rowbtn${seleccionado ? ' sel' : ''}`} onClick={onClick}
      aria-pressed={seleccionable ? seleccionado : undefined}>
      <div className="fila-fecha">
        <div className={`cal${justificado ? '' : ' pendiente'}`} aria-hidden="true">
          <b>{dia}</b><span>{mesCorto}</span>
        </div>
        <div>
          <b>{diaSemana(fecha)}</b>
          <span className="muted">{detalle}</span>
        </div>
      </div>
      <div className="tags">
        {hora && <span className="tag">{hora}</span>}
        <span className={`tag ${justificado ? 'ok' : 'bad'}`}>{justificado ? textoJustificado : 'Sin justificar'}</span>
        {seleccionable && <span className={`check${seleccionado ? ' on' : ''}`} aria-hidden />}
      </div>
    </button>
  );
}
