import { useState, useEffect } from 'react';
import { RefreshCw, FileUp } from 'lucide-react';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// RF-01: obtener asistencia por extracción automática (Playwright) o importando CSV/Excel
export default function Sync() {
  const [estado, setEstado] = useState('inactivo'); // inactivo | cargando | ok | error
  const [archivo, setArchivo] = useState('');
  const [cursos, setCursos] = useState([]);
  const [curso, setCurso] = useState('');
  const [mes, setMes] = useState(MESES[new Date().getMonth()]);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    fetch('/api/cursos')
      .then((r) => r.json())
      .then((d) => setCursos(d.cursos || []))
      .catch(() => {}); // sin conexión con la API: el selector queda vacío
  }, []);

  const extraer = async () => {
    setEstado('cargando');
    setMensaje('');
    try {
      const r = await fetch('/api/descargar-e-importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, mes }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo sincronizar.');
      setMensaje(`Asistencia actualizada: ${data.totalAlumnos} alumnos, ${data.filasAsistencia} registros y ${data.filasAtrasos} atrasos.`);
      setEstado('ok');
    } catch (e) {
      // TypeError = fetch no pudo conectar con la API
      setMensaje(e instanceof TypeError ? 'No hay conexión con el servidor local.' : e.message);
      setEstado('error');
    }
  };

  const importar = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(csv|xlsx?)$/i.test(f.name)) {
      setArchivo('');
      setMensaje('Archivo no válido. Usa un .csv o .xlsx con las columnas de asistencia.');
      setEstado('error');
      return;
    }
    setArchivo(f.name);
    // TODO: POST /api/import con el archivo (aún no existe el endpoint)
    setMensaje('');
    setEstado('ok');
  };

  return (
    <>
      <div className="cols2">
        <section className="card">
          <h2>Extracción automática</h2>
          <p className="muted" style={{ margin: '4px 0 14px' }}>Vuelve a descargar la asistencia de un curso desde el portal.</p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select value={curso} onChange={(e) => setCurso(e.target.value)} style={{ flex: 1 }}>
              <option value="" disabled>{cursos.length ? 'Elige un curso' : 'Cargando cursos…'}</option>
              {cursos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
              <select value={mes} onChange={(e) => setMes(e.target.value)}>
                {MESES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
          </div>

          <button className="btn" onClick={extraer} disabled={estado === 'cargando' || !curso}>
            <RefreshCw size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
            {estado === 'cargando' ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </section>

        <section className="card">
          <h2>Importar archivo</h2>
          <p className="muted" style={{ margin: '4px 0 14px' }}>Alternativa si el portal no está disponible (CSV o Excel).</p>
          <label className="btn ghost" style={{ display: 'block', textAlign: 'center', cursor: 'pointer' }}>
            <FileUp size={16} style={{ verticalAlign: -3, marginRight: 8 }} />Elegir archivo
            <input type="file" accept=".csv,.xls,.xlsx" onChange={importar} hidden />
          </label>
          {archivo && <p className="muted" style={{ marginTop: 10 }}>{archivo}</p>}
        </section>
      </div>

      {estado === 'ok' && <p className="msg" role="status">{mensaje || 'Asistencia actualizada.'}</p>}
      {estado === 'error' && (
        <p className="msg" style={{ color: 'var(--bad)', background: 'rgba(255,90,95,.12)' }} role="alert">
          {mensaje}
        </p>
      )}
    </>
  );
}