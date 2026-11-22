import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import BarsChart from '../components/BarsChart.jsx';
import DonutChart from '../components/DonutChart.jsx';
import CalendarioInasistencias from '../components/CalendarioInasistencias.jsx';
import InasistenciasDiaSheet from '../components/InasistenciasDiaSheet.jsx';
import Segmented from '../components/Segmented.jsx';
import { getCursos, getGraficos } from '../api.js';
import { useTema } from '../tema.jsx';

const CURSO_STORAGE_KEY = 'inspectoria.graficos.curso';
const ESCALA_STORAGE_KEY = 'inspectoria.graficos.escala';
const DESPLAZAMIENTO_STORAGE_KEY = 'inspectoria.graficos.desplazamiento';
const ESCALAS = [
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
];

// Lee/guarda en sessionStorage sin romper la página si el navegador no lo permite
const leerSesion = (clave) => {
  try { return sessionStorage.getItem(clave); } catch { return null; }
};
const guardarSesion = (clave, valor) => {
  try { sessionStorage.setItem(clave, String(valor)); } catch { /* sin almacenamiento: solo se pierde al volver */ }
};

const fechaLocal = (fecha) => {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// "2026-11-03" -> "03-11"
const fechaCorta = (fecha) => (fecha ? `${fecha.slice(8, 10)}-${fecha.slice(5, 7)}` : '');
const textoPeriodo = (rango) => (rango?.desde ? `${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)}` : 'sin datos');

// Semana (lunes a domingo) o mes completo; desplazamiento 0 = actual, -1 = anterior, etc.
function rangoDe(escala, desplazamiento) {
  const hoy = new Date();
  if (escala === 'semana') {
    const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    lunes.setDate(lunes.getDate() - (hoy.getDay() === 0 ? 6 : hoy.getDay() - 1) + desplazamiento * 7);
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    const desde = fechaLocal(lunes);
    const hasta = fechaLocal(domingo);
    return { desde, hasta, etiqueta: `Semana del ${fechaCorta(desde)} al ${fechaCorta(hasta)}` };
  }
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth() + desplazamiento, 1);
  const fin = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0);
  const mes = inicio.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return { desde: fechaLocal(inicio), hasta: fechaLocal(fin), etiqueta: mes.charAt(0).toUpperCase() + mes.slice(1) };
}

// Gráficos de los datos sincronizados, filtrables por semana o mes y por curso
export default function Charts() {
  const { colores } = useTema();
  // Escala y período se recuerdan en la sesión: al volver desde la ficha de un alumno se ve lo mismo
  const [escala, setEscala] = useState(() => (
    ESCALAS.some((e) => e.id === leerSesion(ESCALA_STORAGE_KEY)) ? leerSesion(ESCALA_STORAGE_KEY) : 'mes'
  ));
  const [desplazamiento, setDesplazamiento] = useState(() => {
    const guardado = Number(leerSesion(DESPLAZAMIENTO_STORAGE_KEY));
    return Number.isInteger(guardado) && guardado <= 0 ? guardado : 0;
  });
  const rango = rangoDe(escala, desplazamiento);

  useEffect(() => {
    guardarSesion(ESCALA_STORAGE_KEY, escala);
    guardarSesion(DESPLAZAMIENTO_STORAGE_KEY, desplazamiento);
  }, [escala, desplazamiento]);
  const [curso, setCurso] = useState(() => sessionStorage.getItem(CURSO_STORAGE_KEY) || '');
  const [cursos, setCursos] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  // Día elegido en el calendario: abre el panel con los alumnos inasistentes
  const [diaElegido, setDiaElegido] = useState(null);
  const cerrarDia = useCallback(() => setDiaElegido(null), []);

  useEffect(() => {
    getCursos()
      .then((data) => setCursos(data.cursos.map((c) => c.curso)))
      .catch(() => setCursos([]));
  }, []);

  useEffect(() => {
    if (curso) sessionStorage.setItem(CURSO_STORAGE_KEY, curso);
    else sessionStorage.removeItem(CURSO_STORAGE_KEY);

    let activo = true;
    setCargando(true);
    setError('');
    getGraficos({ curso, desde: rango.desde, hasta: rango.hasta })
      .then((data) => { if (activo) setDatos(data); })
      .catch((e) => {
        if (activo) setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : (e.message || 'No se pudieron cargar los gráficos.'));
      })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [curso, rango.desde, rango.hasta]);

  const cambiarEscala = (nueva) => {
    setEscala(nueva);
    setDesplazamiento(0);
  };
  // No se avanza al futuro ni se retrocede antes del dato más antiguo de la base
  const puedeRetroceder = Boolean(datos?.disponible?.desde) && rango.desde > datos.disponible.desde;
  const puedeAvanzar = desplazamiento < 0;

  const sinDatos = !cargando && !error && datos && !datos.periodo.asistencia.desde && !datos.periodo.atrasos.desde;
  const { justificados = 0, sinJustificar = 0 } = datos?.justificacion || {};
  const torta = justificados + sinJustificar
    ? [
      { name: 'Justificados', value: justificados, color: colores.ok },
      { name: 'Sin justificar', value: sinJustificar, color: colores.bad },
    ]
    : [];
  const top = datos?.topAtrasos || [];
  const maxTop = top[0]?.atrasos || 1;

  return (
    <div className="dash">
      <h2>Gráficos</h2>

      <Segmented opciones={ESCALAS} valor={escala} onChange={cambiarEscala} />
      <div className="row">
        <button type="button" className="iconbtn audit-sync" onClick={() => setDesplazamiento((d) => d - 1)}
          disabled={!puedeRetroceder || cargando} aria-label={escala === 'semana' ? 'Semana anterior' : 'Mes anterior'}>
          <ChevronLeft size={20} />
        </button>
        <b>{rango.etiqueta}</b>
        <button type="button" className="iconbtn audit-sync" onClick={() => setDesplazamiento((d) => d + 1)}
          disabled={!puedeAvanzar || cargando} aria-label={escala === 'semana' ? 'Semana siguiente' : 'Mes siguiente'}>
          <ChevronRight size={20} />
        </button>
      </div>

      <select className="input curso" value={curso} onChange={(e) => setCurso(e.target.value)} disabled={!cursos.length} aria-label="Filtrar por curso">
        <option value="">Todos los cursos</option>
        {cursos.map((c) => <option key={c}>{c}</option>)}
      </select>

      {datos && (
        <p className="muted">
          Asistencia: {textoPeriodo(datos.periodo.asistencia)} · Atrasos: {textoPeriodo(datos.periodo.atrasos)}
        </p>
      )}

      {error && <p className="msg" role="alert" style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}>{error}</p>}

      {sinDatos ? (
        <section className="card" role="status">
          <h2>No hay datos para este período</h2>
          <p className="muted" style={{ marginTop: 8 }}>Prueba otro período o sincroniza desde Ajustes.</p>
        </section>
      ) : (
        <div className="charts">
          <section className="card">
            <h2>Asistencia por curso</h2>
            <p className="muted" style={{ marginBottom: 8 }}>% de registros presentes</p>
            <BarsChart data={datos?.asistenciaPorCurso || []} dataKey="asistencia" ejeX="curso" horizontal valores sufijo="%" color="graf-1" />
          </section>
          <section className="card">
            <h2>Atrasos por curso</h2>
            <p className="muted" style={{ marginBottom: 8 }}>Cantidad en el período</p>
            <BarsChart data={datos?.atrasosPorCurso || []} dataKey="atrasos" ejeX="curso" horizontal valores color="graf-2" />
          </section>
          <section className="card">
            <h2>Justificados vs sin justificar</h2>
            <p className="muted" style={{ marginBottom: 8 }}>Atrasos e inasistencias</p>
            <DonutChart data={torta} />
          </section>
          <section className="card grafico-ancho">
            <h2>Inasistencias día a día</h2>
            <p className="muted" style={{ marginBottom: 8 }}>Cada día muestra su fecha (arriba) y la cantidad de inasistencias (abajo)</p>
            <CalendarioInasistencias desde={rango.desde} hasta={rango.hasta} dias={datos?.inasistenciasPorDia || []} onElegirDia={setDiaElegido} />
          </section>
          <section className="card">
            <h2>Más atrasos sin justificar</h2>
            <p className="muted" style={{ marginBottom: 8 }}>Top {top.length || 5} alumnos</p>
            {top.length ? (
              <div className="list">
                {top.map((a) => (
                  <Link key={a.rut} to={`/alumnos/${encodeURIComponent(a.rut)}?vista=atrasos`}
                    state={{ returnTo: '/graficos', returnLabel: 'Gráficos' }} className="item" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, background: 'var(--card-2)' }}>
                    <div className="row">
                      <span><b>{a.nombres} {a.apellidos}</b><span className="muted">{a.curso}</span></span>
                      <span className="tag warn">{a.atrasos}</span>
                    </div>
                    <div className="bar"><i style={{ width: `${a.atrasos / maxTop * 100}%`, background: 'var(--graf-2)' }} /></div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted">{cargando ? 'Cargando…' : 'Sin atrasos sin justificar en el período.'}</p>
            )}
          </section>
        </div>
      )}

      <InasistenciasDiaSheet fecha={diaElegido} curso={curso} onCerrar={cerrarDia} />
    </div>
  );
}
