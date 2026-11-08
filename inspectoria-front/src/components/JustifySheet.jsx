import { useState } from 'react';

// Panel inferior: se abre sobre la misma pantalla, así no hay que cambiar de ventana.
export default function JustifySheet({ abierto, onCerrar, resumen, desde = '', hasta = '', onGuardar }) {
  const [tipo, setTipo] = useState('Certificado médico');
  const [fechas, setFechas] = useState({ desde, hasta });
  if (!abierto) return null;
  const mal = fechas.desde && fechas.hasta && fechas.hasta < fechas.desde;
  const ok = fechas.desde && fechas.hasta && !mal;

  return (
    <div className="overlay" onClick={onCerrar}>
      <form className="sheet" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (ok) onGuardar?.({ tipo, ...fechas }); }}>
        <div className="grab" />
        <h2>Nuevo justificativo</h2>
        {resumen && <p className="muted">{resumen}</p>}
        <div className="field"><label htmlFor="tipo">Tipo de documento</label>
          <select id="tipo" className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option>Certificado médico</option><option>Carta de apoderado</option><option>Otro</option>
          </select></div>
        <div className="grid2">
          <div className="field"><label htmlFor="d">Desde</label>
            <input id="d" type="date" className="input" value={fechas.desde} onChange={(e) => setFechas({ ...fechas, desde: e.target.value })} /></div>
          <div className="field"><label htmlFor="h">Hasta</label>
            <input id="h" type="date" className="input" value={fechas.hasta} onChange={(e) => setFechas({ ...fechas, hasta: e.target.value })} /></div>
        </div>
        {mal && <p className="muted" style={{ color: 'var(--bad)' }}>La fecha final debe ser igual o posterior a la inicial.</p>}
        <button className="btn" disabled={!ok}>Guardar justificativo</button>
        <button type="button" className="btn ghost" onClick={onCerrar}>Cancelar</button>
      </form>
    </div>
  );
}
