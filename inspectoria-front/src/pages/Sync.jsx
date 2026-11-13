import { useState } from 'react';
import { RefreshCw, FileUp } from 'lucide-react';
import { iniciarSync } from '../api.js';

// RF-01: obtener asistencia por extracción automática (Playwright) o importando CSV/Excel
export default function Sync() {
  const [estado, setEstado] = useState('inactivo'); // inactivo | cargando | ok | error
  const [archivo, setArchivo] = useState('');
  const [mensaje, setMensaje] = useState('');

  const extraer = async () => {
    setEstado('cargando');
    setMensaje('');
    try {
      const data = await iniciarSync();
      const errores = data.errores?.length || 0;
      const detalleErrores = errores ? ` ${errores} cursos tuvieron errores.` : '';
      setMensaje(`Asistencia actualizada: ${data.cursosProcesados} de ${data.totalCursos} cursos, ${data.totalAlumnos} alumnos, ${data.filasAsistencia} registros y ${data.filasAtrasos} atrasos.${detalleErrores}`);
      setEstado(errores ? 'error' : 'ok');
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
          <p className="muted" style={{ margin: '4px 0 14px' }}>Descarga la asistencia de todos los cursos del mes actual.</p>

          <button className="btn" onClick={extraer} disabled={estado === 'cargando'}>
            <RefreshCw size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
            {estado === 'cargando' ? 'Sincronizando…' : 'Sincronizar todos'}
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