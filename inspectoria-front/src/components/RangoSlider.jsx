import { useState } from 'react';

// Slider de rango con dos manijas (mínimo y máximo), como los filtros de precio.
// Son dos <input type="range"> superpuestos: el tramo elegido se pinta entre ambos
// y sobre la manija que se mueve aparece una burbuja con el valor.
export default function RangoSlider({ min, max, desde, hasta, onChange, etiqueta, unidad = '' }) {
  const [activa, setActiva] = useState(null); // 'desde' | 'hasta' | null
  const total = Math.max(max - min, 1);
  const pct = (v) => ((v - min) / total) * 100;
  // Compensa el ancho de la manija (18px) para que la burbuja quede centrada sobre ella
  const izquierda = (v) => `calc(${pct(v)}% + ${9 - pct(v) * 0.18}px)`;

  const cambiarDesde = (v) => onChange({ desde: Math.min(v, hasta), hasta });
  const cambiarHasta = (v) => onChange({ desde, hasta: Math.max(v, desde) });
  const soltar = () => setActiva(null);

  const manija = (cual, valor, cambiar) => (
    <input type="range" min={min} max={max} step={1} value={valor}
      aria-label={`${etiqueta}: ${cual === 'desde' ? 'mínimo' : 'máximo'}`}
      onChange={(e) => cambiar(Number(e.target.value))}
      onPointerDown={() => setActiva(cual)} onPointerUp={soltar}
      onFocus={() => setActiva(cual)} onBlur={soltar}
      // Si ambas manijas están juntas al final, la de "desde" queda encima para poder moverla
      style={{ zIndex: cual === 'desde' && desde >= max - (max - min) * 0.05 ? 3 : 2 }} />
  );

  return (
    <div className="rango">
      <div className="rango-cabecera">
        <span>{etiqueta}</span>
        <b>{desde === hasta ? `${desde}` : `${desde} a ${hasta}`}{unidad ? ` ${unidad}` : ''}</b>
      </div>
      <div className="rango-pista">
        <div className="rango-fondo" />
        <div className="rango-tramo" style={{ left: izquierda(desde), right: `calc(100% - ${izquierda(hasta)})` }} />
        {activa && (
          <span className="rango-burbuja" style={{ left: izquierda(activa === 'desde' ? desde : hasta) }}>
            {activa === 'desde' ? desde : hasta}
          </span>
        )}
        {manija('desde', desde, cambiarDesde)}
        {manija('hasta', hasta, cambiarHasta)}
      </div>
      <div className="rango-limites muted"><span>{min}</span><span>{max}</span></div>
    </div>
  );
}
