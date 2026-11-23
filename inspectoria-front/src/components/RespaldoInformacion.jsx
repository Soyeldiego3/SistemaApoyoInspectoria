import { useEffect, useRef, useState } from 'react';
import {
  descargarRespaldo,
  descargarRespaldoAutomatico,
  listarRespaldosAutomaticos,
  restaurarRespaldo,
} from '../api.js';
import { useAuth } from '../auth.jsx';
import { descargar } from '../descargas.js';
import { fechaCorta } from '../fechas.js';
import { esPc } from '../portal.js';
import { plural } from '../texto.js';

function textoResumen({ alertas, justificativos }) {
  const restauradas = alertas.nuevas + alertas.actualizadas;
  const partes = [
    `${plural(restauradas, 'nota restaurada', 'notas restauradas')}`,
    `${plural(justificativos.nuevos, 'justificativo restaurado', 'justificativos restaurados')}`,
  ];
  const omitidos = alertas.omitidas + justificativos.omitidos;
  const extra = omitidos
    ? ` ${plural(omitidos, 'registro se mantuvo', 'registros se mantuvieron')} porque ya había una versión igual o más reciente.`
    : '';
  return `Respaldo restaurado: ${partes.join(' y ')}.${extra}`;
}

// Tarjeta de Ajustes: respaldar y restaurar las notas de alertas y los justificativos aprobados
export default function RespaldoInformacion() {
  const { esAdmin } = useAuth();
  const [procesando, setProcesando] = useState(null); // null | 'respaldar' | 'restaurar'
  const [aviso, setAviso] = useState(null); // { tipo: 'ok' | 'error', texto }
  const [automaticos, setAutomaticos] = useState(null);
  const inputRef = useRef(null);
  const verAutomaticos = esAdmin && esPc;

  const cargarAutomaticos = () => {
    listarRespaldosAutomaticos()
      .then(({ respaldos }) => setAutomaticos(respaldos))
      .catch(() => setAutomaticos([]));
  };

  useEffect(() => {
    if (verAutomaticos) cargarAutomaticos();
  }, [verAutomaticos]);

  const respaldar = async () => {
    setProcesando('respaldar');
    setAviso(null);
    try {
      const { blob, nombre } = await descargarRespaldo();
      descargar(blob, nombre);
      setAviso({ tipo: 'ok', texto: 'Respaldo descargado. Guárdalo en un pendrive o en la nube.' });
    } catch (error) {
      setAviso({ tipo: 'error', texto: error.message || 'No se pudo generar el respaldo.' });
    } finally {
      setProcesando(null);
    }
  };

  const restaurar = async (archivo) => {
    if (!archivo) return;
    setProcesando('restaurar');
    setAviso(null);
    try {
      const { resumen } = await restaurarRespaldo(archivo);
      setAviso({ tipo: 'ok', texto: textoResumen(resumen) });
    } catch (error) {
      setAviso({ tipo: 'error', texto: error.message || 'No se pudo restaurar el respaldo.' });
    } finally {
      setProcesando(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const bajarAutomatico = async (nombre) => {
    try {
      const { blob } = await descargarRespaldoAutomatico(nombre);
      descargar(blob, nombre);
    } catch (error) {
      setAviso({ tipo: 'error', texto: error.message || 'No se pudo descargar el respaldo.' });
    }
  };

  return (
    <section className="card">
      <h2>Respaldo de información</h2>
      <p className="muted">
        Guarda las notas y estados de las alertas y los justificativos aprobados. No incluye la asistencia
        ni los atrasos, que se vuelven a sincronizar desde el portal.
      </p>
      <div className="portal-acciones">
        <button className="btn" type="button" disabled={Boolean(procesando)} onClick={respaldar}>
          {procesando === 'respaldar' ? 'Respaldando…' : 'Respaldar información'}
        </button>
        {esAdmin && (
          <button className="btn outline" type="button" disabled={Boolean(procesando)}
            onClick={() => inputRef.current?.click()}>
            {procesando === 'restaurar' ? 'Restaurando…' : 'Restaurar respaldo'}
          </button>
        )}
      </div>
      {esAdmin && (
        <input ref={inputRef} type="file" accept=".json,application/json" hidden
          onChange={(e) => restaurar(e.target.files?.[0])} />
      )}
      {esAdmin && (
        <p className="muted" style={{ marginTop: 10, fontSize: '.85rem' }}>
          Al restaurar no se pierde nada: si una nota cambió después del respaldo, se mantiene la más reciente.
        </p>
      )}
      {aviso && (
        <p className={aviso.tipo === 'error' ? 'msg error' : 'msg'} role={aviso.tipo === 'error' ? 'alert' : 'status'}
          style={{ marginTop: 12 }}>
          {aviso.texto}
        </p>
      )}
      {verAutomaticos && (
        <details style={{ marginTop: 14 }} onToggle={(e) => { if (e.currentTarget.open) cargarAutomaticos(); }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Respaldos automáticos {automaticos ? `(${automaticos.length})` : ''}
          </summary>
          <p className="muted" style={{ fontSize: '.85rem', margin: '8px 0' }}>
            Se guardan solos al abrir y al cerrar la app, cuando hay cambios. Se conservan los últimos 7.
          </p>
          {automaticos?.length ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {automaticos.map((r) => (
                <li key={r.nombre} className="row">
                  <span>{fechaCorta(r.fecha)} <span className="muted">· {Math.max(1, Math.round(r.bytes / 1024))} KB</span></span>
                  <button className="linkbtn" type="button" onClick={() => bajarAutomatico(r.nombre)}>Descargar</button>
                </li>
              ))}
            </ul>
          ) : automaticos && <p className="muted">Todavía no hay respaldos automáticos.</p>}
        </details>
      )}
    </section>
  );
}
