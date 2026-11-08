// Fila clave del sistema: asistencia + justificativo en la MISMA línea.
// estado: 'ausente' | 'atraso' | 'presente'   justificado: boolean
const estadoTag = { ausente: ['Ausente', 'bad'], atraso: ['Atraso', 'warn'], presente: ['Presente', 'ok'] };

export default function AttendanceRow({ titulo, detalle, estado, justificado, seleccionable, seleccionado, onClick }) {
  const [txt, tono] = estadoTag[estado] || ['—', ''];
  return (
    <button type="button" className={`item rowbtn${seleccionado ? ' sel' : ''}`} onClick={onClick}>
      <div style={{ textAlign: 'left' }}>
        <b>{titulo}</b>
        {detalle && <span className="muted">{detalle}</span>}
      </div>
      <div className="tags">
        <span className={`tag ${tono}`}>{txt}</span>
        {estado !== 'presente' && (
          <span className={`tag ${justificado ? 'ok' : 'bad'}`}>{justificado ? 'Justificado' : 'Sin justificar'}</span>
        )}
        {seleccionable && <span className={`check${seleccionado ? ' on' : ''}`} aria-hidden />}
      </div>
    </button>
  );
}
