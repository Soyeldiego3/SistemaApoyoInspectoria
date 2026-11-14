import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import AttendanceRow from '../components/AttendanceRow.jsx';
import JustifySheet from '../components/JustifySheet.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import { crearJustificativo, getAlumno } from '../api.js';

// Ficha del alumno: días con asistencia + justificativo en una lista.
// Marcas los días ausentes y justificas el rango con un solo panel.
export default function StudentDetail() {
  const { rut } = useParams();
  const [alumno, setAlumno] = useState(null);
  const [dias, setDias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [sel, setSel] = useState([]);
  const [abierto, setAbierto] = useState(false);

  const cargar = () => {
    setCargando(true);
    setError('');
    return getAlumno(decodeURIComponent(rut))
      .then((data) => {
        setAlumno(data.alumno);
        setDias(data.dias);
      })
      .catch((e) => setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message))
      .finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, [rut]);

  const alternar = (f) => setSel((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]));
  const ordenadas = [...sel].sort();
  const guardar = ({ tipo, desde, hasta }) => {
    setError('');
    return crearJustificativo(decodeURIComponent(rut), { tipo, desde, hasta })
      .then(() => cargar())
      .then(() => {
        setMensaje('Justificativo guardado correctamente.');
        setAbierto(false);
        setSel([]);
      })
      .catch((e) => setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message));
  };

  return (
    <>
      <Link to="/alumnos" className="muted row" style={{ justifyContent: 'flex-start', gap: 4 }}><ChevronLeft size={16} />Alumnos</Link>
      <section className="card">
        <h2>{alumno ? `${alumno.nombres} ${alumno.apellidos}` : 'Alumno'}</h2>
        <p className="muted">{alumno ? `${alumno.curso} · ${alumno.rut}` : decodeURIComponent(rut)}</p>
      </section>

      {error && <p className="msg" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      {mensaje && <p className="msg" role="status">{mensaje}</p>}
      {dias.length === 0
        ? <EmptyState texto={cargando ? 'Cargando asistencia…' : 'Aquí aparecerán los días con su asistencia y justificativos.'} filas={4} />
        : <div className="list cols">{dias.map((d) => (
            <AttendanceRow key={d.fecha} titulo={d.fecha} detalle={d.hora_llegada ? `Llegada ${d.hora_llegada}` : ''}
              estado={d.estado} justificado={Boolean(d.justificado)}
              seleccionable={d.estado !== 'presente' && !d.justificado}
              seleccionado={sel.includes(d.fecha)}
              onClick={() => d.estado !== 'presente' && !d.justificado && alternar(d.fecha)} />))}</div>}

      {sel.length > 0 && (
        <div className="actionbar">
          <button className="btn" onClick={() => setAbierto(true)}>Justificar {sel.length} {sel.length === 1 ? 'día' : 'días'}</button>
        </div>
      )}

      <JustifySheet abierto={abierto} onCerrar={() => setAbierto(false)}
        resumen={`${sel.length} días seleccionados`} desde={ordenadas[0]} hasta={ordenadas[ordenadas.length - 1]}
        onGuardar={guardar} />
    </>
  );
}
