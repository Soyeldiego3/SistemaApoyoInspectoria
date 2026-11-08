import { useState } from 'react';
import AttendanceRow from '../components/AttendanceRow.jsx';
import JustifySheet from '../components/JustifySheet.jsx';
import Segmented from '../components/Segmented.jsx';
import { EmptyState } from '../components/Skeleton.jsx';

// Auditar: curso + fecha -> lista del día con su estado de justificativo, todo en una pantalla.
export default function Audit() {
  const [curso, setCurso] = useState('');
  const [fecha, setFecha] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [filas, setFilas] = useState([]);       // [{ rut, nombre, estado, justificado }]
  const [elegido, setElegido] = useState(null); // fila abierta en el panel

  const buscar = (e) => {
    e.preventDefault();
    // TODO: leer del .sqlite vía API con curso y fecha -> setFilas(...)
  };

  const visibles = filas.filter((f) =>
    filtro === 'todos' ? true : filtro === 'sin' ? !f.justificado : f.justificado);

  return (
    <>
      <form className="card form filters" onSubmit={buscar}>
        <div className="grid2">
          <div className="field"><label htmlFor="c">Curso</label>
            <input id="c" className="input" placeholder="Ej. 2°A" value={curso} onChange={(e) => setCurso(e.target.value)} /></div>
          <div className="field"><label htmlFor="f">Fecha</label>
            <input id="f" type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        </div>
        <button className="btn" disabled={!curso || !fecha}>Ver asistencia</button>
      </form>

      <Segmented valor={filtro} onChange={setFiltro}
        opciones={[{ id: 'todos', label: 'Todos' }, { id: 'sin', label: 'Sin justificar' }, { id: 'ok', label: 'Justificados' }]} />

      {visibles.length === 0
        ? <EmptyState texto="Elige un curso y una fecha para ver la asistencia." />
        : <div className="list cols">{visibles.map((f) => (
            <AttendanceRow key={f.rut} titulo={f.nombre} detalle={f.rut} estado={f.estado} justificado={f.justificado}
              onClick={() => setElegido(f)} />))}</div>}

      <JustifySheet abierto={!!elegido} onCerrar={() => setElegido(null)}
        resumen={elegido?.nombre} desde={fecha} hasta={fecha}
        onGuardar={() => { /* TODO: POST justificativo */ setElegido(null); }} />
    </>
  );
}
