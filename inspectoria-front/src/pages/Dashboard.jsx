import { Link } from 'react-router-dom';
import KpiCard from '../components/KpiCard.jsx';
import DonutChart from '../components/DonutChart.jsx';
import BarsChart from '../components/BarsChart.jsx';

// Todo en null/[] hasta conectar la API
export default function Dashboard() {
  return (
    <div className="dash">
      <section className="card blue">
        <p className="muted">Hoy</p>
        <div className="big" style={{ margin: '14px 0' }}>—<small>inasistencias</small></div>
        <div className="row">
          <p className="muted">Sin sincronizar todavía</p>
          <Link to="/datos" className="btn dark" style={{ width: 'auto' }}>Sincronizar</Link>
        </div>
      </section>

      <div className="kpis">
        <KpiCard sigla="TSE" nombre="Sincronización exitosa" ayuda="Meta ≥ 95%" />
        <KpiCard sigla="TADR" nombre="Detección de reincidencias" ayuda="Meta 100%" />
        <KpiCard sigla="RTO" nombre="Tiempo por justificativo" unidad=" s" ayuda="Meta < 10 s" />
      </div>

      <Link to="/auditar" className="card row">
        <div><h2>Reincidencias</h2><p className="muted">Alumnos con 3 o más atrasos sin justificar</p></div>
        <span className="tag">—</span>
      </Link>

      <div className="charts">
        <section className="card"><h2>Estado de inasistencias</h2><p className="muted" style={{ marginBottom: 8 }}>Hoy</p><DonutChart /></section>
        <section className="card"><h2>Atrasos por día</h2><p className="muted" style={{ marginBottom: 8 }}>Semana actual</p><BarsChart /></section>
        <section className="card"><h2>Sincronización diaria</h2><p className="muted" style={{ marginBottom: 8 }}>% de ejecuciones sin errores</p><BarsChart dataKey="tse" color="#30d19b" /></section>
      </div>
    </div>
  );
}
