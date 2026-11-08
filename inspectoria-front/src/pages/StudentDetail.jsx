import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import AttendanceRow from '../components/AttendanceRow.jsx';
import JustifySheet from '../components/JustifySheet.jsx';
import { EmptyState } from '../components/Skeleton.jsx';

// Ficha del alumno: días con asistencia + justificativo en una lista.
// Marcas los días ausentes y justificas el rango con un solo panel.
export default function StudentDetail() {
  const { rut } = useParams();
  const [dias] = useState([]);                 // [{ fecha, estado, justificado }]  TODO: API
  const [sel, setSel] = useState([]);          // fechas seleccionadas
  const [abierto, setAbierto] = useState(false);

  const alternar = (f) => setSel((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]));
  const ordenadas = [...sel].sort();

  return (
    <>
      <Link to="/alumnos" className="muted row" style={{ justifyContent: 'flex-start', gap: 4 }}><ChevronLeft size={16} />Alumnos</Link>
      <section className="card">
        <h2>Alumno</h2>
        <p className="muted">{decodeURIComponent(rut)}</p>
      </section>

      {dias.length === 0
        ? <EmptyState texto="Aquí aparecerán los días con su asistencia y justificativos." filas={4} />
        : <div className="list cols">{dias.map((d) => (
            <AttendanceRow key={d.fecha} titulo={d.fecha} estado={d.estado} justificado={d.justificado}
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
        onGuardar={() => { /* TODO: POST justificativo */ setAbierto(false); setSel([]); }} />
    </>
  );
}
