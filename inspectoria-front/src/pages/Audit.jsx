import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Segmented from '../components/Segmented.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import {
  getAuditoriaCursos,
  getAuditoriaEstado,
  getAuditoriaPrioridad,
  getCredencialesPortal,
  getCursos,
  iniciarSync,
} from '../api.js';

const TABS = [
  { id: 'prioridad', label: 'A quién citar' },
  { id: 'cursos', label: 'Comparar cursos' },
];

const TIPOS = [
  { id: 'ambos', label: 'Ambos' },
  { id: 'inasistencias', label: 'Inasistencias' },
  { id: 'atrasos', label: 'Atrasos' },
];

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'personalizado', label: 'Personalizado…' },
];

const MENSAJES_PORTAL = {
  LOGIN_RECHAZADO: 'El portal rechazó el usuario o la contraseña',
  PORTAL_INACCESIBLE: 'No se pudo conectar con el portal; revisa la red o la URL',
  NAVEGADOR_NO_DISPONIBLE: 'No se encontró Microsoft Edge',
  ESTRUCTURA_CAMBIADA: 'El portal cambió y no se pudo extraer la información',
};

const fechaLocal = (fecha) => {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

function rangoPeriodo(periodo, personalizadoDesde = '', personalizadoHasta = '') {
  const hoy = new Date();
  const fin = fechaLocal(hoy);
  if (periodo === 'ayer') {
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    const fecha = fechaLocal(ayer);
    return { desde: fecha, hasta: fecha };
  }
  if (periodo === 'semana') {
    const inicio = new Date(hoy);
    inicio.setDate(hoy.getDate() - (hoy.getDay() === 0 ? 6 : hoy.getDay() - 1));
    return { desde: fechaLocal(inicio), hasta: fin };
  }
  if (periodo === 'mes') {
    return { desde: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`, hasta: fin };
  }
  if (periodo === 'personalizado') {
    return { desde: personalizadoDesde, hasta: personalizadoHasta };
  }
  return { desde: fin, hasta: fin };
}

function mostrarRango(datos) {
  if (!datos?.rango?.desde || !datos?.rango?.hasta) return 'Sin rango con datos suficientes';
  return `${datos.rango.desde} a ${datos.rango.hasta}`;
}

function haceCuanto(fechaIso) {
  if (!fechaIso) return null;
  const diferencia = Date.now() - new Date(fechaIso).getTime();
  if (!Number.isFinite(diferencia) || diferencia < 0) return 'recién';
  const minutos = Math.floor(diferencia / 60000);
  if (minutos < 1) return 'hace menos de 1 minuto';
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} hora${horas === 1 ? '' : 's'}`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} día${dias === 1 ? '' : 's'}`;
}

function Resumen({ datos }) {
  const resumen = datos?.resumen;
  const porcentaje = resumen?.incidencias
    ? `${((resumen.sinJustificar / resumen.incidencias) * 100).toFixed(1)}%`
    : '—';
  return (
    <div className="kpis">
      <section className="card"><p className="muted">Incidencias</p><div className="big">{resumen?.incidencias ?? '—'}</div></section>
      <section className="card"><p className="muted">% sin justificar</p><div className="big">{porcentaje}</div></section>
      <section className="card"><p className="muted">Alumnos afectados</p><div className="big">{resumen?.alumnosAfectados ?? '—'}</div></section>
    </div>
  );
}

function Avisos({ datos }) {
  return datos?.advertencias?.length
    ? <div className="msg" role="status">{datos.advertencias.map((aviso) => <p key={aviso}>{aviso}</p>)}</div>
    : null;
}

function Prioridad({ datos }) {
  if (!datos?.alumnos?.length) return <EmptyState texto="Sin datos en este rango." filas={3} />;
  return (
    <div className="list">
      {datos.alumnos.map((alumno) => (
        <Link key={alumno.rut} to={`/alumnos/${encodeURIComponent(alumno.rut)}`} className="item">
          <div>
            <b>{alumno.nombres} {alumno.apellidos}</b>
            <span className="muted">{alumno.curso} · {alumno.rut}</span>
            <span className="muted">{alumno.motivo || 'Sin señales pendientes.'}</span>
          </div>
          <div className="tags"><span className="tag bad">Puntaje {alumno.puntaje}</span></div>
        </Link>
      ))}
    </div>
  );
}

function Cursos({ datos }) {
  if (!datos?.cursos?.length) return <EmptyState texto="Sin datos en este rango." filas={3} />;
  return (
    <div className="list">
      {datos.cursos.map((curso) => (
        <section className="item" key={curso.curso}>
          <div>
            <b>{curso.curso}</b>
            <span className="muted">Sobre {curso.denominador} registros · {curso.diasRegistrados} días · {curso.alumnosMatriculados} alumnos</span>
            {curso.pocosDatos && <span className="tag warn">Pocos datos</span>}
          </div>
          <div className="tags">
            <span className="tag">Inasistencia {curso.porcentajeInasistencia == null ? '—' : `${curso.porcentajeInasistencia}%`}</span>
            <span className="tag">Atrasos {curso.porcentajeAtrasos == null ? '—' : `${curso.porcentajeAtrasos}%`}</span>
            <span className="tag warn">Sin justificar {curso.porcentajeSinJustificar == null ? '—' : `${curso.porcentajeSinJustificar}%`}</span>
            <span className="tag">Desvío {curso.desviacionPromedio == null ? '—' : `${curso.desviacionPromedio} pp`}</span>
          </div>
        </section>
      ))}
    </div>
  );
}

export default function Audit() {
  const navigate = useNavigate();
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const [tab, setTab] = useState('prioridad');
  const [tipo, setTipo] = useState('ambos');
  const [curso, setCurso] = useState('');
  const [periodo, setPeriodo] = useState('hoy');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [cursos, setCursos] = useState([]);
  const [datos, setDatos] = useState(null);
  const [estadoDatos, setEstadoDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState('');
  const [avisoRango, setAvisoRango] = useState('');
  const consultaAbortRef = useRef(null);
  const syncAbortRef = useRef(null);

  const cargarResultados = async (parametros, signal) => {
    const respuesta = await (tab === 'prioridad'
      ? getAuditoriaPrioridad(parametros, { signal })
      : getAuditoriaCursos(parametros, { signal }));
    if (!signal?.aborted) setDatos(respuesta);
  };

  useEffect(() => {
    let activo = true;
    Promise.all([getCursos(), getAuditoriaEstado()])
      .then(([cursosRespuesta, estado]) => {
        if (!activo) return;
        setCursos(cursosRespuesta.cursos || []);
        setEstadoDatos(estado);
        const hoy = fechaLocal(new Date());
        const ultima = [estado.ultimaFechaAsistencia, estado.ultimaFechaAtrasos]
          .filter(Boolean)
          .sort()
          .at(-1) || null;
        if (!ultima) {
          setPeriodo('hoy');
          setDesde(hoy);
          setHasta(hoy);
          setCargando(false);
          return;
        }
        if (ultima === hoy || [estado.ultimaFechaAsistencia, estado.ultimaFechaAtrasos].includes(hoy)) {
          setPeriodo('hoy');
          setDesde(hoy);
          setHasta(hoy);
        } else {
          setPeriodo('personalizado');
          setDesde(ultima);
          setHasta(ultima);
          setAvisoRango(`Mostrando el ${ultima.split('-').reverse().join('/')}, último día sincronizado`);
        }
      })
      .catch((e) => {
        if (activo) {
          setError(e.message || 'No se pudo cargar el estado de los datos.');
          setCargando(false);
        }
      });
    return () => { activo = false; };
  }, []);

  const parametros = useMemo(() => {
    const rango = rangoPeriodo(periodo, desde, hasta);
    const resultado = { tipo };
    if (curso) resultado.curso = curso;
    if (rango.desde) resultado.desde = rango.desde;
    if (rango.hasta) resultado.hasta = rango.hasta;
    return resultado;
  }, [curso, desde, hasta, periodo, tipo]);

  useEffect(() => {
    if (!desde && !hasta && periodo === 'hoy') return undefined;
    const temporizador = setTimeout(() => {
      consultaAbortRef.current?.abort();
      const controller = new AbortController();
      consultaAbortRef.current = controller;
      setCargando(true);
      setError('');
      cargarResultados(parametros, controller.signal)
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message || 'No se pudo calcular la auditoría.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setCargando(false);
        });
    }, 180);
    return () => {
      clearTimeout(temporizador);
      consultaAbortRef.current?.abort();
    };
  }, [parametros, tab]);

  useEffect(() => () => {
    consultaAbortRef.current?.abort();
    syncAbortRef.current?.abort();
  }, []);

  const cambiarPeriodo = (nuevoPeriodo) => {
    setPeriodo(nuevoPeriodo);
    setAvisoRango('');
    if (nuevoPeriodo !== 'personalizado') {
      const rango = rangoPeriodo(nuevoPeriodo);
      setDesde(rango.desde);
      setHasta(rango.hasta);
    }
  };

  const sincronizar = async () => {
    setSincronizando(true);
    setError('');
    syncAbortRef.current?.abort();
    const controller = new AbortController();
    syncAbortRef.current = controller;
    try {
      if (!esPc) {
        await iniciarSync(undefined, { signal: controller.signal });
        const estado = await getAuditoriaEstado({ signal: controller.signal });
        setEstadoDatos(estado);
        const hoy = fechaLocal(new Date());
        setPeriodo('hoy');
        setDesde(hoy);
        setHasta(hoy);
        setAvisoRango('');
        return;
      }
      const credenciales = await getCredencialesPortal();
      if (!credenciales.guardadas && !credenciales.enMemoria) {
        if (esPc) {
          navigate('/datos', {
            replace: false,
            state: { abrirCredenciales: true, accionModal: 'guardar', mensaje: 'Configura las credenciales del portal para sincronizar.' },
          });
        } else {
          setError('Sincroniza desde el PC.');
        }
        return;
      }
      if (credenciales.invalidas) {
        if (esPc) {
          navigate('/datos', {
            replace: false,
            state: { abrirCredenciales: true, accionModal: 'guardar', mensaje: 'Las credenciales guardadas están inválidas. Actualízalas para continuar.' },
          });
        } else {
          setError('Las credenciales no son válidas. Sincroniza desde el PC.');
        }
        return;
      }
      await iniciarSync(undefined, { signal: controller.signal });
      const estado = await getAuditoriaEstado({ signal: controller.signal });
      setEstadoDatos(estado);
      const hoy = fechaLocal(new Date());
      setPeriodo('hoy');
      setDesde(hoy);
      setHasta(hoy);
      setAvisoRango('');
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (!esPc && (e.code === 'CREDENCIALES_REQUERIDAS' || e.code === 'LOGIN_RECHAZADO')) {
        setError('Sincroniza desde el PC.');
      } else if (!esPc) {
        setError(MENSAJES_PORTAL[e.code] || e.message || 'No se pudo sincronizar.');
      } else if (MENSAJES_PORTAL[e.code]) {
        setError(MENSAJES_PORTAL[e.code]);
        if (esPc && (e.code === 'LOGIN_RECHAZADO' || e.code === 'CREDENCIALES_REQUERIDAS')) {
          navigate('/datos', {
            replace: false,
            state: { abrirCredenciales: true, accionModal: 'guardar', mensaje: MENSAJES_PORTAL[e.code] },
          });
        }
      } else {
        setError(e.message || 'Ocurrió un error inesperado.');
      }
    } finally {
      setSincronizando(false);
    }
  };

  const tieneDatos = Boolean(estadoDatos?.ultimaFechaAsistencia || estadoDatos?.ultimaFechaAtrasos);
  const ultimaTexto = haceCuanto(estadoDatos?.ultimaSincronizacionExitosa);

  return (
    <>
      <div className="audit-header">
        <h2>Auditar</h2>
      </div>

      <section className="card audit-filters" aria-label="Filtros de auditoría">
        <div className="audit-filter-grid">
          <select className="input" value={curso} onChange={(e) => setCurso(e.target.value)} aria-label="Curso">
            <option value="">Todos los cursos</option>
            {cursos.map((opcion) => <option key={opcion.curso} value={opcion.curso}>{opcion.curso}</option>)}
          </select>
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
            {TIPOS.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.label}</option>)}
          </select>
          <select className="input" value={periodo} onChange={(e) => cambiarPeriodo(e.target.value)} aria-label="Período">
            {PERIODOS.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.label}</option>)}
          </select>
        </div>
        {periodo === 'personalizado' && (
          <div className="audit-custom-dates">
            <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Fecha desde" />
            <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Fecha hasta" />
          </div>
        )}
      </section>

      <Segmented valor={tab} onChange={setTab} opciones={TABS} />

      {ultimaTexto && <p className="muted audit-last-sync">Última sincronización: {ultimaTexto}</p>}
      {avisoRango && <p className="msg" role="status">{avisoRango}</p>}
      {datos && <p className="muted">Rango consultado: {mostrarRango(datos)}</p>}
      {error && <p className="msg" role="alert" style={{ color: 'var(--bad)', background: 'rgba(255,90,95,.12)' }}>{error}</p>}

      {!cargando && !tieneDatos ? (
        <section className="card" role="status">
          <h2>Sin datos sincronizados</h2>
          <p className="muted" style={{ margin: '8px 0 14px' }}>Sincroniza el portal para comenzar a auditar.</p>
          <button className="btn" type="button" onClick={sincronizar} disabled={sincronizando}>
            <RefreshCw size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
            {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </section>
      ) : cargando ? (
        <EmptyState texto="Calculando señales…" filas={4} />
      ) : (
        <>
          <Avisos datos={datos} />
          {datos && <Resumen datos={datos} />}
          {tab === 'prioridad' ? <Prioridad datos={datos} /> : <Cursos datos={datos} />}
        </>
      )}
      <p className="muted">Estas señales no confirman la causa.</p>
    </>
  );
}
