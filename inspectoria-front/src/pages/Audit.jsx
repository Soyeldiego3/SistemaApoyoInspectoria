import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Segmented from '../components/Segmented.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import {
  gestionarAlerta,
  getAlertas,
  getAuditoriaCursos,
  getAuditoriaEstado,
  getAuditoriaPrioridad,
  getCredencialesPortal,
  getCursos,
  iniciarSync,
} from '../api.js';
import { fechaCorta, tituloMes } from '../fechas.js';
import { memoriaAuditar } from '../filtrosAuditar.js';

const TABS = [
  { id: 'alertas', label: 'Alertas' },
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
  { id: '30dias', label: 'Últimos 30 días' },
  { id: 'mes', label: 'Este mes' },
  { id: '2meses', label: 'Últimos 2 meses' },
  { id: 'personalizado', label: 'Personalizado…' },
];

// Alertas necesita al menos 15 días de clase con datos (y "caída" 20): no ofrece períodos
// más cortos. "Este mes" tampoco, porque a fin de mes recién llega al mínimo.
const PERIODOS_ALERTAS = ['30dias', '2meses', 'personalizado'];
const PERIODOS_GENERALES = ['hoy', 'ayer', 'semana', 'mes', 'personalizado'];
const periodosDe = (tab) => {
  const ids = tab === 'alertas' ? PERIODOS_ALERTAS : PERIODOS_GENERALES;
  return PERIODOS.filter((p) => ids.includes(p.id));
};

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

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
  if (periodo === '30dias') {
    const inicio = new Date(hoy);
    inicio.setDate(hoy.getDate() - 29);
    return { desde: fechaLocal(inicio), hasta: fin };
  }
  if (periodo === '2meses') {
    // Mes anterior + actual: lo mismo que se sincroniza por defecto
    return { desde: fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), hasta: fin };
  }
  if (periodo === 'personalizado') {
    return { desde: personalizadoDesde, hasta: personalizadoHasta };
  }
  return { desde: fin, hasta: fin };
}

// Si el rango es un solo día y cae en sábado o domingo, devuelve esa fecha (si no, null)
function diaFinDeSemana(desde, hasta) {
  if (!desde || desde !== hasta) return null;
  const dia = new Date(`${desde}T00:00:00`).getDay();
  return dia === 0 || dia === 6 ? desde : null;
}

function FinDeSemana({ fecha, onVerViernes }) {
  const dia = new Date(`${fecha}T00:00:00`);
  const viernes = new Date(dia);
  viernes.setDate(dia.getDate() - (dia.getDay() === 0 ? 2 : 1));
  const fechaViernes = fechaLocal(viernes);
  const nombre = DIAS_SEMANA[dia.getDay()];
  const esHoy = fecha === fechaLocal(new Date());
  return (
    <section className="card" role="status">
      <h2>Fin de semana</h2>
      <p className="muted" style={{ margin: '8px 0 14px' }}>
        {esHoy
          ? `Hoy es ${nombre} (${fechaCorta(fecha)}): no hay actividades programadas.`
          : `El ${nombre} ${fechaCorta(fecha)} no hay actividades programadas.`}
      </p>
      <button className="btn" type="button" onClick={() => onVerViernes(fechaViernes)}>
        Ver el viernes {fechaCorta(fechaViernes)}
      </button>
    </section>
  );
}

function mostrarRango(datos) {
  if (!datos?.rango?.desde || !datos?.rango?.hasta) return 'Sin rango con datos suficientes';
  return `${fechaCorta(datos.rango.desde)} a ${fechaCorta(datos.rango.hasta)}`;
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

function Prioridad({ datos, tipo, rutaRetorno }) {
  const [nivel, setNivelEstado] = useState(memoriaAuditar.nivel);
  const setNivel = (valor) => { memoriaAuditar.nivel = valor; setNivelEstado(valor); };
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
      <p className="muted audit-nota">
        Ordenados de mayor a menor prioridad según asistencia, faltas seguidas y atrasos sin justificar.
      </p>
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

// ---- Alertas de patrones ----

const TIPOS_ALERTA = [
  { id: 'mismo_dia', label: 'Falta siempre el mismo día' },
  { id: 'fin_de_semana', label: 'Alarga fines de semana' },
  { id: 'licencias', label: 'Muchas licencias médicas' },
  { id: 'caida', label: 'Caída reciente de asistencia' },
];

const ESTADOS_ALERTA = {
  revisada: { label: 'Revisada', clase: 'ok' },
  citado: { label: 'Apoderado citado', clase: 'ok' },
  descartada: { label: 'Descartada', clase: '' },
};

const MAX_FECHAS = 8;

function TarjetaAlerta({ alerta, rutaRetorno, onCambio }) {
  const [nota, setNota] = useState(alerta.gestion?.nota || '');
  const [editandoNota, setEditandoNota] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const gestion = alerta.gestion;
  const estado = ESTADOS_ALERTA[alerta.estado];
  const fechas = alerta.evidencia || [];

  const gestionar = async (nuevoEstado) => {
    setGuardando(true);
    setError('');
    try {
      const respuesta = await gestionarAlerta(alerta.clave, { estado: nuevoEstado, nota: nuevoEstado ? nota : '' });
      setEditandoNota(false);
      if (!nuevoEstado) setNota('');
      onCambio(alerta.clave, respuesta.gestion);
    } catch (e) {
      setError(e.message || 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <article className="alerta">
      <div className="alerta-cabecera">
        <div>
          <b>{alerta.nombres} {alerta.apellidos}</b>
          <span className="muted audit-meta">{alerta.curso} · {formatearRut(alerta.rut)}</span>
        </div>
        <div className="tags">
          <span className={`tag ${alerta.severidad === 'alta' ? 'bad' : 'warn'}`}>
            {alerta.severidad === 'alta' ? 'Alta' : 'Media'}
          </span>
          {estado && <span className={`tag ${estado.clase}`}>{estado.label}</span>}
        </div>
      </div>
      <div>
        <span className="alerta-titulo">{alerta.titulo}</span>
        {alerta.detalle && <p className="muted">{alerta.detalle}</p>}
      </div>
      {fechas.length > 0 && (
        <div className="tags start">
          {fechas.slice(-MAX_FECHAS).map((fecha) => <span key={fecha} className="tag">{fechaCorta(fecha)}</span>)}
          {fechas.length > MAX_FECHAS && <span className="muted">y {fechas.length - MAX_FECHAS} más</span>}
        </div>
      )}
      {gestion && (
        <p className="muted">
          {alerta.casosNuevos > 0 && (
            <span className="tag warn" style={{ marginRight: 6 }}>
              {plural(alerta.casosNuevos, 'caso nuevo', 'casos nuevos')} desde la gestión
            </span>
          )}
          {ESTADOS_ALERTA[gestion.estado]?.label} el {fechaCorta(fechaLocal(new Date(gestion.actualizado_en)))}
          {gestion.usuario ? ` por ${gestion.usuario}` : ''}.
          {gestion.nota ? ` Nota: ${gestion.nota}` : ''}
        </p>
      )}
      {editandoNota && (
        <textarea value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)}
          placeholder="Nota opcional (por ejemplo: se llamó al apoderado, cita el martes)" aria-label="Nota de la alerta" />
      )}
      {error && <p className="muted" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      <div className="alerta-acciones">
        {/* Lista desplegable: ocupa poco espacio en pantallas medianas y pequeñas */}
        <select className="input alerta-gestion" disabled={guardando} aria-label="Gestionar alerta"
          value={alerta.estado === 'nueva' ? '' : alerta.estado}
          onChange={(e) => gestionar(e.target.value === 'reabrir' ? null : e.target.value)}>
          {alerta.estado === 'nueva'
            ? <option value="" disabled>{guardando ? 'Guardando…' : 'Gestionar…'}</option>
            : <option value="reabrir">Reabrir (volver a nueva)</option>}
          <option value="citado">Apoderado citado</option>
          <option value="revisada">Revisada</option>
          <option value="descartada">Descartada</option>
        </select>
        {editandoNota && alerta.estado !== 'nueva' && (
          <button className="linkbtn" type="button" disabled={guardando} onClick={() => gestionar(alerta.estado)}>Guardar nota</button>
        )}
        {!editandoNota && (
          <button className="linkbtn" type="button" onClick={() => setEditandoNota(true)}>
            {gestion?.nota ? 'Editar nota' : 'Agregar nota'}
          </button>
        )}
        <Link className="linkbtn" to={`/alumnos/${encodeURIComponent(alerta.rut)}?vista=inasistencias`}
          state={{ returnTo: rutaRetorno, returnLabel: 'Auditar' }}>
          Ver ficha
        </Link>
      </div>
    </article>
  );
}

function Alertas({ datos, rutaRetorno, periodo, onUltimos30, onRangoCompleto, onCambio }) {
  const [filtro, setFiltroEstado] = useState(memoriaAuditar.filtroAlertas);
  const setFiltro = (valor) => { memoriaAuditar.filtroAlertas = valor; setFiltroEstado(valor); };
  if (!datos?.alertas) return <EmptyState texto="Sin datos en este rango." filas={3} />;
  const resumen = datos.resumen || {};
  const opciones = [
    { id: 'nuevas', label: `Nuevas (${resumen.nuevas ?? 0})` },
    { id: 'gestionadas', label: `Gestionadas (${resumen.gestionadas ?? 0})` },
    { id: 'todas', label: `Todas (${resumen.total ?? 0})` },
  ];
  const visibles = datos.alertas.filter((a) => (filtro === 'todas' ? true
    : filtro === 'nuevas' ? a.estado === 'nueva' : a.estado !== 'nueva'));
  return (
    <>
      {!datos.datosSuficientes && (
        <div className="msg aviso" role="status">
          <p>
            Los patrones de calendario necesitan al menos {datos.minDiasRango} días de clase con datos
            (este período tiene {datos.diasConDatos}). Amplía el período para buscarlos.
          </p>
          {periodo !== '30dias' && periodo !== '2meses' ? (
            <button className="btn" type="button" onClick={onUltimos30}>Ver últimos 30 días</button>
          ) : onRangoCompleto && (
            <button className="btn" type="button" onClick={onRangoCompleto}>Usar todo el rango disponible</button>
          )}
        </div>
      )}
      <Segmented valor={filtro} onChange={setFiltro} opciones={opciones} />
      {!visibles.length && (
        <p className="muted">
          {filtro === 'nuevas' ? 'No hay alertas nuevas en este período.' : 'No hay alertas en esta vista.'}
        </p>
      )}
      {TIPOS_ALERTA.map((tipoAlerta) => {
        const delTipo = visibles.filter((a) => a.tipo === tipoAlerta.id);
        if (!delTipo.length) return null;
        return (
          <details key={tipoAlerta.id} className="alerta-grupo" open>
            <summary>{tipoAlerta.label} ({delTipo.length})</summary>
            <div className="list">
              {delTipo.map((alerta) => (
                <TarjetaAlerta key={`${alerta.clave}:${alerta.estado}`} alerta={alerta}
                  rutaRetorno={rutaRetorno} onCambio={onCambio} />
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}

// Filtros que vienen en la URL al volver desde la ficha de un alumno (null si no hay)
function filtrosDesdeUrl(search) {
  const p = new URLSearchParams(search);
  if (![...p.keys()].length) return null;
  const valido = (lista, valor, porDefecto) => (lista.some((o) => o.id === valor) ? valor : porDefecto);
  const tab = valido(TABS, p.get('tab'), 'prioridad');
  // Desde el badge del menú (?tab=alertas sin período) se abre "Últimos 30 días"
  const periodo = valido(periodosDe(tab), p.get('periodo'), tab === 'alertas' ? '30dias' : 'hoy');
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
  const rango = periodo === 'personalizado'
    ? { desde: fecha(p.get('desde')), hasta: fecha(p.get('hasta')) }
    : rangoPeriodo(periodo);
  return {
    tab,
    tipo: valido(TIPOS, p.get('tipo'), 'ambos'),
    curso: p.get('curso') || '',
    periodo,
    ...rango,
  };
}

// Últimos filtros usados en Auditar mientras la app siga abierta (ver filtrosAuditar.js).
// Al abrir la app no hay nada guardado, así que la primera vez Auditar parte en "Hoy".
function filtrosRecordados() {
  const filtros = memoriaAuditar.filtros;
  if (!filtros) return null;
  if (!periodosDe(filtros.tab).some((p) => p.id === filtros.periodo)) return null;
  // Los períodos relativos (hoy, semana, mes…) se recalculan por si cambió el día
  return filtros.periodo === 'personalizado'
    ? filtros
    : { ...filtros, ...rangoPeriodo(filtros.periodo) };
}

export default function Audit() {
  const navigate = useNavigate();
  const location = useLocation();
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const [restaurados] = useState(() => filtrosDesdeUrl(location.search) || filtrosRecordados());
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
  // Último día con datos cuando hoy no tiene registros (se ofrece verlo con un botón)
  const [ultimoDia, setUltimoDia] = useState(null);

  useEffect(() => {
    memoriaAuditar.filtros = { tab, tipo, curso, periodo, desde, hasta };
  }, [tab, tipo, curso, periodo, desde, hasta]);
  const consultaAbortRef = useRef(null);
  const syncAbortRef = useRef(null);

  const cargarResultados = async (parametros, signal) => {
    let respuesta;
    if (tab === 'alertas') {
      // Los patrones son de inasistencia: el filtro Tipo no aplica
      const { tipo: _tipo, ...sinTipo } = parametros;
      respuesta = await getAlertas(sinTipo, { signal });
    } else {
      respuesta = await (tab === 'prioridad'
        ? getAuditoriaPrioridad(parametros, { signal })
        : getAuditoriaCursos(parametros, { signal }));
    }
    if (!signal?.aborted) setDatos({ ...respuesta, tab });
  };

  // Todo el rango con asistencia descargada (para buscar patrones)
  const usarRangoCompleto = (estado = estadoDatos) => {
    const inicio = estado?.primeraFechaAsistencia;
    const fin = estado?.ultimaFechaAsistencia;
    if (!inicio || !fin) return false;
    setPeriodo('personalizado');
    setDesde(inicio);
    setHasta(fin);
    setAvisoRango('');
    return true;
  };

  // Tras gestionar una alerta se actualiza en el lugar, sin recargar la lista
  const actualizarAlerta = (clave, gestion) => {
    setDatos((previo) => {
      if (!previo?.alertas) return previo;
      const alertas = previo.alertas.map((a) => (a.clave === clave
        ? { ...a, gestion, estado: gestion ? gestion.estado : 'nueva', casosNuevos: 0 }
        : a));
      const nuevas = alertas.filter((a) => a.estado === 'nueva').length;
      return { ...previo, alertas, resumen: { ...previo.resumen, nuevas, gestionadas: alertas.length - nuevas } };
    });
  };

  // Desde la ficha de un alumno se vuelve con los filtros en la URL; si la URL cambia
  // estando ya en Auditar (p. ej. el badge la primera vez), se aplica la pestaña pedida
  useEffect(() => {
    const pedida = new URLSearchParams(location.search).get('tab');
    if (pedida === 'alertas' && tab !== 'alertas') {
      setTab('alertas');
      cambiarPeriodo('30dias');
    }
  }, [location.search]);

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
        // Primera entrada desde que se abrió la app: siempre "Hoy"
        setPeriodo('hoy');
        setDesde(hoy);
        setHasta(hoy);
        if (!ultima) {
          setCargando(false);
          return;
        }
        if (ultima !== hoy && ![estado.ultimaFechaAsistencia, estado.ultimaFechaAtrasos].includes(hoy)) {
          setUltimoDia(ultima);
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
    p.set('periodo', periodo);
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
    setUltimoDia(null);
    if (nuevoPeriodo !== 'personalizado') {
      const rango = rangoPeriodo(nuevoPeriodo);
      setDesde(rango.desde);
      setHasta(rango.hasta);
    }
  };

  // Cada pestaña tiene sus períodos: al cambiar se ajusta el período si no está disponible
  const cambiarTab = (nuevoTab) => {
    if (nuevoTab === tab) return;
    const disponibles = periodosDe(nuevoTab).map((p) => p.id);
    // Si el período no existe en la otra pestaña, se usa su primera opción
    // (Alertas → "Últimos 30 días"; A quién citar / Comparar cursos → "Hoy")
    if (!disponibles.includes(periodo)) cambiarPeriodo(disponibles[0]);
    setTab(nuevoTab);
  };

  const verDia = (fecha) => {
    setPeriodo('personalizado');
    setDesde(fecha);
    setHasta(fecha);
    setUltimoDia(null);
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
      cambiarPeriodo(tab === 'alertas' ? '30dias' : 'hoy');
    };
    try {
      if (!esPc) {
        await terminar(await iniciarSync(cuerpo, { signal: controller.signal }));
        return;
      }
      const credenciales = await getCredencialesPortal();
      if (!credenciales.guardadas && !credenciales.enMemoria) {
        if (esPc) {
          navigate('/ajustes', {
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
          navigate('/ajustes', {
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
          navigate('/ajustes', {
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
  const rangoActual = rangoPeriodo(periodo, desde, hasta);
  const finDeSemana = tab !== 'alertas' ? diaFinDeSemana(rangoActual.desde, rangoActual.hasta) : null;

  return (
    <>
      <div className="audit-header">
        <h2>Auditar</h2>
      </div>

      <section className="card audit-filters" aria-label="Filtros de auditoría">
        <div className={tab === 'alertas' ? 'audit-filter-grid sin-tipo' : 'audit-filter-grid'}>
          <select className="input" value={curso} onChange={(e) => setCurso(e.target.value)} aria-label="Curso">
            <option value="">Todos los cursos</option>
            {cursos.map((opcion) => <option key={opcion.curso} value={opcion.curso}>{opcion.curso}</option>)}
          </select>
          {tab !== 'alertas' && (
            <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
              {TIPOS.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.label}</option>)}
            </select>
          )}
          <select className="input" value={periodo} onChange={(e) => cambiarPeriodo(e.target.value)} aria-label="Período">
            {periodosDe(tab).map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.label}</option>)}
          </select>
        </div>
        {periodo === 'personalizado' && (
          <div className="audit-custom-dates">
            <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Fecha desde" />
            <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Fecha hasta" />
          </div>
        )}
      </section>

      <Segmented valor={tab} onChange={cambiarTab} opciones={TABS} />

      {ultimaTexto && <p className="muted audit-last-sync">Última sincronización: {ultimaTexto}</p>}
      {avisoRango && <p className="msg" role="status">{avisoRango}</p>}
      {ultimoDia && periodo === 'hoy' && !finDeSemana && (
        <div className="msg aviso" role="status">
          <p>Hoy ({fechaCorta(fechaLocal(new Date()))}) no hay registros sincronizados.</p>
          <button className="btn" type="button" onClick={() => verDia(ultimoDia)}>
            Ver el {fechaCorta(ultimoDia)}, último día sincronizado
          </button>
        </div>
      )}
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
      ) : finDeSemana ? (
        <FinDeSemana fecha={finDeSemana} onVerViernes={verDia} />
      ) : cargando ? (
        <EmptyState texto="Calculando señales…" filas={4} />
      ) : (
        <>
          <Avisos datos={datos} descargando={sincronizando}
            onDescargar={({ desde: inicio, hasta: fin }) => sincronizar({ desde: inicio, hasta: fin, soloFaltantes: true })} />
          {datos && datos.tab !== tab ? (
            <EmptyState texto="Calculando señales…" filas={4} />
          ) : tab === 'alertas' ? (
            <Alertas datos={datos} rutaRetorno={rutaRetorno} onCambio={actualizarAlerta}
              periodo={periodo} onUltimos30={() => cambiarPeriodo('30dias')}
              onRangoCompleto={estadoDatos?.primeraFechaAsistencia ? () => usarRangoCompleto() : null} />
          ) : (
            <>
              <Resumen datos={datos} />
              {tab === 'prioridad'
                ? <Prioridad datos={datos} tipo={tipo} rutaRetorno={rutaRetorno} />
                : <Cursos datos={datos} />}
            </>
          )}
        </>
      )}
      <p className="muted">Estas señales no confirman la causa.</p>
    </>
  );
}
