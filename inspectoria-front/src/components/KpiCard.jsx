// Tarjeta KPI. valor=null muestra "—" hasta que haya datos.
export default function KpiCard({ sigla, nombre, valor = null, unidad = '%', ayuda, pct = 0 }) {
  return (
    <div className="card kpi">
      <div><h2>{sigla}</h2><p className="muted">{nombre}</p></div>
      <div>
        <div className="val">{valor ?? '—'}{valor != null && unidad}</div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        <p className="muted" style={{ marginTop: 8 }}>{ayuda}</p>
      </div>
    </div>
  );
}
