// Botones de filtro rápido (se desplazan en horizontal en móvil)
export default function Chips({ opciones, valor, onChange }) {
  return (
    <div className="chips" role="group">
      {opciones.map((o) => (
        <button key={o.id} type="button" aria-pressed={valor === o.id}
          className={`chip${valor === o.id ? ' on' : ''}`} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}
