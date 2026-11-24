import { useEffect, useRef, useState } from 'react';
import {
  descargarRespaldo,
  descargarRespaldoAutomatico,
  getConfigRespaldo,
  listarRespaldosAutomaticos,
  restaurarRespaldo,
  setConfigRespaldo,
} from '../api.js';
import { descargar } from '../descargas.js';
import { fechaCorta } from '../fechas.js';
import { esPc } from '../portal.js';
import { plural } from '../texto.js';

const ERRORES_CLAVE = ['CLAVE_REQUERIDA', 'CLAVE_INCORRECTA'];

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

// Qué se puede hacer con el archivo descargado, según cómo quedó cifrado
function textoDescarga(clave) {
  if (clave === 'contrasena') {
    return 'Respaldo descargado y cifrado con la contraseña de respaldo. Guárdalo en un pendrive: se puede restaurar en otro computador con esa contraseña.';
  }
  return 'Respaldo descargado y cifrado. Como no hay contraseña de respaldo, solo se puede restaurar en este computador.';
}

// Contraseña de respaldo y carpeta externa (pendrive). Cualquier usuario, desde el PC.
function ProteccionRespaldo() {
  const [config, setConfig] = useState(null);
  const [contrasena, setContrasena] = useState('');
  const [carpeta, setCarpeta] = useState('');
  const [guardando, setGuardando] = useState(null); // null | 'contrasena' | 'carpeta'
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    getConfigRespaldo()
      .then((c) => { setConfig(c); setCarpeta(c.carpetaExterna || ''); })
      .catch(() => setConfig(null));
  }, []);

  const guardar = async (campo, cambios, textoOk) => {
    setGuardando(campo);
    setAviso(null);
    try {
      const nueva = await setConfigRespaldo(cambios);
      setConfig(nueva);
      setCarpeta(nueva.carpetaExterna || '');
      if (campo === 'contrasena') setContrasena('');
      setAviso({ tipo: 'ok', texto: textoOk });
    } catch (error) {
      setAviso({ tipo: 'error', texto: error.message || 'No se pudo guardar.' });
    } finally {
      setGuardando(null);
    }
  };

  if (!config) return null;
  const minimo = config.minContrasena || 8;
  return (
    <details style={{ marginTop: 14 }}>
      <summary className="muted" style={{ cursor: 'pointer' }}>
        Contraseña y copia externa {config.conContrasena ? '· protegido con contraseña' : '· sin contraseña'}
      </summary>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        <p className="muted" style={{ fontSize: '.85rem' }}>
          Los respaldos siempre se guardan cifrados. Con una contraseña de respaldo, además se pueden
          restaurar en otro computador (por ejemplo, si este se daña).
        </p>
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => {
          e.preventDefault();
          guardar('contrasena', { contrasena }, 'Contraseña de respaldo guardada. Los próximos respaldos la usarán.');
        }}>
          <input className="input" type="password" autoComplete="new-password" value={contrasena}
            onChange={(e) => setContrasena(e.target.value)} minLength={minimo}
            placeholder={config.conContrasena ? 'Nueva contraseña de respaldo' : `Contraseña de respaldo (mín. ${minimo})`}
            aria-label="Contraseña de respaldo" />
          <button className="btn" type="submit" style={{ width: 'auto' }}
            disabled={guardando !== null || contrasena.length < minimo}>
            {guardando === 'contrasena' ? 'Guardando…' : 'Guardar'}
          </button>
        </form>
        <p className="muted" style={{ fontSize: '.85rem' }}>
          Anótala en un lugar seguro: sin ella no se puede abrir el respaldo en otro equipo.
        </p>
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => {
          e.preventDefault();
          guardar('carpeta', { carpetaExterna: carpeta }, carpeta.trim()
            ? 'Carpeta externa guardada. Cada respaldo automático también se copiará ahí.'
            : 'Se quitó la copia a carpeta externa.');
        }}>
          <input className="input" value={carpeta} onChange={(e) => setCarpeta(e.target.value)}
            placeholder="Carpeta del pendrive, por ejemplo E:\Respaldos" aria-label="Carpeta para copia externa" />
          <button className="btn outline" type="submit" style={{ width: 'auto' }} disabled={guardando !== null}>
            {guardando === 'carpeta' ? 'Guardando…' : 'Guardar'}
          </button>
        </form>
        <p className="muted" style={{ fontSize: '.85rem' }}>
          {config.conContrasena
            ? 'Se copian los últimos 7 respaldos. Si el pendrive no está conectado, el respaldo queda igual en este computador.'
            : 'La copia externa empieza cuando definas una contraseña de respaldo.'}
        </p>
        {aviso && (
          <p className={aviso.tipo === 'error' ? 'msg error' : 'msg'} role={aviso.tipo === 'error' ? 'alert' : 'status'}>
            {aviso.texto}
          </p>
        )}
      </div>
    </details>
  );
}

// Tarjeta de Ajustes: respaldar y restaurar las notas de alertas y los justificativos aprobados
export default function RespaldoInformacion() {
  const [procesando, setProcesando] = useState(null); // null | 'respaldar' | 'restaurar'
  const [aviso, setAviso] = useState(null); // { tipo: 'ok' | 'error', texto }
  const [automaticos, setAutomaticos] = useState(null);
  // Respaldo con contraseña elegido para restaurar: se pide la contraseña antes de enviarlo
  const [pendiente, setPendiente] = useState(null); // File | null
  const [claveRestaurar, setClaveRestaurar] = useState('');
  const inputRef = useRef(null);
  // Lo que toca archivos del PC (lista de automáticos, pendrive) solo se ve desde el PC
  const verAutomaticos = esPc;

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
      const { blob, nombre, clave } = await descargarRespaldo();
      descargar(blob, nombre);
      setAviso({ tipo: 'ok', texto: textoDescarga(clave) });
    } catch (error) {
      setAviso({ tipo: 'error', texto: error.message || 'No se pudo generar el respaldo.' });
    } finally {
      setProcesando(null);
    }
  };

  const restaurar = async (archivo, contrasena) => {
    if (!archivo) return;
    setProcesando('restaurar');
    setAviso(null);
    try {
      const { resumen } = await restaurarRespaldo(archivo, contrasena);
      setAviso({ tipo: 'ok', texto: textoResumen(resumen) });
      setPendiente(null);
      setClaveRestaurar('');
    } catch (error) {
      if (ERRORES_CLAVE.includes(error.code)) {
        // Se queda con el archivo y pide (de nuevo) la contraseña
        setPendiente(archivo);
        if (error.code === 'CLAVE_INCORRECTA') setAviso({ tipo: 'error', texto: error.message });
      } else {
        setPendiente(null);
        setAviso({ tipo: 'error', texto: error.message || 'No se pudo restaurar el respaldo.' });
      }
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
        Guarda las notas y estados de las alertas y los justificativos aprobados, comprimidos y cifrados.
        No incluye la asistencia ni los atrasos, que se vuelven a sincronizar desde el portal.
      </p>
      <div className="portal-acciones">
        <button className="btn" type="button" disabled={Boolean(procesando)} onClick={respaldar}>
          {procesando === 'respaldar' ? 'Respaldando…' : 'Respaldar información'}
        </button>
        <button className="btn outline" type="button" disabled={Boolean(procesando)}
          onClick={() => { setPendiente(null); inputRef.current?.click(); }}>
          {procesando === 'restaurar' ? 'Restaurando…' : 'Restaurar respaldo'}
        </button>
      </div>
      <input ref={inputRef} type="file" accept=".inspbak,.json" hidden
        onChange={(e) => restaurar(e.target.files?.[0])} />
      {pendiente && (
        <form className="row" style={{ gap: 8, marginTop: 12 }}
          onSubmit={(e) => { e.preventDefault(); restaurar(pendiente, claveRestaurar); }}>
          <input className="input" type="password" autoFocus value={claveRestaurar}
            onChange={(e) => setClaveRestaurar(e.target.value)}
            placeholder={`Contraseña de "${pendiente.name}"`} aria-label="Contraseña del respaldo" />
          <button className="btn" type="submit" style={{ width: 'auto' }}
            disabled={Boolean(procesando) || !claveRestaurar}>Restaurar</button>
          <button className="linkbtn" type="button" onClick={() => { setPendiente(null); setClaveRestaurar(''); }}>
            Cancelar
          </button>
        </form>
      )}
      <p className="muted" style={{ marginTop: 10, fontSize: '.85rem' }}>
        Al restaurar no se pierde nada: si una nota cambió después del respaldo, se mantiene la más reciente.
      </p>
      {aviso && (
        <p className={aviso.tipo === 'error' ? 'msg error' : 'msg'} role={aviso.tipo === 'error' ? 'alert' : 'status'}
          style={{ marginTop: 12 }}>
          {aviso.texto}
        </p>
      )}
      {verAutomaticos && <ProteccionRespaldo />}
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
