import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Download, RefreshCw, Search, X } from 'lucide-react';
import Segmented from '../components/Segmented.jsx';
import { EmptyState } from '../components/Skeleton.jsx';
import {
  descargarRespaldo,
  gestionarAlerta,
  getAlertas,
  getAuditoriaCursos,
  getAuditoriaEstado,
  getAuditoriaPrioridad,
  getCursos,
} from '../api.js';
import { descargar } from '../descargas.js';
import { diaSemana, fechaCorta, fechaLocal, tituloMes } from '../fechas.js';
import { memoriaAuditar } from '../filtrosAuditar.js';
import { sincronizarPortal } from '../portal.js';
import { coincide, formatearRut, plural } from '../texto.js';

const TABS = [
  { id: 'alertas', label: 'Alertas' },
  { id: 'prioridad', label: 'A quién citar' },
  { id: 'cursos', label: 'Comparar cursos' },
];

const TIPOS = [
  { id: 'ambos', label: 'Faltas y atrasos' },
  { id: 'inasistencias', label: 'Inasistencias' },
  { id: 'atrasos', label: 'Atrasos' },
];

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Esta semana' },
  { id: '30dias', label: 'Últimos 30 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mesAnterior', label: 'Mes anterior' },
  { id: '2meses', label: 'Últimos 2 meses' },
  { id: 'personalizado', label: 'Elegir fechas…' },
];

// Alertas necesita al menos 15 días de clase con datos (y "caída" 20): no ofrece períodos
// más cortos. "Este mes" tampoco, porque a fin de mes recién llega al mínimo.
const PERIODOS_ALERTAS = ['30dias', '2meses', 'personalizado'];
const PERIODOS_GENERALES = ['hoy', 'ayer', 'semana', 'mes', 'mesAnterior', 'personalizado'];
// Período por defecto de cada pestaña
const periodoInicial = (tab) => (tab === 'alertas' ? '30dias' : 'mes');

// Un mes descargado puntual: 'mes:2026-10'
const PREFIJO_MES = 'mes:';
const esPeriodoMes = (id) => /^mes:\d{4}-(0[1-9]|1[0-2])$/.test(id || '');
const claveMes = (fecha) => `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;

// Opciones del selector. En "A quién citar" y "Comparar cursos" se agrega un ítem por
// cada mes descargado (salvo este mes y el anterior, que ya tienen su opción).
function periodosDe(tab, mesesConDatos = []) {
  const ids = tab === 'alertas' ? PERIODOS_ALERTAS : PERIODOS_GENERALES;
  const fijos = PERIODOS.filter((p) => ids.includes(p.id));
  if (tab === 'alertas') return fijos;
  const hoy = new Date();
  const yaIncluidos = new Set([claveMes(hoy), claveMes(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1))]);
  const meses = mesesConDatos
    .filter((mes) => !yaIncluidos.has(mes))
    .map((mes) => ({ id: `${PREFIJO_MES}${mes}`, label: tituloMes(mes) }));
  return [...fijos.slice(0, -1), ...meses, fijos.at(-1)];
}

const periodoValido = (tab, id) => (
  PERIODOS.some((p) => p.id === id && periodosDe(tab).includes(p)) || (tab !== 'alertas' && esPeriodoMes(id))
);

function rangoPeriodo(periodo, personalizadoDesde = '', personalizadoHasta = '') {
  const hoy = new Date();
  const fin = fechaLocal(hoy);
  // Mes completo (o hasta hoy si es el mes en curso)
  const rangoMes = (anio, mesIndice) => {
    const ultimo = fechaLocal(new Date(anio, mesIndice + 1, 0));
    return { desde: fechaLocal(new Date(anio, mesIndice, 1)), hasta: ultimo < fin ? ultimo : fin };
  };
  if (periodo === 'mesAnterior') return rangoMes(hoy.getFullYear(), hoy.getMonth() - 1);
  if (esPeriodoMes(periodo)) {
    const [anio, mes] = periodo.slice(PREFIJO_MES.length).split('-').map(Number);
    return rangoMes(anio, mes - 1);
  }
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
    return { desde: fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fin };
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
  const nombre = diaSemana(fecha).toLowerCase();
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
  if (!datos?.rango?.desde || !datos?.rango?.hasta) return 'No hay suficientes datos para este período';
  return `Mostrando del ${fechaCorta(datos.rango.desde)} al ${fechaCorta(datos.rango.hasta)}`;
}

function haceCuanto(fechaIso) {
  if (!fechaIso) return null;
  const diferencia = Date.now() - new Date(fechaIso).getTime();
  if (!Number.isFinite(diferencia) || diferencia < 0) return 'recién';
  const minutos = Math.floor(diferencia / 60000);
  if (minutos < 1) return 'hace menos de 1 minuto';
  if (minutos < 60) return `hace ${plural(minutos, 'minuto')}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${plural(horas, 'hora')}`;
  return `hace ${plural(Math.floor(horas / 24), 'día')}`;
}

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
        <p className="muted">Faltas y atrasos</p>
        <div className="big">{resumen?.incidencias ?? '—'}</div>
        {resumen?.incidencias != null && (
          <p className="muted detalle">
            {plural(resumen.inasistencias ?? 0, 'inasistencia')} · {plural(resumen.atrasos ?? 0, 'atraso')}
          </p>
        )}
      </section>
      <section className="card">
        <p className="muted">Sin justificar</p>
        <div className="big">{porcentaje}</div>
        {resumen?.incidencias ? (
          <p className="muted detalle">{resumen.sinJustificar} de {resumen.incidencias} faltas y atrasos</p>
        ) : null}
      </section>
      <section className="card">
        <p className="muted">Alumnos con pendientes</p>
        <div className="big">{resumen?.alumnosAfectados ?? '—'}</div>
        <p className="muted detalle">Tienen al menos una falta o atraso sin justificar</p>
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
  if (c.tendenciaReciente) {
    const dias = criterios?.diasRecientes ?? 7;
    lista.push(`${c.tendenciaReciente} ${dias === 7 ? 'en la última semana' : `en los últimos ${dias} días`}`);
  }
  return lista;
}

// "N alumnos" + "Limpiar filtros" (igual que en Alumnos)
function Contador({ cantidad, singular, pluralTexto, hayFiltros, onLimpiar, accion = null }) {
  return (
    <div className="row muted">
      <span>{plural(cantidad, singular, pluralTexto)}</span>
      <span className="row" style={{ gap: 16 }}>
        {hayFiltros && (
          <button className="linkbtn" type="button" onClick={onLimpiar}><X size={14} /> Limpiar filtros</button>
        )}
        {accion}
      </span>
    </div>
  );
}

// Atajo al respaldo de Ajustes: descarga las notas de alertas (y los justificativos aprobados)
function RespaldarNotas() {
  const [estado, setEstado] = useState('');
  const respaldar = async () => {
    setEstado('Respaldando…');
    try {
      const { blob, nombre } = await descargarRespaldo();
      descargar(blob, nombre);
      setEstado('');
    } catch (error) {
      setEstado(error.message || 'No se pudo respaldar');
    }
  };
  return (
    <button className="linkbtn" type="button" disabled={estado === 'Respaldando…'} onClick={respaldar}
      title="Descarga un respaldo de las notas y estados de las alertas">
      <Download size={14} /> {estado || 'Respaldar notas'}
    </button>
  );
}

const coincideAlumno = (q, a) => coincide(q, a.rut, a.nombres, a.apellidos, a.curso);

function Prioridad({ datos, tipo, rutaRetorno, q, nivel, setNivel, hayFiltros, onLimpiar }) {
  if (!datos?.alumnos?.length) return <EmptyState texto="No hay datos para este período." filas={3} />;
  // Con un tipo elegido, la ficha se abre en esa pestaña (los ids coinciden con sus vistas)
  const vista = tipo !== 'ambos' ? `?vista=${tipo}` : '';
  const criterios = datos.criterios;
  // Textos de los tooltips: "Asistencia de noviembre 2026 hasta el 23-11-2026" (o "del … al …"
  // si el período abarca varios meses) y "Asistencia del año hasta el 23-11-2026"
  const { mesDesde, hasta: asistenciaHasta } = criterios || {};
  const hastaTexto = asistenciaHasta ? ` hasta el ${fechaCorta(asistenciaHasta)}` : '';
  const textoMes = !mesDesde || !asistenciaHasta ? 'Asistencia del mes'
    : mesDesde.slice(0, 7) === asistenciaHasta.slice(0, 7)
      ? `Asistencia de ${tituloMes(mesDesde).toLowerCase()}${hastaTexto}`
      : `Asistencia del ${fechaCorta(mesDesde)} al ${fechaCorta(asistenciaHasta)}`;
  const textoAnio = `Asistencia del año${hastaTexto}`;
  // Chip de asistencia. Con pocos días cargados se marca y va sin color.
  // `cuenta`: si define la prioridad (el del año), se pinta según 85% / 90%.
  const chipAsistencia = (etiqueta, pct, dias, texto, cuenta) => {
    if (pct == null) return null;
    const pocos = criterios && dias < criterios.minDiasRegistrados;
    const clase = !cuenta || !criterios || pocos ? ''
      : pct < criterios.asistenciaMinima ? 'bad'
        : pct < criterios.asistenciaAlerta ? 'warn' : '';
    const nota = pocos ? '. Pocos días para considerarla.' : cuenta ? '. Define la prioridad.' : '';
    return (
      <span className={`tag ${clase}`} title={`${texto}: ${plural(dias, 'día')} con clases${nota}`}>
        {etiqueta} {pct}%{pocos ? ' · pocos datos' : ''}
      </span>
    );
  };
  // Los contadores se calculan sobre lo que coincide con la búsqueda
  const coincidentes = datos.alumnos.filter((a) => coincideAlumno(q, a));
  const contar = (n) => coincidentes.filter((a) => a.nivel === n).length;
  const opciones = [
    { id: 'todos', label: `Todos (${coincidentes.length})` },
    { id: 'alta', label: `Alta (${contar('alta')})` },
    { id: 'media', label: `Media (${contar('media')})` },
  ];
  const visibles = nivel === 'todos' ? coincidentes : coincidentes.filter((a) => a.nivel === nivel);
  return (
    <>
      <p className="muted audit-nota">
        Primero los alumnos que más conviene citar: baja asistencia del año, faltas seguidas o atrasos sin justificar.
      </p>
      <Segmented valor={nivel} onChange={setNivel} opciones={opciones} />
      <Contador cantidad={visibles.length} singular="alumno" hayFiltros={hayFiltros} onLimpiar={onLimpiar} />
      {!visibles.length && (
        <p className="muted">
          {q.trim() ? 'Ningún alumno coincide con la búsqueda.' : 'Ningún alumno en este nivel.'}
        </p>
      )}
      <div className="list">
        {visibles.map((alumno) => {
          const info = NIVELES[alumno.nivel] || NIVELES.baja;
          const chips = senales(alumno, criterios);
          return (
            <Link key={alumno.rut} to={`/alumnos/${encodeURIComponent(alumno.rut)}${vista}`}
              state={{ returnTo: rutaRetorno, returnLabel: 'Auditoría' }} className="item alumno">
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
                {tipo !== 'atrasos' && (
                  <>
                    {chipAsistencia('Mes', alumno.porcentajeMes, alumno.diasMes, textoMes, false)}
                    {chipAsistencia('Año', alumno.porcentajeAsistencia, alumno.diasRegistrados, textoAnio, true)}
                  </>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function Cursos({ datos, q, hayFiltros, onLimpiar }) {
  if (!datos?.cursos?.length) return <EmptyState texto="No hay datos para este período." filas={3} />;
  const visibles = datos.cursos.filter((curso) => coincide(q, curso.curso));
  // Cuánto más (o menos) falta el curso que el promedio del colegio
  const vsPromedio = (d) => {
    if (d == null) return null;
    if (d === 0) return 'En el promedio';
    return d > 0 ? `+${d} puntos sobre el promedio` : `−${Math.abs(d)} puntos bajo el promedio`;
  };
  return (
    <>
    {datos.promedioGeneralInasistencia != null && (
      <p className="muted">
        Promedio de inasistencia del colegio: {datos.promedioGeneralInasistencia}%.
        "Sobre el promedio" falta más que el resto; "bajo el promedio", menos.
        Toca un curso para ver sus alumnos.
      </p>
    )}
    <Contador cantidad={visibles.length} singular="curso" hayFiltros={hayFiltros} onLimpiar={onLimpiar} />
    {!visibles.length && <p className="muted">Ningún curso coincide con la búsqueda.</p>}
    <div className="list">
      {visibles.map((curso) => (
        <Link className="item enlace curso-item" key={curso.curso}
          to={`/alumnos?curso=${encodeURIComponent(curso.curso)}`}
          title={`Ver alumnos de ${curso.curso}`}>
          <div>
            <b>{curso.curso}</b>
            <span className="muted">{plural(curso.alumnosMatriculados, 'alumno')} · {plural(curso.diasRegistrados, 'día')} con clases</span>
            {curso.pocosDatos && <span className="tag warn">Pocos datos</span>}
          </div>
          <div className="tags">
            <span className="tag">Inasistencia {curso.porcentajeInasistencia == null ? '—' : `${curso.porcentajeInasistencia}%`}</span>
            <span className="tag">Atrasos {curso.porcentajeAtrasos == null ? '—' : `${curso.porcentajeAtrasos}%`}</span>
            <span className="tag warn">Sin justificar {curso.porcentajeSinJustificar == null ? '—' : `${curso.porcentajeSinJustificar}%`}</span>
            {vsPromedio(curso.desviacionPromedio) && <span className="tag">{vsPromedio(curso.desviacionPromedio)}</span>}
            <ChevronRight size={18} className="curso-flecha" aria-hidden="true" />
          </div>
        </Link>
      ))}
    </div>
    </>
  );
}

// ---- Alertas de patrones ----

const TIPOS_ALERTA = [
  { id: 'mismo_dia', label: 'Falta siempre el mismo día' },
  { id: 'fin_de_semana', label: 'Falta junto a fines de semana o feriados' },
  { id: 'licencias', label: 'Muchas licencias médicas' },
  { id: 'caida', label: 'Está faltando más que antes' },
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
  // Ficha en Inasistencias con todas las faltas: la evidencia puede incluir justificadas (licencias)
  const ficha = {
    to: `/alumnos/${encodeURIComponent(alerta.rut)}?vista=inasistencias&ver=todas`,
    state: { returnTo: rutaRetorno, returnLabel: 'Auditoría' },
  };

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
        <Link className="alerta-alumno" {...ficha} title="Ver ficha del alumno">
          <b>{alerta.nombres} {alerta.apellidos}</b>
          <span className="muted audit-meta">{alerta.curso} · {formatearRut(alerta.rut)}</span>
        </Link>
        <div className="tags">
          <span className={`tag ${alerta.prioridad === 'alta' ? 'bad' : 'warn'}`}>
            {alerta.prioridad === 'alta' ? 'Prioridad alta' : 'Prioridad media'}
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
              {plural(alerta.casosNuevos, 'falta nueva', 'faltas nuevas')} desde que se atendió
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
            ? <option value="" disabled>{guardando ? 'Guardando…' : 'Marcar como…'}</option>
            : <option value="reabrir">Volver a pendiente</option>}
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
        <Link className="linkbtn" {...ficha}>Ver ficha</Link>
      </div>
    </article>
  );
}

function Alertas({
  datos, rutaRetorno, periodo, onUltimos30, onRangoCompleto, onCambio,
  q, tipoAlerta, setTipoAlerta, prioridadAlerta, setPrioridadAlerta, hayFiltros, onLimpiar,
}) {
  const [filtro, setFiltroEstado] = useState(memoriaAuditar.filtroAlertas);
  const setFiltro = (valor) => { memoriaAuditar.filtroAlertas = valor; setFiltroEstado(valor); };
  if (!datos?.alertas) return <EmptyState texto="No hay datos para este período." filas={3} />;
  // Búsqueda, tipo y prioridad; los contadores de estado se calculan sobre esto
  const filtradas = datos.alertas.filter((a) => coincideAlumno(q, a)
    && (tipoAlerta === 'todos' || a.tipo === tipoAlerta)
    && (prioridadAlerta === 'todas' || a.prioridad === prioridadAlerta));
  const nuevas = filtradas.filter((a) => a.estado === 'nueva').length;
  const opciones = [
    { id: 'nuevas', label: `Pendientes (${nuevas})` },
    { id: 'gestionadas', label: `Atendidas (${filtradas.length - nuevas})` },
    { id: 'todas', label: `Todas (${filtradas.length})` },
  ];
  const visibles = filtradas.filter((a) => (filtro === 'todas' ? true
    : filtro === 'nuevas' ? a.estado === 'nueva' : a.estado !== 'nueva'));
  const conFiltros = Boolean(q.trim()) || tipoAlerta !== 'todos' || prioridadAlerta !== 'todas';
  return (
    <>
      {!datos.datosSuficientes && (
        <div className="msg aviso" role="status">
          <p>
            Para buscar estas alertas se necesitan al menos {datos.minDiasRango} días de clases con datos
            (este período tiene {datos.diasConDatos}). Elige un período más largo.
          </p>
          {periodo !== '30dias' && periodo !== '2meses' ? (
            <button className="btn" type="button" onClick={onUltimos30}>Ver últimos 30 días</button>
          ) : onRangoCompleto && (
            <button className="btn" type="button" onClick={onRangoCompleto}>Usar todas las fechas descargadas</button>
          )}
        </div>
      )}
      <div className="audit-filter-grid sin-tipo">
        <select className="input" value={tipoAlerta} onChange={(e) => setTipoAlerta(e.target.value)} aria-label="Tipo de alerta">
          <option value="todos">Todos los tipos de alerta</option>
          {TIPOS_ALERTA.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.label}</option>)}
        </select>
        <select className="input" value={prioridadAlerta} onChange={(e) => setPrioridadAlerta(e.target.value)} aria-label="Prioridad">
          <option value="todas">Todas las prioridades</option>
          <option value="alta">Prioridad alta</option>
          <option value="media">Prioridad media</option>
        </select>
      </div>
      <Segmented valor={filtro} onChange={setFiltro} opciones={opciones} />
      <Contador cantidad={visibles.length} singular="alerta" hayFiltros={hayFiltros} onLimpiar={onLimpiar}
        accion={<RespaldarNotas />} />
      {!visibles.length && (
        <p className="muted">
          {conFiltros ? 'Ninguna alerta coincide con los filtros.'
            : filtro === 'nuevas' ? 'No hay alertas pendientes en este período.' : 'No hay alertas en esta vista.'}
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
  const pedido = p.get('periodo');
  const periodo = periodoValido(tab, pedido) ? pedido : periodoInicial(tab);
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
  // Desde "Ver patrones" de la ficha: todas las fechas descargadas (se completan al cargar el estado)
  if (p.get('rango') === 'completo') {
    return {
      tab,
      tipo: 'ambos',
      curso: '',
      q: p.get('q') || '',
      periodo: 'personalizado',
      desde: '',
      hasta: '',
      rangoCompleto: true,
    };
  }
  const rango = periodo === 'personalizado'
    ? { desde: fecha(p.get('desde')), hasta: fecha(p.get('hasta')) }
    : rangoPeriodo(periodo);
  return {
    tab,
    tipo: valido(TIPOS, p.get('tipo'), 'ambos'),
    curso: p.get('curso') || '',
    q: p.get('q') || '',
    periodo,
    ...rango,
  };
}

// Últimos filtros usados en Auditar mientras la app siga abierta (ver filtrosAuditar.js).
// Al abrir la app no hay nada guardado, así que la primera vez Auditar parte en "Este mes".
function filtrosRecordados() {
  const filtros = memoriaAuditar.filtros;
  if (!filtros) return null;
  if (!periodoValido(filtros.tab, filtros.periodo)) return null;
  // Los períodos relativos (hoy, semana, mes…) se recalculan por si cambió el día
  return filtros.periodo === 'personalizado'
    ? filtros
    : { ...filtros, ...rangoPeriodo(filtros.periodo) };
}

export default function Audit() {
  const navigate = useNavigate();
  const location = useLocation();
  const [restaurados] = useState(() => filtrosDesdeUrl(location.search) || filtrosRecordados());
  const [tab, setTab] = useState(restaurados?.tab ?? 'prioridad');
  const [tipo, setTipo] = useState(restaurados?.tipo ?? 'ambos');
  const [curso, setCurso] = useState(restaurados?.curso ?? '');
  const [periodo, setPeriodo] = useState(restaurados?.periodo ?? 'mes');
  const [desde, setDesde] = useState(restaurados?.desde ?? '');
  const [hasta, setHasta] = useState(restaurados?.hasta ?? '');
  // Búsqueda y filtros internos: se aplican en el navegador sobre lo que entrega el back
  const [q, setQ] = useState(restaurados?.q ?? '');
  const [nivel, setNivelEstado] = useState(memoriaAuditar.nivel);
  const setNivel = (valor) => { memoriaAuditar.nivel = valor; setNivelEstado(valor); };
  const [tipoAlerta, setTipoAlertaEstado] = useState(memoriaAuditar.tipoAlerta);
  const setTipoAlerta = (valor) => { memoriaAuditar.tipoAlerta = valor; setTipoAlertaEstado(valor); };
  const [prioridadAlerta, setPrioridadAlertaEstado] = useState(memoriaAuditar.prioridadAlerta);
  const setPrioridadAlerta = (valor) => { memoriaAuditar.prioridadAlerta = valor; setPrioridadAlertaEstado(valor); };
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
    memoriaAuditar.filtros = { tab, tipo, curso, periodo, desde, hasta, q };
  }, [tab, tipo, curso, periodo, desde, hasta, q]);
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
  const usarRangoCompleto = () => {
    const inicio = estadoDatos?.primeraFechaAsistencia;
    const fin = estadoDatos?.ultimaFechaAsistencia;
    if (!inicio || !fin) return;
    setPeriodo('personalizado');
    setDesde(inicio);
    setHasta(fin);
    setAvisoRango('');
  };

  // Tras gestionar una alerta se actualiza en el lugar, sin recargar la lista
  // (los contadores de Alertas se calculan en el componente a partir de `alertas`)
  const actualizarAlerta = (clave, gestion) => {
    setDatos((previo) => {
      if (!previo?.alertas) return previo;
      const alertas = previo.alertas.map((a) => (a.clave === clave
        ? { ...a, gestion, estado: gestion ? gestion.estado : 'nueva', casosNuevos: 0 }
        : a));
      return { ...previo, alertas };
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
          if (restaurados.rangoCompleto && estado.primeraFechaAsistencia && estado.ultimaFechaAsistencia) {
            setDesde(estado.primeraFechaAsistencia);
            setHasta(estado.ultimaFechaAsistencia);
            return;
          }
          if (!restaurados.desde && !restaurados.hasta) setCargando(false);
          return;
        }
        // Primera entrada desde que se abrió la app: siempre "Este mes"
        // (o "Últimos 30 días" si se entra directo a Alertas)
        const inicial = periodoInicial(tab);
        const rango = rangoPeriodo(inicial);
        setPeriodo(inicial);
        setDesde(rango.desde);
        setHasta(rango.hasta);
        if (!estado.ultimaFechaAsistencia && !estado.ultimaFechaAtrasos) setCargando(false);
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
    // Sin fechas todavía (esperando el estado de los datos en la primera entrada)
    if (!desde && !hasta) return undefined;
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
    if (q.trim()) p.set('q', q.trim());
    // Siempre lleva al menos el período, para que Auditoría sepa que debe restaurar
    p.set('periodo', periodo);
    if (periodo === 'personalizado') {
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
    }
    return `/auditar?${p}`;
  }, [tab, tipo, curso, periodo, desde, hasta, q]);

  // Solo cuentan los filtros que aplican a la pestaña actual (el período no es un filtro aquí)
  const hayFiltros = Boolean(q.trim() || curso
    || (tab !== 'alertas' && tipo !== 'ambos')
    || (tab === 'prioridad' && nivel !== 'todos')
    || (tab === 'alertas' && (tipoAlerta !== 'todos' || prioridadAlerta !== 'todas')));
  const limpiarFiltros = () => {
    setQ('');
    setCurso('');
    setTipo('ambos');
    setNivel('todos');
    setTipoAlerta('todos');
    setPrioridadAlerta('todas');
  };

  const cambiarPeriodo = (nuevoPeriodo, estado = estadoDatos) => {
    setPeriodo(nuevoPeriodo);
    setAvisoRango('');
    setUltimoDia(null);
    if (nuevoPeriodo !== 'personalizado') {
      const rango = rangoPeriodo(nuevoPeriodo);
      setDesde(rango.desde);
      setHasta(rango.hasta);
    }
    // En "Hoy", si aún no hay datos de hoy se ofrece ver el último día con datos
    if (nuevoPeriodo === 'hoy') {
      const ultima = [estado?.ultimaFechaAsistencia, estado?.ultimaFechaAtrasos]
        .filter(Boolean).sort().at(-1);
      if (ultima && ultima !== fechaLocal(new Date())) setUltimoDia(ultima);
    }
  };

  // Cada pestaña tiene sus períodos: al cambiar se ajusta el período si no está disponible
  // (Alertas → "Últimos 30 días"; A quién citar / Comparar cursos → "Este mes")
  const cambiarTab = (nuevoTab) => {
    if (nuevoTab === tab) return;
    if (!periodoValido(nuevoTab, periodo)) cambiarPeriodo(periodoInicial(nuevoTab));
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
      cambiarPeriodo(periodoInicial(tab), estado);
    };
    try {
      const respuesta = await sincronizarPortal({ navigate, cuerpo, signal: controller.signal });
      // null = faltaban credenciales y se fue a Ajustes
      if (respuesta) await terminar(respuesta);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
    } finally {
      setSincronizando(false);
    }
  };

  const tieneDatos = Boolean(estadoDatos?.ultimaFechaAsistencia || estadoDatos?.ultimaFechaAtrasos);
  const ultimaTexto = haceCuanto(estadoDatos?.ultimaSincronizacionExitosa);
  const rangoActual = rangoPeriodo(periodo, desde, hasta);
  // Meses del selector; si el elegido (p. ej. al volver de una ficha) no está, se agrega
  const mesesSelector = [...new Set([
    ...(estadoDatos?.mesesConDatos || []),
    ...(esPeriodoMes(periodo) ? [periodo.slice(PREFIJO_MES.length)] : []),
  ])].sort().reverse();
  const finDeSemana = tab !== 'alertas' ? diaFinDeSemana(rangoActual.desde, rangoActual.hasta) : null;

  return (
    <>
      <div className="audit-header">
        <h2>Auditoría</h2>
      </div>

      <section className="card audit-filters" aria-label="Filtros de auditoría">
        <div className="searchbox">
          <Search size={18} />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={tab === 'cursos' ? 'Buscar curso' : 'RUT, nombre o curso'}
            aria-label={tab === 'cursos' ? 'Buscar curso' : 'Buscar alumno'} />
        </div>
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
            {periodosDe(tab, mesesSelector).map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.label}</option>)}
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
          <p>Todavía no hay datos de hoy ({fechaCorta(fechaLocal(new Date()))}).</p>
          <button className="btn" type="button" onClick={() => verDia(ultimoDia)}>
            Ver el {fechaCorta(ultimoDia)}, último día con datos
          </button>
        </div>
      )}
      {datos && <p className="muted">{mostrarRango(datos)}</p>}
      {error && <p className="msg error" role="alert">{error}</p>}

      {!cargando && !tieneDatos ? (
        <section className="card" role="status">
          <h2>Aún no hay datos</h2>
          <p className="muted" style={{ margin: '8px 0 14px' }}>Descarga los datos del portal para empezar.</p>
          <button className="btn" type="button" onClick={() => sincronizar()} disabled={sincronizando}>
            <RefreshCw size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
            {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </section>
      ) : finDeSemana ? (
        <FinDeSemana fecha={finDeSemana} onVerViernes={verDia} />
      ) : cargando || (datos && datos.tab !== tab) ? (
        // También mientras llegan los datos de la pestaña recién elegida
        <EmptyState texto="Revisando los datos…" filas={4} />
      ) : (
        <>
          <Avisos datos={datos} descargando={sincronizando}
            onDescargar={({ desde: inicio, hasta: fin }) => sincronizar({ desde: inicio, hasta: fin, soloFaltantes: true })} />
          {tab === 'alertas' ? (
            <Alertas datos={datos} rutaRetorno={rutaRetorno} onCambio={actualizarAlerta}
              periodo={periodo} onUltimos30={() => cambiarPeriodo('30dias')}
              onRangoCompleto={estadoDatos?.primeraFechaAsistencia ? usarRangoCompleto : null}
              q={q} tipoAlerta={tipoAlerta} setTipoAlerta={setTipoAlerta}
              prioridadAlerta={prioridadAlerta} setPrioridadAlerta={setPrioridadAlerta}
              hayFiltros={hayFiltros} onLimpiar={limpiarFiltros} />
          ) : (
            <>
              <Resumen datos={datos} />
              {tab === 'prioridad'
                ? <Prioridad datos={datos} tipo={tipo} rutaRetorno={rutaRetorno} q={q}
                    nivel={nivel} setNivel={setNivel} hayFiltros={hayFiltros} onLimpiar={limpiarFiltros} />
                : <Cursos datos={datos} q={q} hayFiltros={hayFiltros} onLimpiar={limpiarFiltros} />}
            </>
          )}
        </>
      )}
      <p className="muted">Estas alertas son orientativas: no indican el motivo de las faltas.</p>
    </>
  );
}
