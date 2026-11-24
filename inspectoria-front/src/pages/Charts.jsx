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
import { fechaLocal } from '../fechas.js';

const CURSO_STORAGE_KEY = 'inspectoria.graficos.curso';
const ESCALA_STORAGE_KEY = 'inspectoria.graficos.escala';
const DESPLAZAMIENTO_STORAGE_KEY = 'inspectoria.graficos.desplazamiento';
const TOP_STORAGE_KEY = 'inspectoria.graficos.top';
// Los dos rankings que se alternan con las flechas en la misma tarjeta
const TOPS = {
  atrasos: { titulo: 'Más atrasos sin justificar', campo: 'atrasos', datos: 'topAtrasos', color: 'var(--graf-2)', tag: 'warn', vista: 'atrasos', vacio: 'Sin atrasos sin justificar en el período.' },
  inasistencias: { titulo: 'Más inasistencias sin justificar', campo: 'inasistencias', datos: 'topInasistencias', color: 'var(--graf-3)', tag: 'bad', vista: 'inasistencias', vacio: 'Sin inasistencias sin justificar en el período.' },
};
const ESCALAS = [
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'anio', label: 'Año' },
];
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const ETIQUETA_DESPLAZAR = {
  semana: ['Semana anterior', 'Semana siguiente'],
  mes: ['Mes anterior', 'Mes siguiente'],
  anio: ['Año anterior', 'Año siguiente'],
};

// Lee/guarda en sessionStorage sin romper la página si el navegador no lo permite
const leerSesion = (clave) => {
  try { return sessionStorage.getItem(clave); } catch { return null; }
};
const guardarSesion = (clave, valor) => {
  try { sessionStorage.setItem(clave, String(valor)); } catch { /* sin almacenamiento: solo se pierde al volver */ }
};

// "2026-11-03" -> "03-11"
const fechaCorta = (fecha) => (fecha ? `${fecha.slice(8, 10)}-${fecha.slice(5, 7)}` : '');
const textoPeriodo = (rango) => (rango?.desde ? `${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)}` : 'sin datos');

// Semana (lunes a domingo), mes completo o año escolar (marzo a diciembre);
// desplazamiento 0 = actual, -1 = anterior, etc.
function rangoDe(escala, desplazamiento) {
  const hoy = new Date();
  if (escala === 'anio') {
    const anio = hoy.getFullYear() + desplazamiento;
    return { desde: `${anio}-03-01`, hasta: `${anio}-12-31`, etiqueta: `Año escolar ${anio}` };
  }
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
  // Ranking visible en la tarjeta Top 5 (se recuerda al volver desde la ficha de un alumno)
  const [topTipo, setTopTipo] = useState(() => (TOPS[leerSesion(TOP_STORAGE_KEY)] ? leerSesion(TOP_STORAGE_KEY) : 'atrasos'));
  useEffect(() => { guardarSesion(TOP_STORAGE_KEY, topTipo); }, [topTipo]);
  const alternarTop = () => setTopTipo((t) => (t === 'atrasos' ? 'inasistencias' : 'atrasos'));

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

  // Clic en una barra de curso: filtra por ese curso; otro clic en el mismo vuelve a "Todos"
  const elegirCurso = (c) => setCurso((actual) => (actual === c ? '' : c));

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
  const configTop = TOPS[topTipo];
  const top = datos?.[configTop.datos] || [];
  const maxTop = top[0]?.[configTop.campo] || 1;
  const porAlumno = datos?.asistenciaPorAlumno || [];
  // Escala Año: total de inasistencias de cada mes del año escolar (marzo a diciembre, igual que rangoDe)
  const porMes = MESES.slice(2).map((mes, i) => ({
    mes,
    inasistencias: (datos?.inasistenciasPorDia || [])
      .filter((d) => Number(d.fecha.slice(5, 7)) === i + 3)
      .reduce((suma, d) => suma + d.inasistencias, 0),
  }));

  return (
    <div className="dash">
      <h2>Gráficos</h2>

      <Segmented opciones={ESCALAS} valor={escala} onChange={cambiarEscala} />
      <div className="row">
        <button type="button" className="iconbtn audit-sync" onClick={() => setDesplazamiento((d) => d - 1)}
          disabled={!puedeRetroceder || cargando} aria-label={ETIQUETA_DESPLAZAR[escala][0]}>
          <ChevronLeft size={20} />
        </button>
        <b>{rango.etiqueta}</b>
        <button type="button" className="iconbtn audit-sync" onClick={() => setDesplazamiento((d) => d + 1)}
          disabled={!puedeAvanzar || cargando} aria-label={ETIQUETA_DESPLAZAR[escala][1]}>
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

      {error && <p className="msg error" role="alert">{error}</p>}

      {sinDatos ? (
        <section className="card" role="status">
          <h2>No hay datos para este período</h2>
          <p className="muted" style={{ marginTop: 8 }}>Prueba otro período o sincroniza desde Ajustes.</p>
        </section>
      ) : (
        <div className="charts">
          <section className="card">
            <h2>Asistencia por curso</h2>
            <p className="muted" style={{ marginBottom: 8 }}>% de registros presentes · toca un curso para filtrar</p>
            <BarsChart data={datos?.asistenciaPorCurso || []} dataKey="asistencia" ejeX="curso" horizontal valores sufijo="%" color="graf-1"
              resaltado={curso} onElegir={elegirCurso} />
          </section>
          <section className="card">
            <h2>Atrasos por curso</h2>
            <p className="muted" style={{ marginBottom: 8 }}>Cantidad en el período · toca un curso para filtrar</p>
            <BarsChart data={datos?.atrasosPorCurso || []} dataKey="atrasos" ejeX="curso" horizontal valores color="graf-2"
              resaltado={curso} onElegir={elegirCurso} />
          </section>
          <section className="card">
            <h2>Justificados vs sin justificar</h2>
            <p className="muted" style={{ marginBottom: 8 }}>Atrasos e inasistencias</p>
            <DonutChart data={torta} />
          </section>
          {escala === 'anio' ? (
            <section className="card grafico-ancho">
              <h2>Inasistencias por mes</h2>
              <p className="muted" style={{ marginBottom: 8 }}>Total de cada mes del año escolar</p>
              <BarsChart data={porMes} dataKey="inasistencias" ejeX="mes" valores color="graf-3" />
            </section>
          ) : (
            <section className="card grafico-ancho">
              <h2>Inasistencias día a día</h2>
              <p className="muted" style={{ marginBottom: 8 }}>Cada día muestra su fecha (arriba) y la cantidad de inasistencias (abajo)</p>
              <CalendarioInasistencias desde={rango.desde} hasta={rango.hasta} dias={datos?.inasistenciasPorDia || []} onElegirDia={setDiaElegido} />
            </section>
          )}
          <section className="card">
            <h2>Inasistencias por día de la semana</h2>
            <p className="muted" style={{ marginBottom: 8 }}>Total en el período</p>
            <BarsChart data={datos?.inasistenciasPorDiaSemana || []} dataKey="inasistencias" ejeX="dia" valores color="graf-3" />
          </section>
          {/* Se estira al alto de la fila (lo define el Top 5 de al lado); la lista llena el resto con scroll */}
          <section className="card grafico-ancho" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2>Asistencia por alumno</h2>
            {!curso ? (
              <p className="muted" style={{ marginTop: 8 }}>Elige un curso en el selector o toca una barra de curso para ver la asistencia de cada alumno.</p>
            ) : (
              <>
                <p className="muted" style={{ marginBottom: 8 }}>{curso} · % de registros presentes, de menor a mayor</p>
                {porAlumno.length ? (
                  // Lista en posición absoluta: no aporta alto a la fila, solo ocupa el espacio que queda
                  <div style={{ flex: 1, position: 'relative', minHeight: 300 }}>
                    <div className="list" style={{ position: 'absolute', inset: 0, overflowY: 'auto', overscrollBehavior: 'contain', alignContent: 'start' }}>
                      {porAlumno.map((a) => (
                        <Link key={a.rut} to={`/alumnos/${encodeURIComponent(a.rut)}?vista=inasistencias`}
                          state={{ returnTo: '/graficos', returnLabel: 'Gráficos' }} className="item" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, background: 'var(--card-2)' }}>
                          <div className="row">
                            <b>{a.nombres} {a.apellidos}</b>
                            {/* 85 %: mínimo de asistencia para la promoción */}
                            <span className={`tag ${a.asistencia < 85 ? 'bad' : 'ok'}`}>{a.asistencia}%</span>
                          </div>
                          <div className="bar"><i style={{ width: `${a.asistencia}%`, background: 'var(--graf-1)' }} /></div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="muted">{cargando ? 'Cargando…' : 'Sin registros de asistencia en el período.'}</p>
                )}
              </>
            )}
          </section>
          <section className="card">
            <div className="row">
              <button type="button" className="iconbtn audit-sync" onClick={alternarTop} aria-label="Ver el otro ranking">
                <ChevronLeft size={20} />
              </button>
              <h2>{configTop.titulo}</h2>
              <button type="button" className="iconbtn audit-sync" onClick={alternarTop} aria-label="Ver el otro ranking">
                <ChevronRight size={20} />
              </button>
            </div>
            <p className="muted" style={{ margin: '6px 0 8px' }}>
              Top {top.length || 5} alumnos · {topTipo === 'atrasos' ? '1' : '2'} de 2
            </p>
            {top.length ? (
              <div className="list">
                {top.map((a) => (
                  <Link key={a.rut} to={`/alumnos/${encodeURIComponent(a.rut)}?vista=${configTop.vista}`}
                    state={{ returnTo: '/graficos', returnLabel: 'Gráficos' }} className="item" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, background: 'var(--card-2)' }}>
                    <div className="row">
                      <span><b>{a.nombres} {a.apellidos}</b><span className="muted">{a.curso}</span></span>
                      <span className={`tag ${configTop.tag}`}>{a[configTop.campo]}</span>
                    </div>
                    <div className="bar"><i style={{ width: `${a[configTop.campo] / maxTop * 100}%`, background: configTop.color }} /></div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted">{cargando ? 'Cargando…' : configTop.vacio}</p>
            )}
          </section>
        </div>
      )}

      <InasistenciasDiaSheet fecha={diaElegido} curso={curso} onCerrar={cerrarDia} />
    </div>
  );
}
