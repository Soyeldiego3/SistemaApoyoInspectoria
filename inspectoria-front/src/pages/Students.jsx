import { useCallback, useMemo, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowDownUp, CalendarX, Clock, RefreshCw, Search, X } from 'lucide-react';
import Chips from '../components/Chips.jsx';
import ExportarImportarSheet from '../components/ExportarImportarSheet.jsx';
import RangoSlider from '../components/RangoSlider.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import { getAlumnos } from '../api.js';
import { sincronizarPortal } from '../portal.js';
import { coincide, formatearRut, plural } from '../texto.js';

// Forma esperada de cada alumno (la API la entregará):
// { rut, nombres, apellidos, curso, atrasos: number, pendientes: number }
//   atrasos    = atrasos acumulados sin justificar
//   pendientes = inasistencias sin justificar
// Filtro = estado (chips). Con inasistencias o atrasos se elige además un rango de cantidad
// con el slider (ej. de 3 a 20). En la URL: ?filtro=atrasos&min=3&max=20
const CHIPS = [
  { id: 'todos', label: 'Todos' },
  { id: 'inasist', label: 'Inasistencias pendientes' },
  { id: 'atrasos', label: 'Atrasos pendientes' },
  { id: 'ok', label: 'Al día' },
];
const CON_RANGO = ['inasist', 'atrasos'];
const CAMPO_RANGO = { inasist: 'pendientes', atrasos: 'atrasos' };
const RANGO_INICIAL = { desde: 1, hasta: null }; // hasta null = hasta el máximo registrado

// Filtros antiguos: 'reinc' (reincidentes) y el sufijo '3' de "Solo 3 o más" (ej. 'atrasos3')
function leerFiltro(f) {
  if (f === 'reinc') return { filtro: 'atrasos', desde: 3 };
  const base = (f || '').replace(/3$/, '');
  if (!CHIPS.some((o) => o.id === base)) return null;
  return { filtro: base, desde: f.endsWith('3') ? 3 : 1 };
}
const entero = (v) => (/^\d+$/.test(v || '') ? Number(v) : null);
// Con un filtro de inasistencias o atrasos, la ficha se abre directo en esa pestaña
const VISTA_POR_FILTRO = { inasist: 'inasistencias', atrasos: 'atrasos' };

const CURSO_STORAGE_KEY = 'inspectoria.alumnos.curso';
const FILTRO_STORAGE_KEY = 'inspectoria.alumnos.filtro';
const BUSQUEDA_STORAGE_KEY = 'inspectoria.alumnos.busqueda';
const RANGO_STORAGE_KEY = 'inspectoria.alumnos.rango';

function rangoGuardado() {
  try {
    const r = JSON.parse(sessionStorage.getItem(RANGO_STORAGE_KEY) || 'null');
    if (r && Number.isInteger(r.desde) && (r.hasta === null || Number.isInteger(r.hasta))) return r;
  } catch { /* sin almacenamiento */ }
  return null;
}

export default function Students() {
  const location = useLocation();
  const navigate = useNavigate();
  const parametros = new URLSearchParams(location.search);
  // Si la URL trae filtros (ej. desde Inicio → Reincidencias), mandan ellos y no lo guardado
  const urlConFiltros = parametros.has('filtro') || parametros.has('curso');
  const [q, setQ] = useState(() => {
    if (urlConFiltros) return '';
    try { return sessionStorage.getItem(BUSQUEDA_STORAGE_KEY) || ''; } catch { return ''; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(BUSQUEDA_STORAGE_KEY, q); } catch { /* sin almacenamiento */ }
  }, [q]);
  const [inicial] = useState(() => {
    if (urlConFiltros) {
      const leido = leerFiltro(parametros.get('filtro')) || { filtro: 'todos', desde: 1 };
      return {
        filtro: leido.filtro,
        rango: { desde: entero(parametros.get('min')) || leido.desde, hasta: entero(parametros.get('max')) },
      };
    }
    const leido = leerFiltro(sessionStorage.getItem(FILTRO_STORAGE_KEY)) || { filtro: 'todos', desde: 1 };
    return { filtro: leido.filtro, rango: rangoGuardado() || { ...RANGO_INICIAL, desde: leido.desde } };
  });
  const [filtro, setFiltroEstado] = useState(inicial.filtro);
  const [rango, setRango] = useState(inicial.rango);
  // Al cambiar de estado el rango vuelve a "1 hasta el máximo"
  const setFiltro = (nuevo) => {
    setFiltroEstado(nuevo);
    if (nuevo !== filtro) setRango(RANGO_INICIAL);
  };
  const [curso, setCurso] = useState(() => (
    urlConFiltros
      ? parametros.get('curso') || ''
      : sessionStorage.getItem(CURSO_STORAGE_KEY) || ''
  ));
  const [alumnos, setAlumnos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState('');
  const [exportarAbierto, setExportarAbierto] = useState(false);
  const cerrarExportar = useCallback(() => setExportarAbierto(false), []);

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
      // null = faltaban credenciales y se fue a Ajustes
      if (await sincronizarPortal({ navigate })) await cargarAlumnos();
    } catch (e) {
      setError(e.message);
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
    try {
      if (filtro !== 'todos') sessionStorage.setItem(FILTRO_STORAGE_KEY, filtro);
      else sessionStorage.removeItem(FILTRO_STORAGE_KEY);
      sessionStorage.setItem(RANGO_STORAGE_KEY, JSON.stringify(rango));
    } catch { /* sin almacenamiento */ }
  }, [filtro, rango]);

  const base = filtro;
  const conRango = CON_RANGO.includes(base);
  // Límite del slider: la mayor cantidad registrada en el curso elegido (mínimo 1)
  const maximo = useMemo(() => {
    if (!conRango) return 1;
    const campo = CAMPO_RANGO[base];
    return Math.max(1, ...alumnos.filter((a) => !curso || a.curso === curso).map((a) => a[campo] || 0));
  }, [alumnos, base, conRango, curso]);
  const desde = Math.min(Math.max(rango.desde, 1), maximo);
  const hasta = rango.hasta == null ? maximo : Math.min(Math.max(rango.hasta, desde), maximo);
  const rangoCambiado = conRango && (desde > 1 || hasta < maximo);
  // Si se deja la manija en el máximo, sigue al máximo aunque cambien los datos o el curso
  const cambiarRango = (r) => setRango({ desde: r.desde, hasta: r.hasta >= maximo ? null : r.hasta });

  const rutaRetorno = useMemo(() => {
    const retorno = new URLSearchParams();
    if (curso) retorno.set('curso', curso);
    if (filtro !== 'todos') retorno.set('filtro', filtro);
    if (conRango && rango.desde > 1) retorno.set('min', rango.desde);
    if (conRango && rango.hasta != null) retorno.set('max', rango.hasta);
    return retorno.toString() ? `/alumnos?${retorno}` : '/alumnos';
  }, [curso, filtro, conRango, rango]);

  // Se recalcula en cada tecla; no necesita ir al back
  const lista = useMemo(() => {
    const enRango = (n) => n >= desde && n <= hasta;
    return alumnos.filter((a) =>
      coincide(q, a.rut, a.nombres, a.apellidos, a.curso) &&
      (!curso || a.curso === curso) &&
      (base === 'todos' ||
        (base === 'inasist' && enRango(a.pendientes)) ||
        (base === 'atrasos' && enRango(a.atrasos)) ||
        (base === 'ok' && a.pendientes === 0 && a.atrasos === 0)));
  }, [alumnos, q, base, desde, hasta, curso]);

  // Con un filtro activo, cada tarjeta muestra solo el dato de ese filtro
  const verInasist = base === 'todos' || base === 'inasist';
  const verAtrasos = base === 'todos' || base === 'atrasos';

  const hayFiltros = q || curso || filtro !== 'todos' || rangoCambiado;
  const limpiarTodo = () => { setQ(''); setCurso(''); setFiltro('todos'); setRango(RANGO_INICIAL); };

  return (
    <>
      <div className="audit-header">
        <h2>Alumnos</h2>
        <button type="button" className="btn ghost alumnos-exportar" onClick={() => setExportarAbierto(true)}>
          <ArrowDownUp size={16} style={{ verticalAlign: -3, marginRight: 8 }} />Exportar / Importar
        </button>
      </div>
      {/* Tras importar justificaciones cambian los pendientes: se recarga la lista */}
      <ExportarImportarSheet abierto={exportarAbierto} onCerrar={cerrarExportar} onImportado={cargarAlumnos} />

      {error && !cargando && <p className="msg error" role="alert">{error}</p>}
      <div className="searchbox">
        <Search size={18} />
        <input className="input" type="search" placeholder="RUT, nombre o curso" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Buscar alumno" />
      </div>

      {/* En escritorio se ven los chips; en el teléfono, un desplegable (los chips no caben) */}
      <div className="filterbar con-select">
        <Chips opciones={CHIPS} valor={base} onChange={setFiltro} />
        <select className="input filtro-select" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por estado">
          {CHIPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select className="input curso" value={curso} onChange={(e) => setCurso(e.target.value)} disabled={!cursos.length} aria-label="Filtrar por curso">
          <option value="">Todos los cursos</option>
          {cursos.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {conRango && alumnos.length > 0 && (
        <RangoSlider min={1} max={maximo} desde={desde} hasta={hasta} onChange={cambiarRango}
          etiqueta={base === 'inasist' ? 'Cantidad de inasistencias' : 'Cantidad de atrasos'}
          unidad={`${base === 'inasist' ? 'inasistencia' : 'atraso'}${hasta === 1 ? '' : 's'}`} />
      )}

      <div className="row muted">
        <span>{plural(lista.length, 'alumno')}</span>
        {hayFiltros &&<button className="linkbtn" onClick={limpiarTodo}><X size={14} /> Limpiar filtros</button>}
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
            <Link key={a.rut}
              to={`/alumnos/${encodeURIComponent(a.rut)}${VISTA_POR_FILTRO[base] ? `?vista=${VISTA_POR_FILTRO[base]}` : ''}`}
              state={{ returnTo: rutaRetorno }}
              className="item alumno">
              <div><b>{a.nombres} {a.apellidos}</b><span className="muted">{a.curso} · {formatearRut(a.rut)}</span></div>
              <div className="tags">
                {verInasist && a.pendientes > 0 && (
                  <span className={`tag ${a.pendientes >= 3 ? 'bad' : 'warn'}`} title="Inasistencias sin justificar">
                    <CalendarX size={13} aria-hidden />{plural(a.pendientes, 'inasistencia')}{a.pendientes >= 3 ? ' · 3 o más' : ''}
                  </span>
                )}
                {verAtrasos && a.atrasos > 0 && (
                  <span className={`tag ${a.atrasos >= 3 ? 'bad' : 'warn'}`} title="Atrasos sin justificar">
                    <Clock size={13} aria-hidden />{plural(a.atrasos, 'atraso')}{a.atrasos >= 3 ? ' · reincidente' : ''}
                  </span>
                )}
                {a.pendientes === 0 && a.atrasos === 0 && <span className="tag ok">Al día</span>}
              </div>
            </Link>))}</div>}
    </>
  );
}
