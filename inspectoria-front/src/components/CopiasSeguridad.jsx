// Tarjeta "Copias de seguridad" de Ajustes (pages/Settings.jsx).
// Guarda las notas de las alertas y los justificativos aprobados; la asistencia no, porque
// se vuelve a descargar del portal. Desde el PC: copia automática cada cierto tiempo,
// copia al pendrive, lista de copias para recuperar y una contraseña opcional.
// Desde el teléfono: solo descargar una copia o recuperar desde un archivo.
import { useEffect, useRef, useState } from 'react';
import {
  descargarRespaldo,
  elegirCarpetaRespaldo,
  getConfigRespaldo,
  guardarCopiaAhora,
  listarRespaldosAutomaticos,
  recuperarCopiaGuardada,
  restaurarRespaldo,
  setConfigRespaldo,
} from '../api.js';
import { descargar } from '../descargas.js';
import { fechaCorta, fechaLocal } from '../fechas.js';
import { esPc } from '../portal.js';
import { plural } from '../texto.js';

const ERRORES_CLAVE = ['CLAVE_REQUERIDA', 'CLAVE_INCORRECTA'];

const ETIQUETA_INTERVALO = {
  0: 'Solo al abrir y cerrar',
  30: 'Cada 30 minutos',
  60: 'Cada 1 hora',
  180: 'Cada 3 horas',
  360: 'Cada 6 horas',
  720: 'Cada 12 horas',
  1440: 'Una vez al día',
};

// Milisegundos → "42 min" / "2 h 5 min" / "unos segundos"
function textoFalta(ms) {
  const minutos = Math.ceil(ms / 60_000);
  if (minutos <= 1) return ms <= 0 ? 'unos segundos' : '1 min';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

// '2026-11-24' → 'hoy' / 'ayer' / '24-11-2026'
function textoDia(fecha) {
  const hoy = new Date();
  if (fecha === fechaLocal(hoy)) return 'hoy';
  if (fecha === fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1))) return 'ayer';
  return fechaCorta(fecha);
}

const textoCopia = (copia) => `${textoDia(copia.fecha)}${copia.hora ? ` ${copia.hora}` : ''}`;

function textoRecuperada({ alertas, justificativos }) {
  const notas = alertas.nuevas + alertas.actualizadas;
  const nuevos = justificativos.nuevos;
  if (!notas && !nuevos) return 'Copia revisada: todo ya estaba al día, no hubo nada que recuperar.';
  const mantenidos = alertas.omitidas + justificativos.omitidos;
  return `Copia recuperada: ${plural(notas, 'nota', 'notas')} y ${plural(nuevos, 'justificativo', 'justificativos')}.`
    + (mantenidos ? ' Lo que ya estaba más nuevo se mantuvo.' : '');
}

// Hora actual que se renueva cada `cadaMs` (para la cuenta regresiva)
function useAhora(cadaMs) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(id);
  }, [cadaMs]);
  return ahora;
}

const pequeno = { fontSize: '.85rem' };

export default function CopiasSeguridad() {
  const [config, setConfig] = useState(null); // solo desde el PC
  const [copias, setCopias] = useState(null); // copias guardadas en este PC
  const [ocupado, setOcupado] = useState(null); // null | 'guardar' | 'recuperar' | 'descargar' | 'carpeta' | 'contrasena'
  const [aviso, setAviso] = useState(null); // { tipo: 'ok' | 'error', texto }
  // Copia con contraseña que se quiere recuperar: { nombre } (de la lista) o { archivo } (File)
  const [pendiente, setPendiente] = useState(null);
  const [clave, setClave] = useState('');
  const [nuevaContrasena, setNuevaContrasena] = useState('');
  const [carpetaEscrita, setCarpetaEscrita] = useState('');
  const inputArchivo = useRef(null);
  const ahora = useAhora(30_000);

  const recargar = () => {
    if (!esPc) return;
    listarRespaldosAutomaticos().then(({ respaldos }) => setCopias(respaldos)).catch(() => setCopias([]));
    getConfigRespaldo()
      .then((c) => { setConfig(c); setCarpetaEscrita(c.carpetaExterna || ''); })
      .catch(() => {});
  };

  useEffect(recargar, []);

  // Cuando se cumple la hora, el backend revisa solo: se vuelve a consultar para ver el resultado
  const proximo = config?.proximoRespaldo ? Date.parse(config.proximoRespaldo) : null;
  const vencido = proximo !== null && proximo <= ahora;
  useEffect(() => {
    if (vencido) recargar();
  }, [vencido, ahora]);

  // Ejecuta una acción mostrando su estado y el error si falla
  const hacer = async (accion, fn) => {
    setOcupado(accion);
    setAviso(null);
    try {
      await fn();
    } catch (error) {
      setAviso({ tipo: 'error', texto: error.message || 'Algo falló. Inténtalo de nuevo.' });
    } finally {
      setOcupado(null);
    }
  };

  const cambiarConfig = (accion, cambios, textoOk) => hacer(accion, async () => {
    const nueva = await setConfigRespaldo(cambios);
    setConfig(nueva);
    setCarpetaEscrita(nueva.carpetaExterna || '');
    if (cambios.contrasena) setNuevaContrasena('');
    if (textoOk) setAviso({ tipo: 'ok', texto: textoOk });
    recargar();
  });

  const guardarAhora = () => hacer('guardar', async () => {
    const { resultado } = await guardarCopiaAhora();
    setAviso({
      tipo: 'ok',
      texto: resultado === 'creado' ? 'Copia guardada.' : 'Ya estaba al día: la última copia tiene todo.',
    });
    recargar();
  });

  const elegirCarpeta = () => hacer('carpeta', async () => {
    const nueva = await elegirCarpetaRespaldo();
    if (nueva.cancelado) return;
    setConfig(nueva);
    setAviso({ tipo: 'ok', texto: 'Listo: las copias también se guardarán en esa carpeta.' });
    recargar();
  });

  // origen: { nombre } (copia de la lista) o { archivo } (File elegido)
  const recuperar = (origen, contrasena) => hacer('recuperar', async () => {
    try {
      const { resumen } = origen.nombre
        ? await recuperarCopiaGuardada(origen.nombre, contrasena)
        : await restaurarRespaldo(origen.archivo, contrasena);
      setAviso({ tipo: 'ok', texto: textoRecuperada(resumen) });
      setPendiente(null);
      setClave('');
    } catch (error) {
      if (!ERRORES_CLAVE.includes(error.code)) {
        setPendiente(null);
        throw error;
      }
      setPendiente(origen); // pide (de nuevo) la contraseña
      if (error.code === 'CLAVE_INCORRECTA') setAviso({ tipo: 'error', texto: error.message });
    } finally {
      if (inputArchivo.current) inputArchivo.current.value = '';
    }
  });

  const descargarCopia = () => hacer('descargar', async () => {
    const { blob, nombre, clave: modo } = await descargarRespaldo();
    descargar(blob, nombre);
    setAviso({
      tipo: 'ok',
      texto: modo === 'contrasena'
        ? 'Copia descargada. Para recuperarla en otro computador se necesita tu contraseña.'
        : 'Copia descargada. Se puede recuperar en cualquier computador con esta app.',
    });
  });

  const bloqueado = ocupado !== null;
  const ultima = copias?.[0];
  const minimo = config?.minContrasena || 8;

  return (
    <section className="card">
      <h2>Copias de seguridad</h2>
      <p className="muted">
        Guarda las notas de las alertas y los justificativos. La asistencia no, porque se vuelve a descargar del portal.
      </p>

      {esPc && config && (
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          <div className="row">
            <label htmlFor="copia-frecuencia">Copia automática</label>
            <select id="copia-frecuencia" className="input" style={{ width: 'auto' }} disabled={bloqueado}
              value={config.intervaloMin}
              onChange={(e) => cambiarConfig('frecuencia', { intervaloMin: Number(e.target.value) })}>
              {config.intervalos.map((min) => (
                <option key={min} value={min}>{ETIQUETA_INTERVALO[min] ?? `Cada ${min} minutos`}</option>
              ))}
            </select>
          </div>

          <div className="row">
            <span>Copiar al pendrive</span>
            {config.selectorCarpeta ? (
              <span className="row" style={{ gap: 10, minWidth: 0 }}>
                <span className={config.carpetaExterna ? '' : 'muted'} title={config.carpetaExterna || undefined}
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {config.carpetaExterna || 'No'}
                </span>
                <button className="linkbtn" type="button" disabled={bloqueado} onClick={elegirCarpeta}>
                  {ocupado === 'carpeta' ? 'Eligiendo…' : config.carpetaExterna ? 'Cambiar' : 'Elegir carpeta'}
                </button>
                {config.carpetaExterna && (
                  <button className="linkbtn" type="button" disabled={bloqueado}
                    onClick={() => cambiarConfig('carpeta', { carpetaExterna: '' }, 'Ya no se copiará al pendrive.')}>
                    Quitar
                  </button>
                )}
              </span>
            ) : (
              <form className="row" style={{ gap: 8 }} onSubmit={(e) => {
                e.preventDefault();
                cambiarConfig('carpeta', { carpetaExterna: carpetaEscrita },
                  carpetaEscrita.trim() ? 'Listo: las copias también se guardarán en esa carpeta.' : 'Ya no se copiará al pendrive.');
              }}>
                <input className="input" value={carpetaEscrita} onChange={(e) => setCarpetaEscrita(e.target.value)}
                  placeholder="Por ejemplo E:\Copias" aria-label="Carpeta del pendrive" />
                <button className="btn outline" type="submit" style={{ width: 'auto' }} disabled={bloqueado}>Guardar</button>
              </form>
            )}
          </div>

          <p className="muted" style={pequeno}>
            {ultima ? `✓ Última copia: ${textoCopia(ultima)}` : 'Todavía no hay copias.'}
            {proximo !== null && ` · próxima revisión en ${textoFalta(proximo - ahora)}`}
          </p>
        </div>
      )}

      <div className="row" style={{ gap: 8, justifyContent: 'flex-start', flexWrap: 'wrap', marginTop: 12 }}>
        {esPc ? (
          <button className="btn" type="button" style={{ width: 'auto' }} disabled={bloqueado} onClick={guardarAhora}>
            {ocupado === 'guardar' ? 'Guardando…' : 'Guardar copia ahora'}
          </button>
        ) : (
          <>
            <button className="btn" type="button" style={{ width: 'auto' }} disabled={bloqueado} onClick={descargarCopia}>
              {ocupado === 'descargar' ? 'Descargando…' : 'Descargar una copia'}
            </button>
            <button className="btn outline" type="button" style={{ width: 'auto' }} disabled={bloqueado}
              onClick={() => { setPendiente(null); inputArchivo.current?.click(); }}>
              Recuperar desde un archivo…
            </button>
          </>
        )}
      </div>
      <input ref={inputArchivo} type="file" accept=".inspbak,.json" hidden
        onChange={(e) => { const archivo = e.target.files?.[0]; if (archivo) recuperar({ archivo }); }} />

      {esPc && (
        <details style={{ marginTop: 14 }} onToggle={(e) => { if (e.currentTarget.open) recargar(); }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>Copias guardadas</summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {copias?.length ? copias.map((c) => (
              <div key={c.nombre} className="row">
                <span>{textoCopia(c)}</span>
                <button className="linkbtn" type="button" disabled={bloqueado} onClick={() => recuperar({ nombre: c.nombre })}>
                  Recuperar
                </button>
              </div>
            )) : <p className="muted" style={pequeno}>Todavía no hay copias.</p>}
            <button className="linkbtn" type="button" style={{ justifySelf: 'start', marginTop: 4 }} disabled={bloqueado}
              onClick={() => { setPendiente(null); inputArchivo.current?.click(); }}>
              Recuperar desde un archivo… (pendrive u otro computador)
            </button>
            <p className="muted" style={pequeno}>Recuperar no borra nada: si algo cambió después de la copia, se mantiene lo más nuevo.</p>
          </div>
        </details>
      )}

      {esPc && config && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>Más opciones</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {config.conContrasena ? (
              <div className="row">
                <span style={pequeno}>Las copias usan tu contraseña. Sin ella no se recuperan en otro computador.</span>
                <button className="linkbtn" type="button" disabled={bloqueado}
                  onClick={() => cambiarConfig('contrasena', { contrasena: null }, 'Contraseña quitada.')}>
                  Quitar contraseña
                </button>
              </div>
            ) : (
              <>
                <form className="row" style={{ gap: 8 }} onSubmit={(e) => {
                  e.preventDefault();
                  cambiarConfig('contrasena', { contrasena: nuevaContrasena }, 'Contraseña guardada.');
                }}>
                  <input className="input" type="password" autoComplete="new-password" value={nuevaContrasena}
                    onChange={(e) => setNuevaContrasena(e.target.value)} minLength={minimo}
                    placeholder={`Contraseña propia (opcional, mín. ${minimo})`} aria-label="Contraseña propia" />
                  <button className="btn outline" type="submit" style={{ width: 'auto' }}
                    disabled={bloqueado || nuevaContrasena.length < minimo}>Poner</button>
                </form>
                <p className="muted" style={pequeno}>
                  No hace falta: las copias ya van protegidas. Si pones una, anótala, porque sin ella no se recuperan en otro computador.
                </p>
              </>
            )}
            <button className="linkbtn" type="button" style={{ justifySelf: 'start' }} disabled={bloqueado} onClick={descargarCopia}>
              {ocupado === 'descargar' ? 'Descargando…' : 'Descargar una copia'}
            </button>
          </div>
        </details>
      )}

      {pendiente && (
        <form className="row" style={{ gap: 8, marginTop: 12 }}
          onSubmit={(e) => { e.preventDefault(); recuperar(pendiente, clave); }}>
          <input className="input" type="password" autoFocus value={clave} onChange={(e) => setClave(e.target.value)}
            placeholder="Contraseña de la copia" aria-label="Contraseña de la copia" />
          <button className="btn" type="submit" style={{ width: 'auto' }} disabled={bloqueado || !clave}>Recuperar</button>
          <button className="linkbtn" type="button" onClick={() => { setPendiente(null); setClave(''); }}>Cancelar</button>
        </form>
      )}

      {aviso && (
        <p className={aviso.tipo === 'error' ? 'msg error' : 'msg'} role={aviso.tipo === 'error' ? 'alert' : 'status'}
          style={{ marginTop: 12 }}>
          {aviso.texto}
        </p>
      )}
    </section>
  );
}
