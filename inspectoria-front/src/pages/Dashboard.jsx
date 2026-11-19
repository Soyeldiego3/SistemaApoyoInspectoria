import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import KpiCard from '../components/KpiCard.jsx';
import DonutChart from '../components/DonutChart.jsx';
import BarsChart from '../components/BarsChart.jsx';
import { getCredencialesPortal, getDashboard, iniciarSync } from '../api.js';

let sincronizacionAutomaticaEjecutada = false;

export default function Dashboard() {
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const [syncEstado, setSyncEstado] = useState('cargando');
  const [syncMensaje, setSyncMensaje] = useState('');
  const [syncCodigo, setSyncCodigo] = useState('');
  const [datosDashboard, setDatosDashboard] = useState(null);
  const [errorDashboard, setErrorDashboard] = useState('');

  const cargarDashboard = async (estaActivo = () => true) => {
    try {
      const datos = await getDashboard();
      if (estaActivo()) {
        setDatosDashboard(datos);
        setErrorDashboard('');
      }
    } catch (error) {
      if (estaActivo()) setErrorDashboard(error.message || 'No se pudieron cargar los gráficos.');
    }
  };

  useEffect(() => {
    let activo = true;
    cargarDashboard(() => activo);
    return () => { activo = false; };
  }, []);

  useEffect(() => {
    if (!esPc || sincronizacionAutomaticaEjecutada) {
      if (!esPc) setSyncEstado('sinDatos');
      return undefined;
    }
    sincronizacionAutomaticaEjecutada = true;
    let activo = true;
    const sincronizarAutomaticamente = async () => {
      try {
        const credenciales = await getCredencialesPortal();
        if (!activo) return;
        if (!credenciales.guardadas || credenciales.invalidas) {
          setSyncEstado('requiere');
          if (credenciales.invalidas) {
            setSyncMensaje('Las credenciales guardadas están inválidas. Actualízalas para sincronizar.');
          }
          return;
        }
        await iniciarSync();
        if (activo) {
          setSyncCodigo('');
          setSyncEstado('ok');
          setSyncMensaje('Datos sincronizados correctamente.');
          await cargarDashboard(() => activo);
        }
      } catch (error) {
        if (!activo) return;
        setSyncCodigo(error.code || '');
        if (error.code === 'CREDENCIALES_REQUERIDAS' || error.code === 'LOGIN_RECHAZADO') {
          setSyncEstado('error');
          setSyncMensaje(error.message || 'No se pudo iniciar sesión en el portal.');
        } else {
          setSyncEstado('error');
          setSyncMensaje(error.message || 'No se pudo sincronizar. Puedes reintentar desde Datos.');
        }
        await cargarDashboard(() => activo);
      }
    };
    sincronizarAutomaticamente();
    return () => { activo = false; };
  }, [esPc]);

  return (
    <div className="dash">
      <section className="card blue">
        <p className="muted">Esta semana</p>
        <div className="big" style={{ margin: '14px 0' }}>
          {datosDashboard?.inasistenciasSemana ?? '—'}<small>inasistencias</small>
        </div>
        <div className="row">
          <p className="muted">
            {syncEstado === 'cargando' ? 'Sincronizando…' :
              syncEstado === 'ok' ? syncMensaje :
              !esPc ? 'Los datos se sincronizan desde el PC' :
              syncEstado === 'requiere' ? 'Sin datos. Configura las credenciales para sincronizar' :
              'Sin datos sincronizados todavía'}
          </p>
          <Link to="/datos" state={{
            abrirCredenciales: syncEstado === 'requiere' || syncEstado === 'error',
            accionModal: syncEstado === 'error' ? 'guardar' : 'sync',
            mensaje: syncEstado === 'error' ? syncMensaje : '',
          }}
            className="btn dark" style={{ width: 'auto' }}>
            {syncEstado === 'error' ? <><RefreshCw size={15} style={{ verticalAlign: -2, marginRight: 5 }} />
              {syncCodigo === 'LOGIN_RECHAZADO' || syncCodigo === 'CREDENCIALES_REQUERIDAS'
                ? 'Actualizar credenciales' : 'Reintentar'}</> :
              syncEstado === 'requiere' ? 'Configurar credenciales' : 'Sincronizar'}
          </Link>
        </div>
      </section>
      {syncEstado === 'requiere' && syncMensaje && (
        <p className="msg" style={{ color: 'var(--bad)' }} role="alert">{syncMensaje}</p>
      )}
      {syncEstado === 'error' && <p className="msg" style={{ color: 'var(--bad)' }} role="alert">{syncMensaje}</p>}
      {errorDashboard && <p className="msg" style={{ color: 'var(--bad)' }} role="alert">{errorDashboard}</p>}

      <div className="kpis">
        <KpiCard sigla="TSE" nombre="Sincronización exitosa"
          valor={datosDashboard?.kpis?.tse.valor ?? null} pct={datosDashboard?.kpis?.tse.valor ?? 0}
          ayuda={datosDashboard?.kpis?.tse.ayuda || 'Meta ≥ 95%'} />
        <KpiCard sigla="TADR" nombre="Detección de reincidencias"
          valor={datosDashboard?.kpis?.tadr.valor ?? null} pct={datosDashboard?.kpis?.tadr.valor ?? 0}
          ayuda={datosDashboard?.kpis?.tadr.ayuda || 'Meta 100%'} />
        <KpiCard sigla="RTO" nombre="Tiempo por justificativo" unidad=" s"
          valor={datosDashboard?.kpis?.rto.valor ?? null} pct={datosDashboard?.kpis?.rto.pct ?? 0}
          ayuda={datosDashboard?.kpis?.rto.ayuda || 'Meta < 10 s'} />
      </div>

      <Link to="/auditar" className="card row">
        <div><h2>Reincidencias</h2><p className="muted">Alumnos con 3 o más atrasos sin justificar</p></div>
        <span className="tag">{datosDashboard?.reincidencias ?? '—'}</span>
      </Link>

      <div className="charts">
        <section className="card"><h2>Estado de inasistencias</h2><p className="muted" style={{ marginBottom: 8 }}>Hoy</p><DonutChart data={datosDashboard?.inasistencias || []} /></section>
        <section className="card"><h2>Atrasos por día</h2><p className="muted" style={{ marginBottom: 8 }}>Semana actual</p><BarsChart data={datosDashboard?.atrasos || []} /></section>
        <section className="card"><h2>Sincronización diaria</h2><p className="muted" style={{ marginBottom: 8 }}>% de ejecuciones sin errores</p><BarsChart data={datosDashboard?.sincronizaciones || []} dataKey="tse" color="#30d19b" /></section>
      </div>
    </div>
  );
}
