import { useEffect, useState } from 'react';
import { useParams, Link, useLocation, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react';
import AttendanceRow from '../components/AttendanceRow.jsx';
import JustifySheet, { SIN_JUSTIFICAR, motivoCorto } from '../components/JustifySheet.jsx';
import Chips from '../components/Chips.jsx';
import Segmented from '../components/Segmented.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import { crearJustificativo, getAlumno } from '../api.js';
import { tituloMes } from '../fechas.js';
import { formatearRut } from '../texto.js';
import { memoriaAuditar } from '../filtrosAuditar.js';

// "Ver patrones": Alertas se abre con todas las alertas del alumno, también las ya atendidas
function prepararAuditoria() {
  memoriaAuditar.filtroAlertas = 'todas';
  memoriaAuditar.tipoAlerta = 'todos';
  memoriaAuditar.prioridadAlerta = 'todas';
}

const VISTAS = ['inasistencias', 'atrasos'];
const FILTROS_VER = ['pendientes', 'todas'];
const APLICA_A = { inasistencias: 'inasistencia', atrasos: 'atraso' };
const SIN_SELECCION = { inasistencias: [], atrasos: [] };

function Resumen({ resumen }) {
  const pct = resumen?.porcentajeAsistencia;
  const reincidente = (resumen?.atrasosSinJustificar ?? 0) >= 3;
  const pendientes = (n, total, todoOk) => (total === 0
    ? <span className="tag ok">Sin registros</span>
    : <span className={`tag ${n > 0 ? 'bad' : 'ok'}`}>{n > 0 ? `${n} sin justificar` : todoOk}</span>);
  return (
    <div className="kpis ficha">
      <section className="card">
        <p className="muted">Inasistencias</p>
        <div className="big">{resumen?.inasistencias ?? '—'}</div>
        {resumen && <div className="tags start">{pendientes(resumen.inasistenciasSinJustificar, resumen.inasistencias, 'Todas justificadas')}</div>}
      </section>
      <section className="card">
        <p className="muted">Atrasos</p>
        <div className="big">{resumen?.atrasos ?? '—'}</div>
        {resumen && (
          <div className="tags start">
            {pendientes(resumen.atrasosSinJustificar, resumen.atrasos, 'Todos justificados')}
            {reincidente && <span className="tag bad">Reincidente</span>}
          </div>
        )}
      </section>
      <section className="card">
        <p className="muted">Asistencia</p>
        <div className="big">{pct == null ? '—' : `${Math.round(pct * 100)}%`}</div>
        {resumen?.diasRegistrados > 0 && (
          <p className="muted">{resumen.diasRegistrados - resumen.inasistencias} de {resumen.diasRegistrados} días cargados</p>
        )}
      </section>
    </div>
  );
}

// Ficha del alumno: resumen arriba y dos pestañas separadas (inasistencias / atrasos).
// Cada pestaña justifica solo sus propios registros.
export default function StudentDetail() {
  const { rut } = useParams();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [alumno, setAlumno] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [inasistencias, setInasistencias] = useState([]);
  const [atrasos, setAtrasos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [sel, setSel] = useState(SIN_SELECCION);
  const [abierto, setAbierto] = useState(false);
  // Meses abiertos/cerrados a mano ('vista:YYYY-MM' → boolean); el resto usa el valor por defecto
  const [mesesManual, setMesesManual] = useState({});

  const cargar = () => {
    setCargando(true);
    setError('');
    return getAlumno(decodeURIComponent(rut))
      .then((data) => {
        setAlumno(data.alumno);
        setResumen(data.resumen);
        setInasistencias(data.inasistencias);
        setAtrasos(data.atrasos);
      })
      .catch((e) => setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message))
      .finally(() => setCargando(false));
  };

  useEffect(() => { setSel(SIN_SELECCION); setMensaje(''); setMesesManual({}); cargar(); }, [rut]);

  // Pestaña en la URL (?vista=atrasos). Sin parámetro, se abre la que tenga pendientes.
  const vistaUrl = searchParams.get('vista');
  const vista = VISTAS.includes(vistaUrl)
    ? vistaUrl
    : resumen && resumen.inasistenciasSinJustificar === 0 && resumen.atrasosSinJustificar > 0
      ? 'atrasos'
      : 'inasistencias';
  const cambiarParams = (cambios) => {
    const params = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null) params.delete(k); else params.set(k, v);
    }
    setSearchParams(params, { replace: true, state: location.state });
    setMensaje('');
  };
  // Al cambiar de pestaña, el filtro vuelve a su valor por defecto para esa pestaña
  const cambiarVista = (v) => cambiarParams({ vista: v, ver: null });

  // Registros de la pestaña actual y filtro "Sin justificar / Todas" (?ver=)
  const registros = vista === 'atrasos' ? atrasos : inasistencias;
  const pendientesVista = registros.filter((r) => !r.justificado).length;
  const verUrl = searchParams.get('ver');
  const ver = FILTROS_VER.includes(verUrl) ? verUrl : pendientesVista > 0 ? 'pendientes' : 'todas';
  const cambiarVer = (v) => {
    cambiarParams({ ver: v });
    setSel((s) => ({ ...s, [vista]: [] }));
  };
  const visibles = ver === 'pendientes' ? registros.filter((r) => !r.justificado) : registros;

  // Agrupados por mes, en el orden del backend (más reciente primero)
  const meses = [];
  for (const r of visibles) {
    const clave = r.fecha.slice(0, 7);
    if (meses.at(-1)?.clave !== clave) meses.push({ clave, filas: [] });
    meses.at(-1).filas.push(r);
  }
  // Totales por mes (de todos los registros de la pestaña, no solo los visibles)
  const totalesMes = {};
  for (const r of registros) {
    const t = (totalesMes[r.fecha.slice(0, 7)] ??= { total: 0, pendientes: 0 });
    t.total += 1;
    if (!r.justificado) t.pendientes += 1;
  }
  // Abiertos por defecto: el mes más reciente y los que tienen pendientes
  const mesAbierto = (clave, i) => {
    const k = `${vista}:${clave}`;
    if (k in mesesManual) return mesesManual[k];
    return i === 0 || (totalesMes[clave]?.pendientes ?? 0) > 0;
  };
  const alternarMes = (clave, i) => setMesesManual((m) => ({ ...m, [`${vista}:${clave}`]: !mesAbierto(clave, i) }));

  const alternar = (clave) => setSel((s) => ({
    ...s,
    [vista]: s[vista].includes(clave) ? s[vista].filter((x) => x !== clave) : [...s[vista], clave],
  }));
  const seleccion = sel[vista];
  const filasSeleccion = vista === 'atrasos'
    ? atrasos.filter((t) => seleccion.includes(t.id_atraso))
    : inasistencias.filter((d) => seleccion.includes(d.fecha));
  const fechasSeleccion = filasSeleccion.map((f) => f.fecha).sort();
  // Si todo lo seleccionado ya está justificado, la acción es cambiar o quitar la justificación
  const todoJustificado = filasSeleccion.length > 0 && filasSeleccion.every((f) => f.justificado);

  const guardar = ({ tipo, desde, hasta, duracionMs, aplicaA }) => {
    setError('');
    return crearJustificativo(decodeURIComponent(rut), { tipo, desde, hasta, duracionMs, aplicaA })
      .then(() => cargar())
      .then(() => {
        setMensaje(tipo === SIN_JUSTIFICAR ? 'Marcado como no justificado.' : 'Justificativo guardado correctamente.');
        setAbierto(false);
        setSel((s) => ({ ...s, [vista]: [] }));
      })
      .catch((e) => setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message));
  };

  const etiqueta = (texto, n) => (n > 0 ? `${texto} (${n})` : texto);
  const opciones = [
    { id: 'inasistencias', label: etiqueta('Inasistencias', resumen?.inasistenciasSinJustificar) },
    { id: 'atrasos', label: etiqueta('Atrasos', resumen?.atrasosSinJustificar) },
  ];

  const nombreSeleccion = vista === 'atrasos'
    ? (seleccion.length === 1 ? 'atraso' : 'atrasos')
    : (seleccion.length === 1 ? 'inasistencia' : 'inasistencias');

  const fila = (r) => (vista === 'atrasos'
    ? (
      <AttendanceRow key={r.id_atraso} fecha={r.fecha} hora={r.hora_llegada}
        justificado={Boolean(r.justificado)} motivo={motivoCorto(r.motivo)}
        textoJustificado={r.justificado_portal ? 'Justificado (portal)' : 'Justificado'}
        seleccionable={!r.justificado_portal /* lo justificado en el portal no se cambia aquí */}
        seleccionado={seleccion.includes(r.id_atraso)}
        onClick={() => !r.justificado_portal && alternar(r.id_atraso)} />
    )
    : (
      <AttendanceRow key={r.fecha} fecha={r.fecha}
        justificado={Boolean(r.justificado)} motivo={motivoCorto(r.motivo)}
        seleccionable
        seleccionado={seleccion.includes(r.fecha)}
        onClick={() => alternar(r.fecha)} />
    ));

  const filtrosVer = [
    { id: 'pendientes', label: `Sin justificar (${pendientesVista})` },
    { id: 'todas', label: `${vista === 'atrasos' ? 'Todos' : 'Todas'} (${registros.length})` },
  ];

  let vacio = null;
  if (visibles.length === 0) {
    if (cargando) vacio = <EmptyState texto="Cargando…" filas={4} />;
    else if (registros.length === 0) {
      vacio = <EmptyState filas={0}
        texto={vista === 'atrasos' ? 'Este alumno no tiene atrasos registrados.' : 'Este alumno no tiene inasistencias registradas.'} />;
    } else {
      vacio = (
        <section className="card" role="status">
          <p className="muted">
            {vista === 'atrasos' ? 'Todos los atrasos están justificados.' : 'Todas las inasistencias están justificadas.'}
          </p>
          <button type="button" className="linkbtn" style={{ marginTop: 8 }} onClick={() => cambiarVer('todas')}>
            Ver {vista === 'atrasos' ? 'todos' : 'todas'}
          </button>
        </section>
      );
    }
  }

  return (
    <>
      <Link to={location.state?.returnTo || '/alumnos'} className="muted row" style={{ justifyContent: 'flex-start', gap: 4 }}>
        <ChevronLeft size={16} />{location.state?.returnLabel || 'Alumnos'}
      </Link>
      <section className="card">
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h2>{alumno ? `${alumno.nombres} ${alumno.apellidos}` : 'Alumno'}</h2>
            <p className="muted">{alumno ? `${alumno.curso} · ${formatearRut(alumno.rut)}` : formatearRut(decodeURIComponent(rut))}</p>
          </div>
          {alumno && (
            <Link className="linkbtn" onClick={prepararAuditoria} title="Abrir Auditoría → Alertas con este alumno"
              to={`/auditar?tab=alertas&rango=completo&q=${encodeURIComponent(alumno.rut)}`}>
              <ClipboardCheck size={16} /> Ver patrones
            </Link>
          )}
        </div>
      </section>

      <Resumen resumen={resumen} />

      <Segmented opciones={opciones} valor={vista} onChange={cambiarVista} />

      {registros.length > 0 && <Chips opciones={filtrosVer} valor={ver} onChange={cambiarVer} />}

      {error && <p className="msg" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      {mensaje && <p className="msg" role="status">{mensaje}</p>}
      {vacio || (
        <div className="meses" role="tabpanel">
          {meses.map(({ clave, filas }, i) => {
            const { total = 0, pendientes = 0 } = totalesMes[clave] || {};
            const abiertoMes = mesAbierto(clave, i);
            const nombre = vista === 'atrasos'
              ? (total === 1 ? 'atraso' : 'atrasos')
              : (total === 1 ? 'inasistencia' : 'inasistencias');
            const todoOk = vista === 'atrasos' ? 'todos justificados' : 'todas justificadas';
            return (
              <section key={clave} className="mes">
                <h3>
                  <button type="button" className="mes-titulo" aria-expanded={abiertoMes}
                    aria-controls={`mes-${clave}`} onClick={() => alternarMes(clave, i)}>
                    <ChevronRight size={16} className="mes-chevron" aria-hidden />
                    {tituloMes(clave)}
                    <span className="muted">
                      {' · '}{total} {nombre}{' · '}
                      {pendientes > 0
                        ? <span style={{ color: 'var(--bad)' }}>{pendientes} sin justificar</span>
                        : todoOk}
                    </span>
                  </button>
                </h3>
                {abiertoMes && <div className="list" id={`mes-${clave}`}>{filas.map(fila)}</div>}
              </section>
            );
          })}
        </div>
      )}

      {seleccion.length > 0 && (
        <div className="actionbar">
          <button className="btn" onClick={() => setAbierto(true)}>
            {todoJustificado
              ? `Cambiar justificación (${seleccion.length})`
              : `Justificar ${seleccion.length} ${nombreSeleccion}`}
          </button>
        </div>
      )}

      <JustifySheet abierto={abierto} onCerrar={() => setAbierto(false)}
        aplicaA={APLICA_A[vista]} quitar={todoJustificado}
        resumen={`${seleccion.length} ${nombreSeleccion} seleccionad${vista === 'atrasos' ? 'o' : 'a'}${seleccion.length === 1 ? '' : 's'}`}
        desde={fechasSeleccion[0]} hasta={fechasSeleccion[fechasSeleccion.length - 1]}
        onGuardar={guardar} />
    </>
  );
}
