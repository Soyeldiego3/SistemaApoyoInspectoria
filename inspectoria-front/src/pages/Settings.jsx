import { useEffect, useState } from 'react';
import {
  getAjustes, getRedInfo, getTunel, setNavegadorHeadless, setRedEnabled, setTunel,
} from '../api.js';
import QrAcceso from '../components/QrAcceso.jsx';
import { useAuth } from '../auth.jsx';
import { MODOS, PALETAS, TAMANOS, useTema } from '../tema.jsx';
import Segmented from '../components/Segmented.jsx';
import Chips from '../components/Chips.jsx';
import CredencialesPortal from '../components/CredencialesPortal.jsx';

// Opciones del selector de paleta, con una muestra de color antes del nombre
const OPCIONES_PALETA = PALETAS.map((p) => ({
  id: p.id,
  label: <><span className="paleta-muestra" style={{ background: p.muestra }} />{p.label}</>,
}));

export default function Settings() {
  const { esAdmin } = useAuth();
  const {
    modo, paleta, texto, cambiarModo, cambiarPaleta, cambiarTexto,
  } = useTema();
  // Apariencia funciona en cualquier dispositivo; red y sincronización solo desde el PC
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  // Acceso en red (conexión desde el teléfono)
  const [red, setRed] = useState(null);
  const [redCargando, setRedCargando] = useState(false);

  // Acceso desde otra red (experimental, túnel de Cloudflare)
  const [tunel, setTunelInfo] = useState(null);
  const [tunelCargando, setTunelCargando] = useState(false);

  // Modo headless de Playwright (solo admin)
  const [headless, setHeadless] = useState(null);
  const [headlessCargando, setHeadlessCargando] = useState(false);

  const mostrarError = (texto) => { setMensaje(''); setError(texto); };
  const mostrarMensaje = (texto) => { setError(''); setMensaje(texto); };

  useEffect(() => {
    if (!esPc) return undefined;
    let activo = true;
    getRedInfo()
      .then((info) => { if (activo) setRed(info); })
      .catch((e) => { if (activo) mostrarError(e.message || 'No se pudo consultar el acceso en red.'); });
    return () => { activo = false; };
  }, [esPc]);

  // Estado del túnel; mientras está activo se revisa cada 15 s por si se cae
  const tunelActivo = tunel?.estado === 'activo';
  useEffect(() => {
    if (!esPc) return undefined;
    let activo = true;
    const consultar = () => getTunel()
      .then((info) => { if (activo) setTunelInfo(info); })
      .catch(() => { /* el error se muestra al intentar cambiarlo */ });
    consultar();
    const intervalo = tunelActivo ? setInterval(consultar, 15_000) : null;
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
  }, [esPc, tunelActivo]);

  useEffect(() => {
    if (!esAdmin || !esPc) return undefined;
    let activo = true;
    getAjustes()
      .then((ajustes) => { if (activo) setHeadless(ajustes.navegadorHeadless); })
      .catch((e) => { if (activo) mostrarError(e.message || 'No se pudieron cargar los ajustes.'); });
    return () => { activo = false; };
  }, [esAdmin, esPc]);

  const cambiarRed = async (habilitada) => {
    setRedCargando(true);
    try {
      setRed(await setRedEnabled(habilitada));
      setError('');
    } catch (e) {
      mostrarError(e.message || 'No se pudo cambiar el acceso en red.');
    } finally {
      setRedCargando(false);
    }
  };

  const cambiarTunel = async (activo) => {
    setTunelCargando(true);
    if (activo) setTunelInfo((t) => ({ ...t, estado: 'iniciando', error: null }));
    try {
      setTunelInfo(await setTunel(activo));
      setError('');
    } catch (e) {
      mostrarError(e.message || 'No se pudo cambiar el acceso desde otra red.');
      getTunel().then(setTunelInfo).catch(() => {});
    } finally {
      setTunelCargando(false);
    }
  };

  const cambiarNavegadorVisible = async (visible) => {
    setHeadlessCargando(true);
    try {
      const ajustes = await setNavegadorHeadless(!visible);
      setHeadless(ajustes.navegadorHeadless);
      mostrarMensaje(visible
        ? 'El navegador se mostrará en la próxima sincronización.'
        : 'El navegador quedará oculto en la próxima sincronización.');
    } catch (e) {
      mostrarError(e.message || 'No se pudo guardar el ajuste.');
    } finally {
      setHeadlessCargando(false);
    }
  };

  return (
    <div className="dash">
      <h2>Ajustes</h2>

      <section className="card">
        <h2>Apariencia</h2>
        <p className="muted">Se guarda solo en este dispositivo.</p>
        <p className="muted" style={{ margin: '14px 0 8px' }}>Modo</p>
        <Segmented opciones={MODOS} valor={modo} onChange={cambiarModo} />
        <p className="muted" style={{ margin: '14px 0 8px' }}>Paleta de colores</p>
        <Chips opciones={OPCIONES_PALETA} valor={paleta} onChange={cambiarPaleta} />
        <p className="muted" style={{ margin: '14px 0 8px' }}>Tamaño del texto</p>
        <Segmented opciones={TAMANOS} valor={texto} onChange={cambiarTexto} />
      </section>

      {esPc && <CredencialesPortal />}

      {esPc && (
        <section className="card">
          <div className="row">
            <div>
              <h2>Conectar desde el teléfono</h2>
              <p className="muted">El PC y el teléfono deben estar en la misma red.</p>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={Boolean(red?.habilitada)} disabled={redCargando || !red}
                onChange={(e) => cambiarRed(e.target.checked)} />
              Acceso en red
            </label>
          </div>
          {red?.habilitada && red.principal ? (
            <QrAcceso base={red.principal} onMensaje={mostrarMensaje} onError={mostrarError} />
          ) : red ? (
            <p className="muted" style={{ marginTop: 16 }}>Activa el acceso en red para mostrar una URL y un código QR.</p>
          ) : (
            <p className="muted" style={{ marginTop: 16 }}>Cargando configuración de red…</p>
          )}
        </section>
      )}

      {esPc && (
        <section className="card">
          <div className="row">
            <div>
              <h2>Acceso desde otra red <span className="tag warn" style={{ verticalAlign: 3 }}>Experimental</span></h2>
              <p className="muted">
                Conecta el teléfono a través de un túnel temporal de Cloudflare, aunque la red del colegio bloquee la
                conexión directa o el teléfono use datos móviles. Los datos siguen solo en este PC.
              </p>
            </div>
            <button className={`btn${tunelActivo ? ' ghost' : ''}`}
              disabled={tunelCargando || !tunel || tunel.estado === 'iniciando'}
              onClick={() => cambiarTunel(!tunelActivo)}>
              {tunel?.estado === 'iniciando' ? 'Iniciando…' : tunelActivo ? 'Desactivar túnel' : 'Activar túnel'}
            </button>
          </div>
          {tunelActivo && tunel.url ? (
            <>
              <QrAcceso base={tunel.url} onMensaje={mostrarMensaje} onError={mostrarError} />
              <p className="muted" style={{ marginTop: 12, fontSize: '.85rem' }}>
                La URL es pública mientras el túnel esté activo y solo se puede entrar escaneando el QR.
                Si no carga de inmediato, espera unos segundos. Desactívalo al terminar.
              </p>
            </>
          ) : tunel?.estado === 'iniciando' ? (
            <p className="muted" style={{ marginTop: 16 }}>Conectando con Cloudflare… puede tardar unos segundos.</p>
          ) : tunel?.estado === 'error' ? (
            <p style={{ marginTop: 16, color: 'var(--bad)' }} role="alert">{tunel.error}</p>
          ) : (
            <p className="muted" style={{ marginTop: 16 }}>
              Función en prueba. Al activarla se genera una URL temporal que deja de existir al desactivarla o al cerrar la app.
            </p>
          )}
        </section>
      )}

      {esAdmin && esPc && (
        <section className="card">
          <div className="row">
            <div>
              <h2>Sincronización</h2>
              <p className="muted">Muestra la ventana del navegador mientras se leen los datos del portal. Útil para depurar.</p>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={headless === false} disabled={headlessCargando || headless === null}
                onChange={(e) => cambiarNavegadorVisible(e.target.checked)} />
              Mostrar navegador
            </label>
          </div>
        </section>
      )}

      {mensaje && <p className="msg" role="status">{mensaje}</p>}
      {error && <p className="msg" style={{ color: 'var(--bad)' }} role="alert">{error}</p>}
    </div>
  );
}
