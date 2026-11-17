import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import KpiCard from '../components/KpiCard.jsx';
import DonutChart from '../components/DonutChart.jsx';
import BarsChart from '../components/BarsChart.jsx';
import { getCredencialesPortal, getDashboard, getRedInfo, iniciarSync, setRedEnabled } from '../api.js';

let sincronizacionAutomaticaEjecutada = false;

export default function Dashboard() {
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const [red, setRed] = useState(null);
  const [redCargando, setRedCargando] = useState(false);
  const [syncEstado, setSyncEstado] = useState('cargando');
  const [syncMensaje, setSyncMensaje] = useState('');
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
          setSyncEstado('ok');
          setSyncMensaje('Datos sincronizados correctamente.');
          await cargarDashboard(() => activo);
        }
      } catch (error) {
        if (!activo) return;
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

  useEffect(() => {
    if (!esPc) return undefined;
    let activo = true;
    getRedInfo()
      .then((info) => { if (activo) setRed(info); })
      .catch((error) => {
        if (activo) setSyncMensaje(error.message || 'No se pudo consultar el acceso en red.');
      });
    return () => { activo = false; };
  }, [esPc]);

  const cambiarRed = async (habilitada) => {
    setRedCargando(true);
    try {
      const info = await setRedEnabled(habilitada);
      setRed(info);
    } catch (error) {
      setSyncMensaje(error.message || 'No se pudo cambiar el acceso en red.');
      setSyncEstado('error');
    } finally {
      setRedCargando(false);
    }
  };

  const copiarUrl = async () => {
    if (!red?.principal) return;
    try {
      await navigator.clipboard.writeText(red.principal);
      setSyncMensaje('URL copiada.');
    } catch {
      setSyncMensaje('No se pudo copiar la URL. Cópiala manualmente.');
    }
  };

  return (
    <div className="dash">
      {esPc && (
        <section className="card">
          <div className="row">
            <div>
              <h2>Conectar desde el teléfono</h2>
              <p className="muted">El PC y el teléfono deben estar en la misma red.</p>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={Boolean(red?.habilitada)} disabled={redCargando || !red}
                onChange={(e) => cambiarRed(e.target.checked)} />
              Acceso en red
            </label>
          </div>
          {red?.habilitada && red.principal ? (
            <div className="row" style={{ alignItems: 'center', marginTop: 16 }}>
              <div>
                <p className="big" style={{ fontSize: '1.2rem', margin: 0 }}>{red.principal}</p>
                <button className="btn ghost" onClick={copiarUrl} style={{ marginTop: 10 }}>
                  <Copy size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Copiar URL
                </button>
              </div>
              <QRCodeCanvas value={red.principal} size={140} includeMargin />
            </div>
          ) : red ? (
            <p className="muted" style={{ marginTop: 16 }}>Activa el acceso en red para mostrar una URL y un código QR.</p>
          ) : (
            <p className="muted" style={{ marginTop: 16 }}>Cargando configuración de red…</p>
          )}
        </section>
      )}

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
          <Link to="/datos" state={{ abrirCredenciales: syncEstado === 'requiere' || syncEstado === 'error' }}
            className="btn dark" style={{ width: 'auto' }}>
            {syncEstado === 'error' ? <><RefreshCw size={15} style={{ verticalAlign: -2, marginRight: 5 }} />Reintentar</> :
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
