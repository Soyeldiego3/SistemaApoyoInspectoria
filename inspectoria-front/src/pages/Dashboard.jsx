import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import KpiCard from '../components/KpiCard.jsx';
import DonutChart from '../components/DonutChart.jsx';
import BarsChart from '../components/BarsChart.jsx';
import { getDashboard } from '../api.js';
import {
  ERRORES_LOGIN, esPc, intentarSync, irACredenciales, registrarSync, ultimaSync,
} from '../portal.js';

export default function Dashboard() {
  const navigate = useNavigate();
  const [syncEstado, setSyncEstado] = useState('cargando');
  const [syncMensaje, setSyncMensaje] = useState('');
  const activoRef = useRef(true);
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

  // Muestra el resultado de una sincronización (la automática, un reintento o una hecha en otra
  // pantalla). Devuelve el resultado, o null si Inicio ya no está montado.
  const aplicarSync = async (promesa) => {
    const resultado = await promesa;
    if (!activoRef.current) return null;
    setSyncEstado(resultado.estado);
    setSyncMensaje(resultado.mensaje);
    if (resultado.estado !== 'requiere') cargarDashboard(() => activoRef.current);
    return resultado;
  };

  useEffect(() => {
    activoRef.current = true;
    if (!esPc) {
      setSyncEstado('sinDatos');
    } else {
      // La automática corre una vez por sesión; si otra pantalla sincronizó después, se ve eso
      aplicarSync(ultimaSync() || registrarSync(intentarSync()));
    }
    return () => { activoRef.current = false; };
  }, []);

  // Reintenta aquí mismo; solo si el problema son las credenciales se va a Ajustes
  // (allí, al guardarlas, se sincroniza solo)
  const reintentar = async () => {
    setSyncEstado('cargando');
    const resultado = await aplicarSync(registrarSync(intentarSync()));
    if (resultado && (resultado.estado === 'requiere' || ERRORES_LOGIN.includes(resultado.codigo))) {
      irACredenciales(navigate, resultado.mensaje || 'Configura las credenciales del portal para sincronizar.');
    }
  };

  return (
    <div className="dash">
      <section className="card blue">
        <p className="muted">Esta semana</p>
        <div className="big" style={{ margin: '14px 0' }}>
          {datosDashboard?.inasistenciasSemana ?? '—'}<small>inasistencias</small>
        </div>
        <div className="row inicio-fila">
          <p className="muted">
            {syncEstado === 'cargando' ? 'Sincronizando…' :
              syncEstado === 'ok' ? syncMensaje :
              !esPc ? 'Los datos se sincronizan desde el PC' :
              syncEstado === 'requiere' ? 'Sin datos. Configura las credenciales para sincronizar' :
              syncEstado === 'error' ? 'No se pudo sincronizar' :
              'Sin datos sincronizados todavía'}
          </p>
          <div className="inicio-acciones">
            {syncEstado === 'error' || (esPc && syncEstado === 'cargando') ? (
              <button type="button" className="btn dark" style={{ width: 'auto' }}
                onClick={reintentar} disabled={syncEstado === 'cargando'}>
                <RefreshCw size={15} className={syncEstado === 'cargando' ? 'audit-spin' : undefined}
                  style={{ verticalAlign: -2, marginRight: 5 }} />
                {syncEstado === 'cargando' ? 'Sincronizando…' : 'Reintentar'}
              </button>
            ) : (
              <Link to="/ajustes" state={{ abrirCredenciales: syncEstado === 'requiere', accionModal: 'sync' }}
                className="btn dark" style={{ width: 'auto' }}>
                {syncEstado === 'requiere' ? 'Configurar credenciales' : 'Ir a Sincronizar'}
              </Link>
            )}
          </div>
        </div>
      </section>
      {(syncEstado === 'error' || syncEstado === 'requiere') && syncMensaje && (
        <p className="msg error" role="alert">{syncMensaje}</p>
      )}
      {errorDashboard && <p className="msg error" role="alert">{errorDashboard}</p>}

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

      <Link to="/alumnos?filtro=atrasos3"className="card row">
        <div><h2>Reincidencias</h2><p className="muted">Alumnos con 3 o más atrasos sin justificar</p></div>
        <span className="tag">{datosDashboard?.reincidencias ?? '—'}</span>
      </Link>

      <div className="charts">
        <section className="card"><h2>Estado de inasistencias</h2><p className="muted" style={{ marginBottom: 8 }}>Hoy</p><DonutChart data={datosDashboard?.inasistencias || []} /></section>
        <section className="card"><h2>Atrasos por día</h2><p className="muted" style={{ marginBottom: 8 }}>Semana actual</p><BarsChart data={datosDashboard?.atrasos || []} /></section>
        <section className="card"><h2>Sincronización diaria</h2><p className="muted" style={{ marginBottom: 8 }}>% de ejecuciones sin errores</p><BarsChart data={datosDashboard?.sincronizaciones || []} dataKey="tse" color="ok" /></section>
      </div>
    </div>
  );
}
