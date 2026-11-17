import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Segmented from '../components/Segmented.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import { getAuditoriaCursos, getAuditoriaPrioridad, getCursos } from '../api.js';

const TABS = [
  { id: 'prioridad', label: 'A quién citar' },
  { id: 'cursos', label: 'Comparar cursos' },
];

const TIPOS = [
  { id: 'ambos', label: 'Inasistencias y atrasos' },
  { id: 'inasistencias', label: 'Inasistencias' },
  { id: 'atrasos', label: 'Atrasos' },
];

const fechaLocal = (fecha) => {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

function mostrarRango(datos) {
  if (!datos?.rango?.desde || !datos?.rango?.hasta) return 'Sin rango con datos suficientes';
  return `${datos.rango.desde} a ${datos.rango.hasta}`;
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
  return datos?.advertencias?.length > 0
    ? <div className="msg" role="status">{datos.advertencias.map((aviso) => <p key={aviso}>{aviso}</p>)}</div>
    : null;
}

function Prioridad({ datos }) {
  if (!datos?.alumnos?.length) return <EmptyState texto="Sin datos en este rango." />;
  return (
    <div className="list">
      {datos.alumnos.map((alumno) => (
        <Link key={alumno.rut} to={`/alumnos/${encodeURIComponent(alumno.rut)}`} className="item">
          <div>
            <b>{alumno.nombres} {alumno.apellidos}</b>
            <span className="muted">{alumno.curso} · {alumno.rut}</span>
            <span className="muted">{alumno.motivo || 'Sin señales pendientes.'}</span>
          </div>
          <div className="tags">
            <span className="tag bad">Puntaje {alumno.puntaje}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function Cursos({ datos }) {
  if (!datos?.cursos?.length) return <EmptyState texto="Sin datos en este rango." />;
  return (
    <div className="list">
      {datos.cursos.map((curso) => (
        <section className="item" key={curso.curso}>
          <div>
            <b>{curso.curso}</b>
            <span className="muted">
              Sobre {curso.denominador} registros · {curso.diasRegistrados} días · {curso.alumnosMatriculados} alumnos
            </span>
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
  const [tab, setTab] = useState('prioridad');
  const [tipo, setTipo] = useState('ambos');
  const [curso, setCurso] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [cursos, setCursos] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getCursos()
      .then((respuesta) => setCursos(respuesta.cursos || []))
      .catch((e) => setError(e.message));
  }, []);

  const parametros = useMemo(() => {
    const resultado = { tipo };
    if (curso) resultado.curso = curso;
    if (desde) resultado.desde = desde;
    if (hasta) resultado.hasta = hasta;
    return resultado;
  }, [curso, desde, hasta, tipo]);

  const consultar = async (e) => {
    e?.preventDefault();
    setCargando(true);
    setError('');
    try {
      const respuesta = await (tab === 'prioridad'
        ? getAuditoriaPrioridad(parametros)
        : getAuditoriaCursos(parametros));
      setDatos(respuesta);
      if (!desde && respuesta.rangoSugerido?.desde) setDesde(respuesta.rangoSugerido.desde);
      if (!hasta && respuesta.rangoSugerido?.hasta) setHasta(respuesta.rangoSugerido.hasta);
    } catch (e) {
      setError(e.message);
      setDatos(null);
    } finally {
      setCargando(false);
    }
  };

  const aplicarAtajo = (atajo) => {
    const hoy = new Date();
    const fin = fechaLocal(hoy);
    if (atajo === 'hoy') {
      setDesde(fin);
      setHasta(fin);
    } else if (atajo === 'semana') {
      const inicio = new Date(hoy);
      inicio.setDate(hoy.getDate() - hoy.getDay() + 1);
      setDesde(fechaLocal(inicio));
      setHasta(fin);
    } else {
      setDesde(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`);
      setHasta(fin);
    }
  };

  return (
    <>
      <form className="card form filters" onSubmit={consultar}>
        <div className="grid2">
          <div className="field">
            <label htmlFor="auditoria-curso">Curso</label>
            <select id="auditoria-curso" className="input" value={curso} onChange={(e) => setCurso(e.target.value)}>
              <option value="">Todos los cursos</option>
              {cursos.map((opcion) => <option key={opcion.curso} value={opcion.curso}>{opcion.curso}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="auditoria-tipo">Tipo</label>
            <select id="auditoria-tipo" className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.label}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="auditoria-desde">Desde</label><input id="auditoria-desde" type="date" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="field"><label htmlFor="auditoria-hasta">Hasta</label><input id="auditoria-hasta" type="date" className="input" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        </div>
        <div className="row">
          <div className="tags">
            <button type="button" className="btn ghost" onClick={() => aplicarAtajo('hoy')}>Hoy</button>
            <button type="button" className="btn ghost" onClick={() => aplicarAtajo('semana')}>Esta semana</button>
            <button type="button" className="btn ghost" onClick={() => aplicarAtajo('mes')}>Este mes</button>
          </div>
          <button className="btn" disabled={cargando}>Consultar</button>
        </div>
      </form>

      <Segmented valor={tab} onChange={(valor) => { setTab(valor); setDatos(null); }} opciones={TABS} />
      {datos && <p className="muted">Rango consultado: {mostrarRango(datos)}</p>}
      {error && <p className="msg" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      <Avisos datos={datos} />
      {datos && <Resumen datos={datos} />}
      {cargando
        ? <EmptyState texto="Calculando señales…" filas={4} />
        : tab === 'prioridad' ? <Prioridad datos={datos} /> : <Cursos datos={datos} />}
      <p className="muted">Estas señales no confirman la causa.</p>
    </>
  );
}
