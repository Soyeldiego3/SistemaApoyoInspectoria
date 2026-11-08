import { useState } from 'react';
import { RefreshCw, FileUp } from 'lucide-react';

// RF-01: obtener asistencia por extracción automática (Playwright) o importando CSV/Excel
export default function Sync() {
  const [estado, setEstado] = useState('inactivo'); // inactivo | cargando | ok | error
  const [archivo, setArchivo] = useState('');

  const extraer = () => {
    setEstado('cargando');
    // TODO: POST /api/sync (lanza el extractor Playwright)
    setTimeout(() => setEstado('ok'), 1500);
  };

  const importar = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(csv|xlsx?)$/i.test(f.name)) { setArchivo(''); setEstado('error'); return; }
    setArchivo(f.name);
    // TODO: POST /api/import con el archivo
    setEstado('ok');
  };

  return (
    <>
      <div className="cols2">
      <section className="card">
        <h2>Extracción automática</h2>
        <p className="muted" style={{ margin: '4px 0 14px' }}>Descarga la asistencia del portal institucional.</p>
        <button className="btn" onClick={extraer} disabled={estado === 'cargando'}>
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
      {estado === 'ok' && <p className="msg" role="status">Asistencia actualizada.</p>}
      {estado === 'error' && <p className="msg" style={{ color: 'var(--bad)', background: 'rgba(255,90,95,.12)' }} role="alert">Archivo no válido. Usa un .csv o .xlsx con las columnas de asistencia.</p>}
    </>
  );
}
