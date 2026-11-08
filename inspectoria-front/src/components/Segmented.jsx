// Filtro de 2-3 opciones tipo pestañas
export default function Segmented({ opciones, valor, onChange }) {
  return (
    <div className="seg" role="tablist">
      {opciones.map((o) => (
        <button key={o.id} role="tab" aria-selected={valor === o.id} className={valor === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}
