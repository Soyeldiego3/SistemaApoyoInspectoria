import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, RefreshCw } from 'lucide-react';
import Chips from './Chips.jsx';
import Contador from './Contador.jsx';
import { EmptyState } from './Skeleton.jsx';
import { extraerAsistenciaClase, getAsistenciaClase, iniciarTareaClase } from '../api.js';
import {
  MENSAJES_PORTAL, esPc, esperarTarea, sincronizarPortal, tareaEnCurso,
} from '../portal.js';
import { diaSemana, fechaCorta } from '../fechas.js';
import { coincide, formatearRut, plural } from '../texto.js';

// Pestaña "Por clase" de Auditoría: asistencia por bloque horario ("Asistencia por clase" del portal).
// Usa los filtros de Auditoría: curso, tipo (faltas/atrasos), búsqueda y un día.
// - Con un curso: tabla alumno × bloque (o la lista de un bloque).
// - Con "Todos los cursos": la misma tabla de cada curso, una debajo de la otra.
// Lee lo guardado en la BD; "Actualizar" extrae del portal todos los cursos del día (un solo login).

const ESTADOS = {
  P: { texto: 'Presente', clase: 'ok' },
  A: { texto: 'Ausente', clase: 'bad' },
  T: { texto: 'Atraso', clase: 'warn' },
};
const TODOS = 'todos';

const etiquetaBloque = (b) => `${b.hora_inicio}–${b.hora_fin}`;
const contar = (alumnos, estado) => alumnos.filter((a) => a.estado === estado).length;

// Alumnos con su estado en cada bloque. "Faltó y volvió": ausente en un bloque y presente o
// atrasado en uno posterior (misma regla que la alerta de Auditoría; no cuenta un retiro anticipado)
function alumnosPorBloque(bloques) {
  const porRut = new Map();
  bloques.forEach((b, i) => {
    for (const a of b.alumnos) {
      if (!porRut.has(a.rut)) porRut.set(a.rut, { ...a, estados: Array(bloques.length).fill(null) });
      porRut.get(a.rut).estados[i] = a.estado;
    }
  });
  return [...porRut.values()]
    .map((a) => {
      const ausencias = a.estados.filter((e, i) => e === 'A'
        && a.estados.slice(i + 1).some((s) => s === 'P' || s === 'T')).length;
      return {
        ...a,
        ausencias,
        parcial: ausencias > 0,
        faltas: a.estados.filter((e) => e === 'A').length,
        atrasos: a.estados.filter((e) => e === 'T').length,
      };
    })
    .sort((x, y) => `${x.apellidos} ${x.nombres}`.localeCompare(`${y.apellidos} ${y.nombres}`, 'es'));
}

// Filtro "Tipo" de Auditoría aplicado a un alumno del día ("Faltas y atrasos" = todos)
const pasaTipo = (a, tipo) => (
  tipo === 'inasistencias' ? a.faltas > 0
    : tipo === 'atrasos' ? a.atrasos > 0
      : true
);

export default function PorClase({
  curso, fecha, q, tipo, rutaRetorno, hayFiltros, onLimpiar, onElegirCurso, onActualizado,
}) {
  const navigate = useNavigate();
  // Con curso: { curso, fecha, bloques }; todos los cursos: { fecha, cursos: [{ curso, bloques }] }
  const [datos, setDatos] = useState(null);
  const [bloque, setBloque] = useState(TODOS);
  const [soloParciales, setSoloParciales] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [extrayendo, setExtrayendo] = useState(false);
  const [error, setError] = useState('');
  const [avisos, setAvisos] = useState([]);
  const activoRef = useRef(true);
  const controllerRef = useRef(null);
  const consultaRef = useRef(0);
  const ficha = (rut) => ({
    to: `/alumnos/${encodeURIComponent(rut)}`,
    state: { returnTo: rutaRetorno, returnLabel: 'Auditoría' },
  });

  const cargar = useCallback(async () => {
    const consulta = ++consultaRef.current;
    if (!fecha) { setDatos(null); return; }
    setCargando(true);
    setError('');
    try {
      const respuesta = await getAsistenciaClase({ curso, fecha });
      if (consulta === consultaRef.current) setDatos(respuesta);
    } catch (e) {
      if (consulta !== consultaRef.current) return;
      setDatos(null);
      setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message);
    } finally {
      if (consulta === consultaRef.current) setCargando(false);
    }
  }, [curso, fecha]);

  useEffect(() => {
    setAvisos([]);
    cargar();
  }, [cargar]);

  const bloques = useMemo(() => datos?.bloques || [], [datos]);

  // Si el bloque elegido ya no existe (otro día/curso), vuelve a "Todos"
  useEffect(() => {
    if (bloque !== TODOS && !bloques.some((b) => b.hora_inicio === bloque)) setBloque(TODOS);
  }, [bloques, bloque]);

  // En el teléfono se le pide al PC como tarea; `enCurso` = una que el PC ya está haciendo
  const traerDelPortal = async (enCurso) => {
    setExtrayendo(true);
    setError('');
    setAvisos([]);
    try {
      const respuesta = enCurso
        ? await esperarTarea(enCurso.id, { signal: controllerRef.current?.signal })
        : await sincronizarPortal({
          navigate,
          signal: controllerRef.current?.signal,
          accion: () => extraerAsistenciaClase(fecha),
          tareaTelefono: { tipo: 'clase', parametros: { fecha }, iniciar: () => iniciarTareaClase(fecha) },
        });
      if (respuesta && activoRef.current) {
        const traidos = respuesta.cursos?.length || 0;
        setAvisos([
          ...(traidos ? [`Se trajo la asistencia por clase de ${plural(traidos, 'curso')}.`] : []),
          ...(respuesta.advertencias || []),
        ]);
        await cargar();
        onActualizado?.();
      }
    } catch (e) {
      if (e.name !== 'AbortError' && activoRef.current) setError(MENSAJES_PORTAL[e.code] || e.message);
    } finally {
      if (activoRef.current) setExtrayendo(false);
    }
  };

  // Teléfono: si al entrar el PC ya está trayendo este día (p. ej. se recargó la página o
  // se volvió a la pestaña), se espera esa misma tarea en vez de pedir otra
  useEffect(() => {
    activoRef.current = true;
    controllerRef.current = new AbortController();
    if (!esPc) {
      tareaEnCurso().then((tarea) => {
        if (tarea?.tipo === 'clase' && tarea.parametros?.fecha === fecha && activoRef.current) traerDelPortal(tarea);
      });
    }
    return () => {
      activoRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const botonTraer = (clase, texto) => (
    <button type="button" className={clase} onClick={() => traerDelPortal()}
      disabled={extrayendo || !fecha} title="Trae del portal la asistencia por clase de todos los cursos de este día">
      <RefreshCw size={16} className={extrayendo ? 'audit-spin' : undefined} style={{ verticalAlign: -3, marginRight: 8 }} />
      {extrayendo ? 'Actualizando…' : texto}
    </button>
  );

  const sinDatos = curso ? !bloques.length : !datos?.cursos?.length;
  const visible = (a, nombreCurso) => coincide(q, a.rut, a.nombres, a.apellidos, nombreCurso);

  let contenido;
  if (!fecha) {
    contenido = <p className="muted">Elige un día.</p>;
  } else if (cargando && !datos) {
    contenido = <EmptyState texto="Cargando asistencia por clase…" />;
  } else if (sinDatos) {
    contenido = (
      <section className="card" role="status">
        <h2>Sin datos para este día</h2>
        <p className="muted" style={{ margin: '8px 0 14px' }}>
          Aún no se ha traído la asistencia por clase {curso ? `de ${curso} ` : ''}del {fechaCorta(fecha)}.
          Se traerán todos los cursos de una vez.
        </p>
        {botonTraer('btn', 'Actualizar desde el portal')}
      </section>
    );
  } else if (!curso) {
    contenido = (
      <ResumenCursos cursos={datos.cursos} tipo={tipo} soloParciales={soloParciales} visible={visible}
        ficha={ficha} hayFiltros={hayFiltros} onLimpiar={onLimpiar} onElegirCurso={onElegirCurso} />
    );
  } else {
    contenido = (
      <TablaCurso bloques={bloques} bloque={bloque} setBloque={setBloque} tipo={tipo}
        soloParciales={soloParciales} visible={(a) => visible(a, curso)} ficha={ficha}
        hayFiltros={hayFiltros} onLimpiar={onLimpiar} />
    );
  }

  return (
    <>
      <div className="row">
        <p className="muted" style={{ margin: 0 }}>
          {fecha ? `${diaSemana(fecha)} ${fechaCorta(fecha)}` : ''}
        </p>
        {!sinDatos && botonTraer('btn ghost alumnos-exportar', 'Actualizar')}
      </div>
      {error && <p className="msg error" role="alert">{error}</p>}
      {avisos.map((aviso) => <p key={aviso} className="msg" role="status">{aviso}</p>)}
      {!sinDatos && (bloque === TODOS || !curso) && (
        <label className="clase-check muted">
          <input type="checkbox" checked={soloParciales} onChange={(e) => setSoloParciales(e.target.checked)} />
          Ver solo quienes faltaron a una clase y volvieron
        </label>
      )}
      {contenido}
    </>
  );
}

// "N alumnos faltaron a una clase y volvieron"
function TextoParciales({ cantidad }) {
  return (
    <span title="Ausentes en un bloque y presentes o atrasados en uno posterior (no cuenta un retiro anticipado)">
      {plural(cantidad, 'alumno')} {cantidad === 1 ? 'faltó' : 'faltaron'} a una clase y {cantidad === 1 ? 'volvió' : 'volvieron'}
    </span>
  );
}

function Leyenda() {
  return (
    <p className="legend clase-leyenda" style={{ margin: 0 }}>
      <span><b className="estado-P">P</b> Presente</span>
      <span><b className="estado-A">A</b> Ausente</span>
      <span><b className="estado-T">T</b> Atraso</span>
      <span><b>–</b> Sin registro</span>
    </p>
  );
}

// Tabla alumno × bloque con P / A / T
function Matriz({ bloques, filas, ficha }) {
  return (
    <div className="card clase-tabla-caja">
      <table className="clase-tabla">
        <thead>
          <tr>
            <th>Alumno</th>
            {bloques.map((b) => <th key={b.hora_inicio}>{b.hora_inicio}</th>)}
          </tr>
        </thead>
        <tbody>
          {filas.map((a) => (
            <tr key={a.rut}>
              <th scope="row">
                <Link {...ficha(a.rut)}>{a.apellidos}, {a.nombres}</Link>
                {a.parcial && <span className="tag bad clase-parcial">Faltó a {plural(a.ausencias, 'bloque')}</span>}
              </th>
              {a.estados.map((estado, i) => (
                <td key={bloques[i].hora_inicio} className={estado ? `estado-${estado}` : undefined}
                  title={estado ? `${etiquetaBloque(bloques[i])}: ${ESTADOS[estado]?.texto || estado}` : 'Sin registro'}>
                  {estado || '–'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!filas.length && <p className="muted" style={{ textAlign: 'center' }}>Nadie coincide con los filtros.</p>}
    </div>
  );
}

const filtrarFilas = (matriz, { visible, tipo, soloParciales }) => matriz.filter((a) => visible(a)
  && pasaTipo(a, tipo) && (!soloParciales || a.parcial));

// Todos los cursos: la misma tabla P / A / T de cada curso, uno debajo del otro
function ResumenCursos({
  cursos, tipo, soloParciales, visible, ficha, hayFiltros, onLimpiar, onElegirCurso,
}) {
  const grupos = cursos.map(({ curso, bloques }) => {
    const matriz = alumnosPorBloque(bloques);
    return {
      curso,
      bloques,
      parciales: matriz.filter((a) => a.parcial).length,
      filas: filtrarFilas(matriz, { visible: (a) => visible(a, curso), tipo, soloParciales }),
    };
  });
  const conFilas = grupos.filter((g) => g.filas.length);
  const total = conFilas.reduce((suma, g) => suma + g.filas.length, 0);

  return (
    <>
      <Contador cantidad={total} singular="alumno" hayFiltros={hayFiltros} onLimpiar={onLimpiar} />
      <Leyenda />
      {!total && <p className="muted">Nadie coincide con los filtros este día.</p>}
      {conFilas.map((g) => (
        <section key={g.curso} className="clase-grupo">
          <div className="row">
            <h3 className="clase-grupo-titulo">
              {g.curso} <span className="muted">· <TextoParciales cantidad={g.parciales} /></span>
            </h3>
            <button type="button" className="linkbtn" onClick={() => onElegirCurso(g.curso)}>
              Ver por bloque <ChevronRight size={14} style={{ verticalAlign: -2 }} />
            </button>
          </div>
          <Matriz bloques={g.bloques} filas={g.filas} ficha={ficha} />
        </section>
      ))}
    </>
  );
}

// Un curso: chips de bloque + tabla alumno × bloque, o la lista del bloque elegido
function TablaCurso({
  bloques, bloque, setBloque, tipo, soloParciales, visible, ficha, hayFiltros, onLimpiar,
}) {
  const matriz = alumnosPorBloque(bloques);
  const elegido = bloques.find((b) => b.hora_inicio === bloque);
  const chips = [{ id: TODOS, label: 'Todos' }, ...bloques.map((b) => ({ id: b.hora_inicio, label: etiquetaBloque(b) }))];

  if (elegido) {
    const delBloque = elegido.alumnos.filter((a) => visible(a)
      && (tipo === 'inasistencias' ? a.estado === 'A' : tipo === 'atrasos' ? a.estado === 'T' : true));
    return (
      <>
        <Chips opciones={chips} valor={bloque} onChange={setBloque} />
        <p className="muted" style={{ margin: 0 }}>
          {contar(elegido.alumnos, 'P')} presentes · {contar(elegido.alumnos, 'A')} ausentes · {contar(elegido.alumnos, 'T')} atrasos
        </p>
        <Contador cantidad={delBloque.length} singular="alumno" hayFiltros={hayFiltros} onLimpiar={onLimpiar} />
        <div className="list">
          {delBloque.map((a) => (
            <Link key={a.rut} {...ficha(a.rut)} className="item alumno">
              <div><b>{a.apellidos}, {a.nombres}</b><span className="muted">{formatearRut(a.rut)}</span></div>
              <span className={`tag ${ESTADOS[a.estado]?.clase || ''}`}>{ESTADOS[a.estado]?.texto || a.estado}</span>
            </Link>
          ))}
        </div>
      </>
    );
  }

  const filas = filtrarFilas(matriz, { visible, tipo, soloParciales });
  return (
    <>
      <Chips opciones={chips} valor={bloque} onChange={setBloque} />
      <p className="muted" style={{ margin: 0 }}><TextoParciales cantidad={matriz.filter((a) => a.parcial).length} /></p>
      <Contador cantidad={filas.length} singular="alumno" hayFiltros={hayFiltros} onLimpiar={onLimpiar} />
      <Leyenda />
      <Matriz bloques={bloques} filas={filas} ficha={ficha} />
    </>
  );
}
