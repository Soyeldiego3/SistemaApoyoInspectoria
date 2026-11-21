import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Segmented from '../components/Segmented.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import {
  getAuditoriaCursos,
  getAuditoriaEstado,
  getAuditoriaPrioridad,
  getCredencialesPortal,
  getCursos,
  iniciarSync,
} from '../api.js';
import { fechaCorta, tituloMes } from '../fechas.js';

const TABS = [
  { id: 'prioridad', label: 'A quién citar' },
  { id: 'cursos', label: 'Comparar cursos' },
];

const TIPOS = [
  { id: 'ambos', label: 'Ambos' },
  { id: 'inasistencias', label: 'Inasistencias' },
  { id: 'atrasos', label: 'Atrasos' },
];

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'personalizado', label: 'Personalizado…' },
];

const MENSAJES_PORTAL = {
  LOGIN_RECHAZADO: 'El portal rechazó el usuario o la contraseña',
  PORTAL_INACCESIBLE: 'No se pudo conectar con el portal; revisa la red o la URL',
  NAVEGADOR_NO_DISPONIBLE: 'No se encontró Microsoft Edge',
  ESTRUCTURA_CAMBIADA: 'El portal cambió y no se pudo extraer la información',
};

const fechaLocal = (fecha) => {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

function rangoPeriodo(periodo, personalizadoDesde = '', personalizadoHasta = '') {
  const hoy = new Date();
  const fin = fechaLocal(hoy);
  if (periodo === 'ayer') {
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    const fecha = fechaLocal(ayer);
    return { desde: fecha, hasta: fecha };
  }
  if (periodo === 'semana') {
    const inicio = new Date(hoy);
    inicio.setDate(hoy.getDate() - (hoy.getDay() === 0 ? 6 : hoy.getDay() - 1));
    return { desde: fechaLocal(inicio), hasta: fin };
  }
  if (periodo === 'mes') {
    return { desde: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`, hasta: fin };
  }
  if (periodo === 'personalizado') {
    return { desde: personalizadoDesde, hasta: personalizadoHasta };
  }
  return { desde: fin, hasta: fin };
}

function mostrarRango(datos) {
  if (!datos?.rango?.desde || !datos?.rango?.hasta) return 'Sin rango con datos suficientes';
  return `${datos.rango.desde} a ${datos.rango.hasta}`;
}

function haceCuanto(fechaIso) {
  if (!fechaIso) return null;
  const diferencia = Date.now() - new Date(fechaIso).getTime();
  if (!Number.isFinite(diferencia) || diferencia < 0) return 'recién';
  const minutos = Math.floor(diferencia / 60000);
  if (minutos < 1) return 'hace menos de 1 minuto';
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} hora${horas === 1 ? '' : 's'}`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} día${dias === 1 ? '' : 's'}`;
}

// '25990754-3' → '25.990.754-3'
function formatearRut(rut) {
  const [cuerpo, dv] = String(rut).split('-');
  if (!dv || !/^\d+$/.test(cuerpo)) return rut;
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

const plural = (n, singular, pluralTexto = `${singular}s`) => `${n} ${n === 1 ? singular : pluralTexto}`;

const NIVELES = {
  alta: { label: 'Prioridad alta', clase: 'bad' },
  media: { label: 'Prioridad media', clase: 'warn' },
  baja: { label: 'Prioridad baja', clase: '' },
};

function Resumen({ datos }) {
  const resumen = datos?.resumen;
  const porcentaje = resumen?.incidencias
    ? `${((resumen.sinJustificar / resumen.incidencias) * 100).toFixed(1)}%`
    : '—';
  return (
    <div className="kpis">
      <section className="card">
        <p className="muted">Incidencias</p>
        <div className="big">{resumen?.incidencias ?? '—'}</div>
        {resumen?.incidencias != null && (
          <p className="muted detalle">
            {plural(resumen.inasistencias ?? 0, 'inasistencia')} · {plural(resumen.atrasos ?? 0, 'atraso')}
          </p>
        )}
      </section>
      <section className="card">
        <p className="muted">% sin justificar</p>
        <div className="big">{porcentaje}</div>
        {resumen?.incidencias ? (
          <p className="muted detalle">{resumen.sinJustificar} de {resumen.incidencias} incidencias</p>
        ) : null}
      </section>
      <section className="card">
        <p className="muted">Alumnos con pendientes</p>
        <div className="big">{resumen?.alumnosAfectados ?? '—'}</div>
        <p className="muted detalle">Con al menos una incidencia sin justificar</p>
      </section>
    </div>
  );
}

function describirMeses(meses = []) {
  const nombre = (clave) => tituloMes(clave).split(' ')[0].toLowerCase();
  if (!meses.length) return '';
  return meses.length === 1 ? nombre(meses[0]) : `${nombre(meses[0])} a ${nombre(meses.at(-1))}`;
}

// Avisos de cobertura. Si falta asistencia de algunos meses se ofrece descargarlos aparte;
// lo de atrasos es solo informativo (el portal no entrega atrasos antiguos).
function Avisos({ datos, onDescargar, descargando }) {
  if (!datos?.advertencias?.length) return null;
  const faltaAsistencia = datos.faltantes?.asistencia;
  return (
    <div className="msg aviso" role="status">
      {datos.advertencias.map((aviso) => <p key={aviso}>{aviso}</p>)}
      {faltaAsistencia && onDescargar && (
        <button className="btn" type="button" disabled={descargando}
          onClick={() => onDescargar(faltaAsistencia)}>
          <RefreshCw size={16} className={descargando ? 'audit-spin' : undefined} style={{ verticalAlign: -3, marginRight: 8 }} />
          {descargando
            ? 'Descargando… puede tardar unos minutos'
            : `Descargar asistencia de ${describirMeses(faltaAsistencia.meses)}`}
        </button>
      )}
    </div>
  );
}

// Señales cortas (chips) en vez de una frase larga
function senales(alumno, criterios) {
  const c = alumno.componentes;
  const lista = [];
  if (c.inasistenciasSinJustificar) lista.push(plural(c.inasistenciasSinJustificar, 'falta sin justificar', 'faltas sin justificar'));
  if (c.atrasosSinJustificar) lista.push(plural(c.atrasosSinJustificar, 'atraso sin justificar', 'atrasos sin justificar'));
  if (c.ausenciasConsecutivas > 1) lista.push(`${c.ausenciasConsecutivas} faltas seguidas`);
  if (c.tendenciaReciente) lista.push(`${c.tendenciaReciente} en los últimos ${criterios?.diasRecientes ?? 7} días`);
  return lista;
}

function AyudaPrioridad({ criterios }) {
  if (!criterios) return null;
  const p = criterios.pesos;
  return (
    <details className="card audit-ayuda">
      <summary>¿Cómo se ordena esta lista?</summary>
      <ul>
        <li><b className="tag bad" style={{ display: 'inline' }}>Alta</b>{' '}
          asistencia bajo {criterios.asistenciaMinima}% (mínimo para la promoción),
          {' '}{criterios.rachaAlta} o más faltas seguidas sin justificar,
          o {criterios.atrasosAlta} o más atrasos sin justificar.</li>
        <li><b className="tag warn" style={{ display: 'inline' }}>Media</b>{' '}
          asistencia bajo {criterios.asistenciaAlerta}%, {criterios.atrasosMedia} o más atrasos sin justificar,
          o {criterios.recientesMedia} o más incidencias sin justificar en los últimos {criterios.diasRecientes} días.</li>
        <li><b className="tag" style={{ display: 'inline' }}>Baja</b> tiene incidencias, pero no cumple lo anterior.</li>
      </ul>
      <p className="muted">
        La asistencia solo se evalúa con {criterios.minDiasRegistrados} o más días registrados en el rango.
        Dentro de cada nivel se ordena por gravedad: cada falta sin justificar suma {p.inasistencia},
        cada atraso sin justificar {p.atraso}, cada falta de la racha más larga {p.racha}
        y cada incidencia reciente {p.reciente}. Las faltas justificadas no suman.
      </p>
    </details>
  );
}

function Prioridad({ datos, tipo, rutaRetorno }) {
  const [nivel, setNivel] = useState('todos');
  if (!datos?.alumnos?.length) return <EmptyState texto="Sin datos en este rango." filas={3} />;
  // Con un tipo elegido, la ficha se abre en esa pestaña (los ids coinciden con sus vistas)
  const vista = tipo !== 'ambos' ? `?vista=${tipo}` : '';
  const criterios = datos.criterios;
  const niveles = datos.resumen?.niveles;
  const opciones = [
    { id: 'todos', label: `Todos (${datos.alumnos.length})` },
    { id: 'alta', label: `Alta (${niveles?.alta ?? 0})` },
    { id: 'media', label: `Media (${niveles?.media ?? 0})` },
  ];
  const visibles = nivel === 'todos' ? datos.alumnos : datos.alumnos.filter((a) => a.nivel === nivel);
  return (
    <>
      <AyudaPrioridad criterios={criterios} />
      <Segmented valor={nivel} onChange={setNivel} opciones={opciones} />
      {!visibles.length && <p className="muted">Ningún alumno en este nivel.</p>}
      <div className="list">
        {visibles.map((alumno) => {
          const info = NIVELES[alumno.nivel] || NIVELES.baja;
          const pct = alumno.porcentajeAsistencia;
          const clasePct = pct == null || !criterios ? ''
            : pct < criterios.asistenciaMinima ? 'bad'
              : pct < criterios.asistenciaAlerta ? 'warn' : '';
          const chips = senales(alumno, criterios);
          return (
            <Link key={alumno.rut} to={`/alumnos/${encodeURIComponent(alumno.rut)}${vista}`}
              state={{ returnTo: rutaRetorno, returnLabel: 'Auditar' }} className="item alumno">
              <div>
                <b>{alumno.nombres} {alumno.apellidos}</b>
                <span className="muted audit-meta">{alumno.curso} · {formatearRut(alumno.rut)}</span>
                {chips.length > 0 && (
                  <div className="tags start audit-senales">
                    {chips.map((chip) => <span key={chip} className="tag">{chip}</span>)}
                  </div>
                )}
                {alumno.razonesNivel?.length > 0 && (
                  <span className="muted audit-razones">Motivo: {alumno.razonesNivel.join('; ')}.</span>
                )}
              </div>
              <div className="tags audit-nivel">
                <span className={`tag ${info.clase}`}>{info.label}</span>
                {pct != null && tipo !== 'atrasos' && (
                  <span className={`tag ${clasePct}`}
                    title={`${alumno.diasRegistrados} días registrados en el rango`}>
                    Asistencia {pct}%
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function Cursos({ datos }) {
  if (!datos?.cursos?.length) return <EmptyState texto="Sin datos en este rango." filas={3} />;
  return (
    <>
    {datos.promedioGeneralInasistencia != null && (
      <p className="muted">
        Desvío: puntos porcentuales de inasistencia sobre (+) o bajo (−) el promedio del colegio
        ({datos.promedioGeneralInasistencia}%).
      </p>
    )}
    <div className="list">
      {datos.cursos.map((curso) => (
        <section className="item" key={curso.curso}>
          <div>
            <b>{curso.curso}</b>
            <span className="muted">Sobre {curso.denominador} registros · {curso.diasRegistrados} días · {curso.alumnosMatriculados} alumnos</span>
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
    </>
  );
}

// Filtros que vienen en la URL al volver desde la ficha de un alumno (null si no hay)
function filtrosDesdeUrl(search) {
  const p = new URLSearchParams(search);
  if (![...p.keys()].length) return null;
  const valido = (lista, valor, porDefecto) => (lista.some((o) => o.id === valor) ? valor : porDefecto);
  const periodo = valido(PERIODOS, p.get('periodo'), 'hoy');
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
  const rango = periodo === 'personalizado'
    ? { desde: fecha(p.get('desde')), hasta: fecha(p.get('hasta')) }
    : rangoPeriodo(periodo);
  return {
    tab: valido(TABS, p.get('tab'), 'prioridad'),
    tipo: valido(TIPOS, p.get('tipo'), 'ambos'),
    curso: p.get('curso') || '',
    periodo,
    ...rango,
  };
}

export default function Audit() {
  const navigate = useNavigate();
  const location = useLocation();
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const [restaurados] = useState(() => filtrosDesdeUrl(location.search));
  const [tab, setTab] = useState(restaurados?.tab ?? 'prioridad');
  const [tipo, setTipo] = useState(restaurados?.tipo ?? 'ambos');
  const [curso, setCurso] = useState(restaurados?.curso ?? '');
  const [periodo, setPeriodo] = useState(restaurados?.periodo ?? 'hoy');
  const [desde, setDesde] = useState(restaurados?.desde ?? '');
  const [hasta, setHasta] = useState(restaurados?.hasta ?? '');
  const [cursos, setCursos] = useState([]);
  const [datos, setDatos] = useState(null);
  const [estadoDatos, setEstadoDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState('');
  const [avisoRango, setAvisoRango] = useState('');
  const [recarga, setRecarga] = useState(0);
  const consultaAbortRef = useRef(null);
  const syncAbortRef = useRef(null);

  const cargarResultados = async (parametros, signal) => {
    const respuesta = await (tab === 'prioridad'
      ? getAuditoriaPrioridad(parametros, { signal })
      : getAuditoriaCursos(parametros, { signal }));
    if (!signal?.aborted) setDatos(respuesta);
  };

  useEffect(() => {
    let activo = true;
    Promise.all([getCursos(), getAuditoriaEstado()])
      .then(([cursosRespuesta, estado]) => {
        if (!activo) return;
        setCursos(cursosRespuesta.cursos || []);
        setEstadoDatos(estado);
        // Al volver desde la ficha de un alumno se respetan los filtros que traía
        if (restaurados) {
          if (!restaurados.desde && !restaurados.hasta) setCargando(false);
          return;
        }
        const hoy = fechaLocal(new Date());
        const ultima = [estado.ultimaFechaAsistencia, estado.ultimaFechaAtrasos]
          .filter(Boolean)
          .sort()
          .at(-1) || null;
        if (!ultima) {
          setPeriodo('hoy');
          setDesde(hoy);
          setHasta(hoy);
          setCargando(false);
          return;
        }
        if (ultima === hoy || [estado.ultimaFechaAsistencia, estado.ultimaFechaAtrasos].includes(hoy)) {
          setPeriodo('hoy');
          setDesde(hoy);
          setHasta(hoy);
        } else {
          setPeriodo('personalizado');
          setDesde(ultima);
          setHasta(ultima);
          setAvisoRango(`Mostrando el ${fechaCorta(ultima)}, último día sincronizado`);
        }
      })
      .catch((e) => {
        if (activo) {
          setError(e.message || 'No se pudo cargar el estado de los datos.');
          setCargando(false);
        }
      });
    return () => { activo = false; };
  }, []);

  const parametros = useMemo(() => {
    const rango = rangoPeriodo(periodo, desde, hasta);
    const resultado = { tipo };
    if (curso) resultado.curso = curso;
    if (rango.desde) resultado.desde = rango.desde;
    if (rango.hasta) resultado.hasta = rango.hasta;
    return resultado;
  }, [curso, desde, hasta, periodo, tipo]);

  useEffect(() => {
    if (!desde && !hasta && periodo === 'hoy') return undefined;
    const temporizador = setTimeout(() => {
      consultaAbortRef.current?.abort();
      const controller = new AbortController();
      consultaAbortRef.current = controller;
      setCargando(true);
      setError('');
      cargarResultados(parametros, controller.signal)
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message || 'No se pudo calcular la auditoría.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setCargando(false);
        });
    }, 180);
    return () => {
      clearTimeout(temporizador);
      consultaAbortRef.current?.abort();
    };
  }, [parametros, tab, recarga]);

  useEffect(() => () => {
    consultaAbortRef.current?.abort();
    syncAbortRef.current?.abort();
  }, []);

  // Ruta para volver a esta misma vista desde la ficha de un alumno
  const rutaRetorno = useMemo(() => {
    const p = new URLSearchParams();
    if (tab !== 'prioridad') p.set('tab', tab);
    if (tipo !== 'ambos') p.set('tipo', tipo);
    if (curso) p.set('curso', curso);
    if (periodo !== 'hoy') p.set('periodo', periodo);
    if (periodo === 'personalizado') {
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
    }
    // Siempre lleva al menos un parámetro, para que Auditoría sepa que debe restaurar
    if (![...p.keys()].length) p.set('periodo', 'hoy');
    return `/auditar?${p}`;
  }, [tab, tipo, curso, periodo, desde, hasta]);

  const cambiarPeriodo = (nuevoPeriodo) => {
    setPeriodo(nuevoPeriodo);
    setAvisoRango('');
    if (nuevoPeriodo !== 'personalizado') {
      const rango = rangoPeriodo(nuevoPeriodo);
      setDesde(rango.desde);
      setHasta(rango.hasta);
    }
  };

  // Sin argumentos: sincronización normal (mes anterior + actual) y se vuelve a "Hoy".
  // Con `cuerpo` ({ desde, hasta, soloFaltantes }): descarga a pedido de meses antiguos;
  // se mantienen los filtros y solo se recalculan los resultados.
  const sincronizar = async (cuerpo) => {
    const aPedido = Boolean(cuerpo);
    setSincronizando(true);
    setError('');
    syncAbortRef.current?.abort();
    const controller = new AbortController();
    syncAbortRef.current = controller;
    const terminar = async (respuesta) => {
      const estado = await getAuditoriaEstado({ signal: controller.signal });
      setEstadoDatos(estado);
      if (aPedido) {
        const meses = respuesta?.meses?.length || 0;
        const avisos = respuesta?.advertencias?.length ? ` ${respuesta.advertencias.length} aviso(s): ${respuesta.advertencias.join(' ')}` : '';
        setAvisoRango(meses
          ? `Se descargó la asistencia de ${plural(meses, 'mes', 'meses')}.${avisos}`
          : (respuesta?.mensaje || 'No había meses pendientes.'));
        setRecarga((n) => n + 1);
        return;
      }
      const hoy = fechaLocal(new Date());
      setPeriodo('hoy');
      setDesde(hoy);
      setHasta(hoy);
      setAvisoRango('');
    };
    try {
      if (!esPc) {
        await terminar(await iniciarSync(cuerpo, { signal: controller.signal }));
        return;
      }
      const credenciales = await getCredencialesPortal();
      if (!credenciales.guardadas && !credenciales.enMemoria) {
        if (esPc) {
          navigate('/datos', {
            replace: false,
            state: { abrirCredenciales: true, accionModal: 'guardar', mensaje: 'Configura las credenciales del portal para sincronizar.' },
          });
        } else {
          setError('Sincroniza desde el PC.');
        }
        return;
      }
      if (credenciales.invalidas) {
        if (esPc) {
          navigate('/datos', {
            replace: false,
            state: { abrirCredenciales: true, accionModal: 'guardar', mensaje: 'Las credenciales guardadas están inválidas. Actualízalas para continuar.' },
          });
        } else {
          setError('Las credenciales no son válidas. Sincroniza desde el PC.');
        }
        return;
      }
      await terminar(await iniciarSync(cuerpo, { signal: controller.signal }));
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (!esPc && (e.code === 'CREDENCIALES_REQUERIDAS' || e.code === 'LOGIN_RECHAZADO')) {
        setError('Sincroniza desde el PC.');
      } else if (!esPc) {
        setError(MENSAJES_PORTAL[e.code] || e.message || 'No se pudo sincronizar.');
      } else if (MENSAJES_PORTAL[e.code]) {
        setError(MENSAJES_PORTAL[e.code]);
        if (esPc && (e.code === 'LOGIN_RECHAZADO' || e.code === 'CREDENCIALES_REQUERIDAS')) {
          navigate('/datos', {
            replace: false,
            state: { abrirCredenciales: true, accionModal: 'guardar', mensaje: MENSAJES_PORTAL[e.code] },
          });
        }
      } else {
        setError(e.message || 'Ocurrió un error inesperado.');
      }
    } finally {
      setSincronizando(false);
    }
  };

  const tieneDatos = Boolean(estadoDatos?.ultimaFechaAsistencia || estadoDatos?.ultimaFechaAtrasos);
  const ultimaTexto = haceCuanto(estadoDatos?.ultimaSincronizacionExitosa);

  return (
    <>
      <div className="audit-header">
        <h2>Auditar</h2>
      </div>

      <section className="card audit-filters" aria-label="Filtros de auditoría">
        <div className="audit-filter-grid">
          <select className="input" value={curso} onChange={(e) => setCurso(e.target.value)} aria-label="Curso">
            <option value="">Todos los cursos</option>
            {cursos.map((opcion) => <option key={opcion.curso} value={opcion.curso}>{opcion.curso}</option>)}
          </select>
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
            {TIPOS.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.label}</option>)}
          </select>
          <select className="input" value={periodo} onChange={(e) => cambiarPeriodo(e.target.value)} aria-label="Período">
            {PERIODOS.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.label}</option>)}
          </select>
        </div>
        {periodo === 'personalizado' && (
          <div className="audit-custom-dates">
            <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Fecha desde" />
            <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Fecha hasta" />
          </div>
        )}
      </section>

      <Segmented valor={tab} onChange={setTab} opciones={TABS} />

      {ultimaTexto && <p className="muted audit-last-sync">Última sincronización: {ultimaTexto}</p>}
      {avisoRango && <p className="msg" role="status">{avisoRango}</p>}
      {datos && <p className="muted">Rango consultado: {mostrarRango(datos)}</p>}
      {error && <p className="msg" role="alert" style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}>{error}</p>}

      {!cargando && !tieneDatos ? (
        <section className="card" role="status">
          <h2>Sin datos sincronizados</h2>
          <p className="muted" style={{ margin: '8px 0 14px' }}>Sincroniza el portal para comenzar a auditar.</p>
          <button className="btn" type="button" onClick={() => sincronizar()} disabled={sincronizando}>
            <RefreshCw size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
            {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </section>
      ) : cargando ? (
        <EmptyState texto="Calculando señales…" filas={4} />
      ) : (
        <>
          <Avisos datos={datos} descargando={sincronizando}
            onDescargar={({ desde: inicio, hasta: fin }) => sincronizar({ desde: inicio, hasta: fin, soloFaltantes: true })} />
          {datos && <Resumen datos={datos} />}
          {tab === 'prioridad'
            ? <Prioridad datos={datos} tipo={tipo} rutaRetorno={rutaRetorno} />
            : <Cursos datos={datos} />}
        </>
      )}
      <p className="muted">Estas señales no confirman la causa.</p>
    </>
  );
}
