import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import Chips from '../components/Chips.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import { extraerAsistenciaClase, getAsistenciaClase, getCursos } from '../api.js';
import { sincronizarPortal } from '../portal.js';
import { diaSemana, fechaLocal } from '../fechas.js';
import { formatearRut, plural } from '../texto.js';

// Asistencia por bloque horario ("Asistencia por clase" del portal).
// Lee lo guardado en la BD; "Traer del portal" extrae todos los cursos de la fecha (un solo login)
// y vuelve a leer. Acepta ?curso=&fecha= (p. ej. desde una alerta de Auditoría).

const CURSO_STORAGE_KEY = 'inspectoria.clase.curso';
const FECHA_STORAGE_KEY = 'inspectoria.clase.fecha';
const ESTADOS = {
  P: { texto: 'Presente', clase: 'ok' },
  A: { texto: 'Ausente', clase: 'bad' },
  T: { texto: 'Atraso', clase: 'warn' },
};
const TODOS = 'todos';

const leer = (clave) => { try { return sessionStorage.getItem(clave) || ''; } catch { return ''; } };
const guardar = (clave, valor) => { try { sessionStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ } };
const etiquetaBloque = (b) => `${b.hora_inicio}–${b.hora_fin}`;
const contar = (alumnos, estado) => alumnos.filter((a) => a.estado === estado).length;

export default function AsistenciaClase() {
  const navigate = useNavigate();
  const { search, state } = useLocation();
  const [parametros] = useState(() => new URLSearchParams(search));
  const [cursos, setCursos] = useState([]);
  const [curso, setCurso] = useState(() => parametros.get('curso') || leer(CURSO_STORAGE_KEY));
  const [fecha, setFecha] = useState(() => parametros.get('fecha') || leer(FECHA_STORAGE_KEY) || fechaLocal(new Date()));
  const [bloques, setBloques] = useState([]);
  const [bloque, setBloque] = useState(TODOS);
  const [soloParciales, setSoloParciales] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [extrayendo, setExtrayendo] = useState(false);
  const [error, setError] = useState('');
  const [avisos, setAvisos] = useState([]);

  useEffect(() => {
    getCursos()
      .then(({ cursos: lista }) => {
        const nombres = lista.map((c) => c.curso);
        setCursos(nombres);
        setCurso((actual) => (nombres.includes(actual) ? actual : nombres[0] || ''));
      })
      .catch((e) => setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message));
  }, []);

  useEffect(() => { if (curso) guardar(CURSO_STORAGE_KEY, curso); }, [curso]);
  useEffect(() => { if (fecha) guardar(FECHA_STORAGE_KEY, fecha); }, [fecha]);

  const cargar = useCallback(async () => {
    if (!curso || !fecha) { setBloques([]); return; }
    setCargando(true);
    setError('');
    try {
      const datos = await getAsistenciaClase({ curso, fecha });
      setBloques(datos.bloques);
    } catch (e) {
      setBloques([]);
      setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message);
    } finally {
      setCargando(false);
    }
  }, [curso, fecha]);

  useEffect(() => {
    setAvisos([]);
    cargar();
  }, [cargar]);

  // Si el bloque elegido ya no existe (otro día/curso), vuelve a "Todos"
  useEffect(() => {
    if (bloque !== TODOS && !bloques.some((b) => b.hora_inicio === bloque)) setBloque(TODOS);
  }, [bloques, bloque]);

  const traerDelPortal = async () => {
    setExtrayendo(true);
    setError('');
    setAvisos([]);
    try {
      const respuesta = await sincronizarPortal({ navigate, accion: () => extraerAsistenciaClase(fecha) });
      if (respuesta) {
        const traidos = respuesta.cursos?.length || 0;
        setAvisos([
          ...(traidos ? [`Se trajo la asistencia por clase de ${plural(traidos, 'curso')}.`] : []),
          ...(respuesta.advertencias || []),
        ]);
        await cargar();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setExtrayendo(false);
    }
  };

  // Tabla alumno × bloque. "Faltó y volvió": ausente en un bloque y presente o atrasado en uno
  // posterior (misma regla que la alerta de Auditoría; no cuenta un retiro anticipado)
  const matriz = useMemo(() => {
    const porRut = new Map();
    bloques.forEach((b, i) => {
      for (const a of b.alumnos) {
        if (!porRut.has(a.rut)) porRut.set(a.rut, { ...a, estados: Array(bloques.length).fill(null) });
        porRut.get(a.rut).estados[i] = a.estado;
      }
    });
    return [...porRut.values()]
      .map((a) => {
        const ausencias = a.estados.filter((e, i) => e === 'A'
          && a.estados.slice(i + 1).some((s) => s === 'P' || s === 'T')).length;
        return { ...a, ausencias, parcial: ausencias > 0 };
      })
      .sort((x, y) => `${x.apellidos} ${x.nombres}`.localeCompare(`${y.apellidos} ${y.nombres}`, 'es'));
  }, [bloques]);

  const parciales = matriz.filter((a) => a.parcial).length;
  const filasMatriz = soloParciales ? matriz.filter((a) => a.parcial) : matriz;
  const elegido = bloques.find((b) => b.hora_inicio === bloque);
  const chips = [{ id: TODOS, label: 'Todos' }, ...bloques.map((b) => ({ id: b.hora_inicio, label: etiquetaBloque(b) }))];

  return (
    <>
      {state?.returnTo && (
        <Link className="linkbtn" to={state.returnTo} style={{ justifySelf: 'start' }}>
          <ChevronLeft size={16} /> Auditoría
        </Link>
      )}
      <div className="audit-header">
        <h2>Asistencia por clase</h2>
        <button type="button" className="btn ghost alumnos-exportar" onClick={traerDelPortal}
          disabled={extrayendo || !fecha} title="Trae todos los cursos de esta fecha">
          <RefreshCw size={16} className={extrayendo ? 'audit-spin' : undefined} style={{ verticalAlign: -3, marginRight: 8 }} />
          {extrayendo ? 'Trayendo…' : 'Traer del portal'}
        </button>
      </div>

      <div className="clase-filtros">
        <select className="input" value={curso} onChange={(e) => setCurso(e.target.value)}
          disabled={!cursos.length} aria-label="Curso">
          {!cursos.length && <option value="">Sin cursos</option>}
          {cursos.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha" />
      </div>
      {fecha && <p className="muted" style={{ margin: 0 }}>{diaSemana(fecha)}</p>}

      {error && <p className="msg error" role="alert">{error}</p>}
      {avisos.map((aviso) => <p key={aviso} className="msg" role="status">{aviso}</p>)}

      {!cursos.length && !error ? (
        <section className="card" role="status">
          <h2>Aún no hay cursos</h2>
          <p className="muted" style={{ marginTop: 8 }}>Sincroniza el portal desde Inicio o Ajustes para cargar los cursos.</p>
        </section>
      ) : cargando && !bloques.length ? (
        <EmptyState texto="Cargando asistencia por clase…" />
      ) : !bloques.length ? (
        <section className="card" role="status">
          <h2>Sin datos para este día</h2>
          <p className="muted" style={{ margin: '8px 0 14px' }}>
            Aún no se ha traído la asistencia por clase de {curso || 'este curso'} para esta fecha.
            Se traerán todos los cursos de una vez.
          </p>
          <button className="btn" type="button" onClick={traerDelPortal} disabled={extrayendo || !fecha}>
            <RefreshCw size={16} className={extrayendo ? 'audit-spin' : undefined} style={{ verticalAlign: -3, marginRight: 8 }} />
            {extrayendo ? 'Trayendo…' : 'Traer del portal'}
          </button>
        </section>
      ) : (
        <>
          <Chips opciones={chips} valor={bloque} onChange={setBloque} />

          {elegido ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {contar(elegido.alumnos, 'P')} presentes · {contar(elegido.alumnos, 'A')} ausentes · {contar(elegido.alumnos, 'T')} atrasos
              </p>
              <div className="list">
                {elegido.alumnos.map((a) => (
                  <Link key={a.rut} to={`/alumnos/${encodeURIComponent(a.rut)}`}
                    state={{ returnTo: '/asistencia-clase' }} className="item alumno">
                    <div><b>{a.apellidos}, {a.nombres}</b><span className="muted">{formatearRut(a.rut)}</span></div>
                    <span className={`tag ${ESTADOS[a.estado]?.clase || ''}`}>{ESTADOS[a.estado]?.texto || a.estado}</span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="row muted">
                <span title="Ausentes en un bloque y presentes o atrasados en uno posterior (no cuenta un retiro anticipado)">
                  {plural(parciales, 'alumno')} {parciales === 1 ? 'faltó' : 'faltaron'} a una clase y {parciales === 1 ? 'volvió' : 'volvieron'}
                </span>
                <label className="clase-check">
                  <input type="checkbox" checked={soloParciales} onChange={(e) => setSoloParciales(e.target.checked)} />
                  Ver solo esos
                </label>
              </div>
              <p className="legend clase-leyenda" style={{ margin: 0 }}>
                <span><b className="estado-P">P</b> Presente</span>
                <span><b className="estado-A">A</b> Ausente</span>
                <span><b className="estado-T">T</b> Atraso</span>
                <span><b>–</b> Sin registro</span>
              </p>
              <div className="card clase-tabla-caja">
                <table className="clase-tabla">
                  <thead>
                    <tr>
                      <th>Alumno</th>
                      {bloques.map((b) => <th key={b.hora_inicio}>{b.hora_inicio}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filasMatriz.map((a) => (
                      <tr key={a.rut}>
                        <th scope="row">
                          <Link to={`/alumnos/${encodeURIComponent(a.rut)}`} state={{ returnTo: '/asistencia-clase' }}>
                            {a.apellidos}, {a.nombres}
                          </Link>
                          {a.parcial && <span className="tag bad clase-parcial">Faltó a {plural(a.ausencias, 'bloque')}</span>}
                        </th>
                        {a.estados.map((estado, i) => (
                          <td key={bloques[i].hora_inicio} className={estado ? `estado-${estado}` : undefined}
                            title={estado ? `${etiquetaBloque(bloques[i])}: ${ESTADOS[estado]?.texto || estado}` : 'Sin registro'}>
                            {estado || '–'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filasMatriz.length && <p className="muted" style={{ textAlign: 'center' }}>Nadie faltó solo a parte del día.</p>}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
