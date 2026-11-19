import { useMemo, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, Search, X } from 'lucide-react';
import Chips from '../components/Chips.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import { getAlumnos, getCredencialesPortal, iniciarSync } from '../api.js';

const MENSAJES_PORTAL = {
  LOGIN_RECHAZADO: 'El portal rechazó el usuario o la contraseña',
  PORTAL_INACCESIBLE: 'No se pudo conectar con el portal; revisa la red o la URL',
  NAVEGADOR_NO_DISPONIBLE: 'No se encontró Microsoft Edge',
  ESTRUCTURA_CAMBIADA: 'El portal cambió y no se pudo extraer la información',
};

// Forma esperada de cada alumno (la API la entregará):
// { rut, nombres, apellidos, curso, atrasos: number, pendientes: number }
//   atrasos    = atrasos acumulados sin justificar
//   pendientes = inasistencias sin justificar
const FILTROS = [
  // Estados de asistencia entregados por la API: presente, ausente y atraso.
  { id: 'todos', label: 'Todos' },
  { id: 'sin', label: 'Sin justificar' },
  { id: 'reinc', label: '+3 Sin justificar' },
  { id: 'ok', label: 'Al día' },
];

const CURSO_STORAGE_KEY = 'inspectoria.alumnos.curso';
const FILTRO_STORAGE_KEY = 'inspectoria.alumnos.filtro';

// Ignora tildes, mayúsculas, puntos y guion del RUT
const limpiar = (s) => s.normalize('NFD').replace(/[\u0300-\u036f.\-]/g, '').toLowerCase();

export default function Students() {
  const location = useLocation();
  const navigate = useNavigate();
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const parametros = new URLSearchParams(location.search);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState(() => (
    parametros.get('filtro')
    || sessionStorage.getItem(FILTRO_STORAGE_KEY)
    || 'todos'
  ));
  const [curso, setCurso] = useState(() => (
    parametros.get('curso')
    || sessionStorage.getItem(CURSO_STORAGE_KEY)
    || ''
  ));
  const [alumnos, setAlumnos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState('');

  const cargarAlumnos = async () => {
    setCargando(true);
    setError('');
    try {
      const data = await getAlumnos();
      setAlumnos(data.alumnos);
    } catch (e) {
      setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarAlumnos();
  }, []);

  const sincronizar = async () => {
    setSincronizando(true);
    setError('');
    try {
      if (!esPc) {
        await iniciarSync();
        await cargarAlumnos();
        return;
      }
      const credenciales = await getCredencialesPortal();
      if (!credenciales.guardadas && !credenciales.enMemoria) {
        navigate('/datos', {
          replace: false,
          state: {
            abrirCredenciales: true,
            accionModal: 'guardar',
            mensaje: 'Configura las credenciales del portal para sincronizar.',
          },
        });
        return;
      }
      if (credenciales.invalidas) {
        navigate('/datos', {
          replace: false,
          state: {
            abrirCredenciales: true,
            accionModal: 'guardar',
            mensaje: 'Las credenciales guardadas están inválidas. Actualízalas para continuar.',
          },
        });
        return;
      }
      await iniciarSync();
      await cargarAlumnos();
    } catch (e) {
      if (!esPc && (e.code === 'CREDENCIALES_REQUERIDAS' || e.code === 'LOGIN_RECHAZADO')) {
        setError('Sincroniza desde el PC.');
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

  const cursos = useMemo(() => [...new Set(alumnos.map((a) => a.curso))].sort(), [alumnos]);

  useEffect(() => {
    if (curso) sessionStorage.setItem(CURSO_STORAGE_KEY, curso);
    else sessionStorage.removeItem(CURSO_STORAGE_KEY);
  }, [curso]);

  useEffect(() => {
    if (filtro !== 'todos') sessionStorage.setItem(FILTRO_STORAGE_KEY, filtro);
    else sessionStorage.removeItem(FILTRO_STORAGE_KEY);
  }, [filtro]);

  const rutaRetorno = useMemo(() => {
    const retorno = new URLSearchParams();
    if (curso) retorno.set('curso', curso);
    if (filtro !== 'todos') retorno.set('filtro', filtro);
    return retorno.toString() ? `/alumnos?${retorno}` : '/alumnos';
  }, [curso, filtro]);

  // Se recalcula en cada tecla; no necesita ir al back
  const lista = useMemo(() => {
    const t = limpiar(q.trim());
    return alumnos.filter((a) =>
      (!t || limpiar(`${a.rut} ${a.nombres} ${a.apellidos} ${a.curso}`).includes(t)) &&
      (!curso || a.curso === curso) &&
      (filtro === 'todos' ||
        (filtro === 'sin' && (a.pendientes > 0 || a.atrasos > 0)) ||
        (filtro === 'reinc' && a.atrasos >= 3) ||
        (filtro === 'ok' && a.pendientes === 0 && a.atrasos === 0)));
  }, [alumnos, q, filtro, curso]);

  const hayFiltros = q || curso || filtro !== 'todos';
  const limpiarTodo = () => { setQ(''); setCurso(''); setFiltro('todos'); };

  return (
    <>
      <div className="audit-header">
        <h2>Alumnos</h2>
        <button type="button" className="iconbtn audit-sync" onClick={sincronizar} disabled={sincronizando}
          aria-label={sincronizando ? 'Sincronizando datos' : 'Sincronizar datos'} title="Sincronizar">
          <RefreshCw size={20} className={sincronizando ? 'audit-spin' : ''} />
        </button>
      </div>

      {error && !cargando && <p className="msg" role="alert" style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}>{error}</p>}
      <div className="searchbox">
        <Search size={18} />
        <input className="input" type="search" placeholder="RUT, nombre o curso" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Buscar alumno" />
      </div>

      <div className="filterbar">
        <Chips opciones={FILTROS} valor={filtro} onChange={setFiltro} />
        <select className="input curso" value={curso} onChange={(e) => setCurso(e.target.value)} disabled={!cursos.length} aria-label="Filtrar por curso">
          <option value="">Todos los cursos</option>
          {cursos.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div className="row muted">
        <span>{lista.length} {lista.length === 1 ? 'alumno' : 'alumnos'}</span>
        {hayFiltros && <button className="linkbtn" onClick={limpiarTodo}><X size={14} /> Limpiar filtros</button>}
      </div>

      {lista.length === 0
        ? cargando
          ? <EmptyState texto="Cargando alumnos…" />
          : !alumnos.length
            ? (
              <section className="card" role="status">
                <h2>Aún no hay alumnos</h2>
                <p className="muted" style={{ margin: '8px 0 14px' }}>
                  Sincroniza el portal para cargar los cursos y alumnos.
                </p>
                <button className="btn" type="button" onClick={sincronizar} disabled={sincronizando}>
                  <RefreshCw size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
                  {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
                </button>
              </section>
            )
            : <EmptyState texto={error || 'Ningún alumno coincide con los filtros.'} filas={3} />
        : <div className="list cols">{lista.map((a) => (
            <Link key={a.rut} to={`/alumnos/${encodeURIComponent(a.rut)}`}
              state={{ returnTo: rutaRetorno }}
              className="item">
              <div><b>{a.nombres} {a.apellidos}</b><span className="muted">{a.curso} · {a.rut}</span></div>
              <div className="tags">
                {a.atrasos > 0 && <span className={`tag ${a.atrasos >= 3 ? 'bad' : 'warn'}`}>{a.atrasos} atrasos sin justificar</span>}
                {a.pendientes > 0 && <span className="tag warn">{a.pendientes} inasistencias sin justificar</span>}
                {a.pendientes === 0 && a.atrasos === 0 && <span className="tag ok">Al día</span>}
              </div>
            </Link>))}</div>}
    </>
  );
}
