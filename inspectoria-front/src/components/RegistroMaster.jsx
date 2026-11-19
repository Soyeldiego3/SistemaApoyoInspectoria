import { useEffect, useRef, useState } from 'react';
import { CalendarRange, FileDown, FileUp } from 'lucide-react';
import { exportarRegistro, getCursos, getRangoDatos, importarRegistro } from '../api.js';
import { fechaCorta } from '../fechas.js';

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const claveCurso = (c) => sinTildes(c).replace(/[\s°º]/g, '');

// "Master ... 2 medio A.xlsx" → "2°M A" (si existe en la lista de cursos)
function cursoDesdeNombreArchivo(nombre, cursos) {
  const t = sinTildes(nombre);
  const medio = /(\d+)\s*[°º]?\s*MEDIO\s*([A-Z])\b/.exec(t);
  const basico = /(\d+)\s*[°º]?\s*BASICO\s*([A-Z])\b/.exec(t);
  const candidato = medio ? `${medio[1]}°M ${medio[2]}` : basico ? `${basico[1]}°${basico[2]}` : null;
  if (!candidato) return null;
  return cursos.find((c) => claveCurso(c) === claveCurso(candidato)) || null;
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Tarjeta de Datos: exportar / importar el "Master de registro inasistencia justificadas"
export default function RegistroMaster({ version = 0, sincronizando = false, onSincronizarAnio }) {
  const [cursos, setCursos] = useState([]);
  const [curso, setCurso] = useState('');
  const [rango, setRango] = useState(null);
  const [ocupado, setOcupado] = useState('');
  const [resultado, setResultado] = useState(null);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    getCursos()
      .then((r) => {
        const lista = (r.cursos || []).map((c) => (typeof c === 'string' ? c : c.curso)).filter(Boolean);
        setCursos(lista);
        setCurso((actual) => (lista.includes(actual) ? actual : lista[0] || ''));
      })
      .catch(() => setCursos([]));
    getRangoDatos().then(setRango).catch(() => setRango(null));
  }, [version]);

  const textoError = (e) => (e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message);

  const exportar = async () => {
    if (!curso) return;
    setOcupado('exportar');
    setError(''); setAviso(''); setResultado(null);
    try {
      const { blob, nombre, advertencias } = await exportarRegistro(curso);
      descargar(blob, nombre);
      setAviso(advertencias.length ? advertencias.join(' ') : `Se descargó "${nombre}".`);
    } catch (e) {
      setError(textoError(e));
    } finally {
      setOcupado('');
    }
  };

  const importar = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setError(''); setAviso(''); setResultado(null);
    if (!/\.xlsx$/i.test(archivo.name)) {
      setError('El archivo debe ser un Excel .xlsx con el formato del Master de registro.');
      return;
    }
    const destino = cursoDesdeNombreArchivo(archivo.name, cursos) || curso;
    if (!destino) { setError('Elige el curso del archivo.'); return; }
    if (destino !== curso) setCurso(destino);
    const ok = window.confirm(
      `¿Importar "${archivo.name}" en ${destino}?\n\nLas justificaciones del archivo reemplazan a las de la app en esos mismos días.`,
    );
    if (!ok) return;
    setOcupado('importar');
    try {
      setResultado(await importarRegistro(destino, archivo));
    } catch (err) {
      setError(textoError(err));
    } finally {
      setOcupado('');
    }
  };

  // Si solo hay datos del mes actual, el Excel no tendrá el año completo
  const hoy = new Date();
  const soloMesActual = rango?.desde
    && Number(rango.desde.slice(5, 7)) === hoy.getMonth() + 1
    && hoy.getMonth() > 2;

  return (
    <section className="card registro">
      <h2>Registro de inasistencias justificadas</h2>
      <p className="muted" style={{ margin: '4px 0 12px' }}>
        Exporta o importa el "Master de registro" de un curso en Excel, con el mismo formato que usa el establecimiento.
      </p>

      <div className="registro-fila">
        <select className="input" value={curso} onChange={(e) => setCurso(e.target.value)}
          disabled={!cursos.length || Boolean(ocupado)} aria-label="Curso del registro">
          {!cursos.length && <option value="">Sin cursos cargados</option>}
          {cursos.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" className="btn" onClick={exportar} disabled={!curso || Boolean(ocupado)}>
          <FileDown size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
          {ocupado === 'exportar' ? 'Exportando…' : 'Exportar Excel'}
        </button>
        <button type="button" className="btn ghost" onClick={() => inputRef.current?.click()} disabled={!cursos.length || Boolean(ocupado)}>
          <FileUp size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
          {ocupado === 'importar' ? 'Importando…' : 'Importar Excel'}
        </button>
        <input ref={inputRef} type="file" accept=".xlsx" onChange={importar} hidden />
      </div>

      <p className="muted registro-rango">
        <CalendarRange size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {rango?.desde
          ? `Datos cargados: ${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)} (${rango.dias} días).`
          : 'Aún no hay asistencia cargada.'}
        {soloMesActual && ' Solo está el mes actual: para exportar el año completo, sincroniza el año escolar.'}
      </p>
      {onSincronizarAnio && (
        <button type="button" className="linkbtn" onClick={onSincronizarAnio} disabled={sincronizando}>
          {sincronizando ? 'Sincronizando…' : 'Sincronizar año escolar (marzo a hoy)'}
        </button>
      )}

      {error && <p className="msg" role="alert" style={{ color: 'var(--bad)', background: 'var(--bad-soft)', marginTop: 12 }}>{error}</p>}
      {aviso && <p className="msg" role="status" style={{ marginTop: 12 }}>{aviso}</p>}
      {resultado && (
        <div className="msg" role="status" style={{ marginTop: 12 }}>
          <p>
            {resultado.curso}: {resultado.registros} registros de {resultado.alumnos} alumnos.{' '}
            {resultado.nuevos} nuevos, {resultado.cambiados} cambiados, {resultado.sinCambios} sin cambios.
          </p>
          {resultado.fueraDeDatos > 0 && (
            <p className="muted">{resultado.fueraDeDatos} fechas no figuran como inasistencia en los datos sincronizados (se guardaron igual).</p>
          )}
          {resultado.noEncontrados.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary>{resultado.noEncontrados.length} alumnos del archivo no se encontraron en el curso</summary>
              <ul>{resultado.noEncontrados.map((n) => <li key={n}>{n}</li>)}</ul>
            </details>
          )}
          {resultado.filasInvalidas.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary>{resultado.filasInvalidas.length} filas no se pudieron leer</summary>
              <ul>{resultado.filasInvalidas.map((f) => <li key={f}>{f}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
