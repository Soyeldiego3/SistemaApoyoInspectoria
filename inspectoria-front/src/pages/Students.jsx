import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import Chips from '../components/Chips.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import { getAlumnos } from '../api.js';

// Forma esperada de cada alumno (la API la entregará):
// { rut, nombres, apellidos, curso, atrasos: number, pendientes: number }
//   atrasos    = atrasos acumulados sin justificar
//   pendientes = inasistencias sin justificar
const FILTROS = [
  { id: 'todos', label: 'Todos' },
  { id: 'sin', label: 'Sin justificar' },
  { id: 'reinc', label: '3+ atrasos' },
  { id: 'ok', label: 'Al día' },
];

// Ignora tildes, mayúsculas, puntos y guion del RUT
const limpiar = (s) => s.normalize('NFD').replace(/[\u0300-\u036f.\-]/g, '').toLowerCase();

export default function Students() {
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [curso, setCurso] = useState('');
  const [alumnos, setAlumnos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getAlumnos()
      .then((data) => {
        setAlumnos(data.alumnos);
      })
      .catch((e) => setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message))
      .finally(() => setCargando(false));
  }, []);

  const cursos = useMemo(() => [...new Set(alumnos.map((a) => a.curso))].sort(), [alumnos]);

  // Se recalcula en cada tecla; no necesita ir al back
  const lista = useMemo(() => {
    const t = limpiar(q.trim());
    return alumnos.filter((a) =>
      (!t || limpiar(`${a.rut} ${a.nombres} ${a.apellidos} ${a.curso}`).includes(t)) &&
      (!curso || a.curso === curso) &&
      (filtro === 'todos' || (filtro === 'sin' && a.pendientes > 0) || (filtro === 'reinc' && a.atrasos >= 3) || (filtro === 'ok' && a.pendientes === 0)));
  }, [alumnos, q, filtro, curso]);

  const hayFiltros = q || curso || filtro !== 'todos';
  const limpiarTodo = () => { setQ(''); setCurso(''); setFiltro('todos'); };

  return (
    <>
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
        ? <EmptyState texto={error || (cargando ? 'Cargando alumnos…' : alumnos.length ? 'Ningún alumno coincide con los filtros.' : 'Aún no hay alumnos. Sincroniza un curso primero.')} />
        : <div className="list cols">{lista.map((a) => (
            <Link key={a.rut} to={`/alumnos/${encodeURIComponent(a.rut)}`} className="item">
              <div><b>{a.nombres} {a.apellidos}</b><span className="muted">{a.curso} · {a.rut}</span></div>
              <div className="tags">
                {a.atrasos >= 3 && <span className="tag bad">{a.atrasos} atrasos</span>}
                {a.pendientes > 0 ? <span className="tag warn">{a.pendientes} sin justificar</span> : <span className="tag ok">Al día</span>}
              </div>
            </Link>))}</div>}
    </>
  );
}
