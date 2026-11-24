import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, FileUp } from 'lucide-react';
import { exportarDocumento, getCursos, getRangoDatos, importarRegistro } from '../api.js';
import { descargar } from '../descargas.js';
import { fechaCorta, fechaLocal } from '../fechas.js';

const MODOS = [
  { id: 'exportar', label: 'Exportar' },
  { id: 'importar', label: 'Importar' },
];

const DOCUMENTOS = [
  { id: 'asistencia', label: 'Asistencia' },
  { id: 'asistenciaMensual', label: 'Asistencia mensual (formato portal)' },
  { id: 'atrasos', label: 'Atrasos' },
  { id: 'master', label: 'Inasistencias justificadas (Master)' },
];

const PERIODOS = [
  { id: 'todo', label: 'Todo lo sincronizado' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mesAnterior', label: 'Mes anterior' },
  { id: 'personalizado', label: 'Personalizado…' },
];


function rangoPeriodo(periodo, desde, hasta) {
  const hoy = new Date();
  if (periodo === 'mes') return { desde: fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fechaLocal(hoy) };
  if (periodo === 'mesAnterior') {
    return {
      desde: fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
      hasta: fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 0)),
    };
  }
  if (periodo === 'personalizado') return { desde, hasta };
  return { desde: '', hasta: '' };
}

const textoError = (e) => (e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message);

function ResultadoImportacion({ item }) {
  if (item.error) {
    return (
      <div className="msg error" role="alert">
        <b>{item.nombre}</b>: {item.error}
      </div>
    );
  }
  const r = item.resumen;
  const esAsistencia = r.tipo === 'asistencia';
  return (
    <div className="msg exportar-resultado" role="status">
      <p>
        <b>{r.curso}</b>{esAsistencia && r.periodo ? `, asistencia de ${r.periodo}` : ''} ({item.nombre}):{' '}
        {r.registros} {esAsistencia ? 'días' : 'registros'} de {r.alumnos} alumnos.{' '}
        {r.nuevos} nuevos, {r.cambiados} cambiados, {r.sinCambios} sin cambios
        {r.eliminados > 0 ? `, ${r.eliminados} quitados (ya no figuran en el archivo)` : ''}.
      </p>
      {r.fueraDeDatos > 0 && (
        <p className="muted">{r.fueraDeDatos} fechas no figuran como inasistencia en los datos sincronizados (se guardaron igual).</p>
      )}
      {r.noEncontrados?.length > 0 && (
        <details>
          <summary>
            {r.noEncontrados.length} alumnos del archivo no se encontraron en el curso
            {esAsistencia ? ' (se buscan por nombre; no se importaron)' : ''}
          </summary>
          <ul>{r.noEncontrados.map((n) => <li key={n}>{n}</li>)}</ul>
        </details>
      )}
      {r.filasInvalidas?.length > 0 && (
        <details>
          <summary>{r.filasInvalidas.length} filas no se pudieron leer</summary>
          <ul>{r.filasInvalidas.map((f) => <li key={f}>{f}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

// Ventana "Exportar / Importar datos" (se abre desde Inicio y desde Alumnos)
export default function ExportarImportarSheet({ abierto, onCerrar, onImportado }) {
  const [modo, setModo] = useState('exportar');
  const [documento, setDocumento] = useState('asistencia');
  const [curso, setCurso] = useState('');
  const [periodo, setPeriodo] = useState('todo');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [formato, setFormato] = useState('excel');
  const [cursos, setCursos] = useState([]);
  const [rango, setRango] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [archivos, setArchivos] = useState([]);
  const [resultados, setResultados] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    setError(''); setAviso(''); setResultados([]); setArchivos([]);
    getCursos()
      .then((r) => setCursos((r.cursos || []).map((c) => (typeof c === 'string' ? c : c.curso)).filter(Boolean)))
      .catch(() => setCursos([]));
    getRangoDatos().then(setRango).catch(() => setRango(null));
  }, [abierto]);

  // Bloquea el scroll del fondo y cierra con Escape
  useEffect(() => {
    if (!abierto) return undefined;
    const html = document.documentElement;
    const prev = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const alTeclear = (e) => { if (e.key === 'Escape' && !ocupado) onCerrar(); };
    window.addEventListener('keydown', alTeclear);
    return () => {
      html.style.overflow = prev.html;
      document.body.style.overflow = prev.body;
      window.removeEventListener('keydown', alTeclear);
    };
  }, [abierto, ocupado, onCerrar]);

  if (!abierto) return null;

  const esMaster = documento === 'master';
  const esMensual = documento === 'asistenciaMensual';
  const soloExcel = esMaster || esMensual;
  const fechas = rangoPeriodo(periodo, desde, hasta);
  const fechasMal = periodo === 'personalizado' && (!desde || !hasta || hasta < desde);
  const faltanMeses = rango?.desde && Number(rango.desde.slice(5, 7)) > 3 && new Date().getMonth() > 2;

  const cambiarModo = (nuevo) => { setModo(nuevo); setError(''); setAviso(''); };
  const cambiarDocumento = (nuevo) => {
    setDocumento(nuevo);
    if (nuevo === 'master' || nuevo === 'asistenciaMensual') setFormato('excel');
  };

  const exportar = async () => {
    setOcupado(true);
    setError(''); setAviso('');
    try {
      const params = { documento, curso, formato };
      if (!esMaster) Object.assign(params, fechas);
      const { blob, nombre, advertencias } = await exportarDocumento(params);
      descargar(blob, nombre);
      setAviso([`Se descargó "${nombre}".`, ...advertencias].join(' '));
    } catch (e) {
      setError(textoError(e));
    } finally {
      setOcupado(false);
    }
  };

  const elegirArchivos = (e) => {
    const lista = [...(e.target.files || [])];
    e.target.value = '';
    setError(''); setResultados([]);
    const invalidos = lista.filter((a) => !/\.xlsx$/i.test(a.name));
    if (invalidos.length) setError(`Solo se aceptan Excel (.xlsx): ${invalidos.map((a) => a.name).join(', ')}.`);
    setArchivos(lista.filter((a) => /\.xlsx$/i.test(a.name)));
  };

  const importar = async () => {
    setOcupado(true);
    setError(''); setResultados([]);
    const lista = [];
    for (const archivo of archivos) {
      try {
        lista.push({ nombre: archivo.name, resumen: await importarRegistro(archivo) });
      } catch (e) {
        lista.push({ nombre: archivo.name, error: textoError(e) });
      }
      setResultados([...lista]);
    }
    setArchivos([]);
    setOcupado(false);
    if (lista.some((r) => r.resumen)) onImportado?.();
  };

  const puedeAceptar = !ocupado && (modo === 'exportar'
    ? (cursos.length > 0 && !(!esMaster && fechasMal))
    : archivos.length > 0);

  return (
    <div className="overlay" onClick={() => { if (!ocupado) onCerrar(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="exportar-titulo"
        onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="row">
          <h2 id="exportar-titulo">Exportar / Importar datos</h2>
          <button type="button" className="iconbtn" onClick={onCerrar} disabled={ocupado} aria-label="Cerrar">×</button>
        </div>

        {/* Botones de opción: Exportar (verde) a la izquierda, Importar (rojo) a la derecha */}
        <div className="exportar-modo" role="radiogroup" aria-label="Acción">
          {MODOS.map((m) => (
            <label key={m.id} className={m.id}>
              <input type="radio" name="exportar-modo" value={m.id} checked={modo === m.id}
                disabled={ocupado} onChange={() => cambiarModo(m.id)} />
              {m.label}
            </label>
          ))}
        </div>

        {modo === 'exportar' ? (
          <>
            <div className="field">
              <label htmlFor="exp-documento">Documento a exportar</label>
              <select id="exp-documento" className="input" value={documento} disabled={ocupado}
                onChange={(e) => cambiarDocumento(e.target.value)}>
                {DOCUMENTOS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="exp-curso">Curso</label>
              <select id="exp-curso" className="input" value={curso} disabled={ocupado || !cursos.length}
                onChange={(e) => setCurso(e.target.value)}>
                {cursos.length ? <option value="">Todos los cursos</option> : <option value="">Sin cursos cargados</option>}
                {cursos.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {!esMaster && (
              <div className="field">
                <label htmlFor="exp-periodo">Período</label>
                <select id="exp-periodo" className="input" value={periodo} disabled={ocupado}
                  onChange={(e) => setPeriodo(e.target.value)}>
                  {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                {periodo === 'personalizado' && (
                  <div className="grid2">
                    <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Fecha desde" />
                    <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Fecha hasta" />
                  </div>
                )}
                {periodo === 'personalizado' && desde && hasta && hasta < desde && (
                  <p className="muted" style={{ color: 'var(--bad)' }}>La fecha final debe ser igual o posterior a la inicial.</p>
                )}
              </div>
            )}
            <div className="field">
              <label htmlFor="exp-formato">Formato</label>
              <select id="exp-formato" className="input" value={formato} disabled={ocupado}
                onChange={(e) => setFormato(e.target.value)}>
                <option value="excel">Excel (.xlsx)</option>
                <option value="pdf" disabled={soloExcel}>PDF</option>
              </select>
              {esMaster && (
                <p className="muted exportar-nota">
                  El Master solo se exporta en Excel, con el formato del establecimiento.
                  {!curso && ' Con todos los cursos se descarga un ZIP con un Excel por curso.'}
                </p>
              )}
              {esMensual && (
                <p className="muted exportar-nota">
                  Igual al reporte mensual del portal: un Excel por curso y mes (● presente, x ausente).
                  Si el período abarca varios meses o cursos, se descarga un ZIP.
                </p>
              )}
            </div>
            <p className="muted exportar-nota">
              <CalendarRange size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              {rango?.desde
                ? `Datos cargados: ${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)} (${rango.dias} días).`
                : 'Aún no hay asistencia cargada.'}
              {esMaster && faltanMeses && (
                <> Faltan meses del año escolar: <Link to="/ajustes" onClick={onCerrar}>sincronízalo en Ajustes</Link>.</>
              )}
            </p>
          </>
        ) : (
          <>
            <p className="muted">
              Se importan Excel del Master de inasistencias justificadas o de Asistencia mensual (formato
              del portal). El tipo y el curso se detectan desde el archivo: las justificaciones del Master
              y la asistencia del mes reemplazan a las de la app en esos mismos días. En la Asistencia
              mensual los alumnos se buscan por nombre.
            </p>
            <button type="button" className="btn ghost" disabled={ocupado} onClick={() => inputRef.current?.click()}>
              <FileUp size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
              Elegir archivos (.xlsx)
            </button>
            <input ref={inputRef} type="file" accept=".xlsx" multiple onChange={elegirArchivos} hidden />
            {archivos.length > 0 && (
              <ul className="exportar-archivos">
                {archivos.map((a) => <li key={a.name}>{a.name}</li>)}
              </ul>
            )}
            {resultados.map((item) => <ResultadoImportacion key={item.nombre} item={item} />)}
          </>
        )}

        {error && <p className="msg error" role="alert">{error}</p>}
        {aviso && <p className="msg" role="status">{aviso}</p>}

        <div className="grid2">
          <button type="button" className="btn" disabled={!puedeAceptar} onClick={modo === 'exportar' ? exportar : importar}>
            {ocupado ? (modo === 'exportar' ? 'Exportando…' : 'Importando…') : 'Aceptar'}
          </button>
          <button type="button" className="btn ghost" disabled={ocupado} onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
