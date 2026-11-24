import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import {
  getAjustes, getRedInfo, setInicioWindows, setNavegadorHeadless, setRedEnabled,
} from '../api.js';
import { useAuth } from '../auth.jsx';
import { esPc } from '../portal.js';
import { MODOS, PALETAS, TAMANOS, useTema } from '../tema.jsx';
import Segmented from '../components/Segmented.jsx';
import Chips from '../components/Chips.jsx';
import CredencialesPortal from '../components/CredencialesPortal.jsx';
import ExtraccionAutomatica from '../components/ExtraccionAutomatica.jsx';
import CopiasSeguridad from '../components/CopiasSeguridad.jsx';
import QrInicioSesion from '../components/QrInicioSesion.jsx';

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
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  // Sube tras sincronizar o cambiar credenciales, para refrescar la tarjeta de credenciales
  const [versionPortal, setVersionPortal] = useState(0);

  // Acceso en red (conexión desde el teléfono)
  const [red, setRed] = useState(null);
  const [redCargando, setRedCargando] = useState(false);

  // Modo headless de Playwright (solo admin)
  const [headless, setHeadless] = useState(null);
  const [headlessCargando, setHeadlessCargando] = useState(false);

  // Abrir la app al iniciar Windows (cualquier usuario, en la app de escritorio para Windows)
  const [inicioWindows, setInicioWindowsEstado] = useState(null); // { disponible, activo } | null
  const [inicioCargando, setInicioCargando] = useState(false);

  const mostrarError = (texto) => { setMensaje(''); setError(texto); };
  const mostrarMensaje = (texto) => { setError(''); setMensaje(texto); };

  useEffect(() => {
    if (!esPc) return undefined;
    let activo = true;
    getRedInfo()
      .then((info) => { if (activo) setRed(info); })
      .catch((e) => { if (activo) mostrarError(e.message || 'No se pudo consultar el acceso en red.'); });
    return () => { activo = false; };
  }, []);

  useEffect(() => {
    if (!esPc) return undefined;
    let activo = true;
    getAjustes()
      .then((ajustes) => {
        if (!activo) return;
        setHeadless(ajustes.navegadorHeadless);
        setInicioWindowsEstado(ajustes.inicioWindows || null);
      })
      .catch((e) => { if (activo) mostrarError(e.message || 'No se pudieron cargar los ajustes.'); });
    return () => { activo = false; };
  }, [esAdmin]);

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

  const copiarUrl = async () => {
    if (!red?.principal) return;
    try {
      await navigator.clipboard.writeText(red.principal);
      mostrarMensaje('URL copiada.');
    } catch {
      mostrarError('No se pudo copiar la URL. Cópiala manualmente.');
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

  const cambiarInicioWindows = async (activar) => {
    setInicioCargando(true);
    try {
      const { inicioWindows: estado } = await setInicioWindows(activar);
      setInicioWindowsEstado(estado);
      mostrarMensaje(estado.activo
        ? 'La app se abrirá sola al iniciar Windows.'
        : 'La app ya no se abrirá sola al iniciar Windows.');
    } catch (e) {
      mostrarError(e.message || 'No se pudo cambiar el inicio con Windows.');
    } finally {
      setInicioCargando(false);
    }
  };

  return (
    <div className="dash">
      <h2>Ajustes</h2>

      {/* ── Conectar desde el teléfono (solo PC) ── */}
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
            <div className="row" style={{ alignItems: 'center', marginTop: 16 }}>
              <div>
                <p className="big" style={{ fontSize: '1.2rem', margin: 0 }}>{red.principal}</p>
                <button className="btn ghost" onClick={copiarUrl} style={{ marginTop: 10 }}>
                  <Copy size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Copiar URL
                </button>
              </div>
              <QrInicioSesion urlBase={red.principal} />
            </div>
          ) : red ? (
            <p className="muted" style={{ marginTop: 16 }}>Activa el acceso en red para mostrar una URL y un código QR.</p>
          ) : (
            <p className="muted" style={{ marginTop: 16 }}>Cargando configuración de red…</p>
          )}
        </section>
      )}

      {/* ── Extracción automática (components/ExtraccionAutomatica.jsx) ── */}
      <ExtraccionAutomatica onSincronizado={() => setVersionPortal((v) => v + 1)} />

      {/* ── Credenciales del portal (components/CredencialesPortal.jsx, solo PC) ── */}
      {esPc && <CredencialesPortal version={versionPortal} />}

      {/* ── Apariencia ── */}
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

      {/* ── Inicio con Windows (solo en la app instalada) ── */}
      {esPc && inicioWindows?.disponible && (
        <section className="card">
          <div className="row">
            <div>
              <h2>Inicio con Windows</h2>
              <p className="muted">
                La app se abre sola al encender el computador.
              </p>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={inicioWindows.activo} disabled={inicioCargando}
                onChange={(e) => cambiarInicioWindows(e.target.checked)} />
              Abrir al iniciar Windows
            </label>
          </div>
        </section>
      )}

      {/* ── Sincronización: mostrar navegador (admin, solo PC) ── */}
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

      {/* ── Copias de seguridad (components/CopiasSeguridad.jsx) ── */}
      <CopiasSeguridad />

      {mensaje && <p className="msg" role="status">{mensaje}</p>}
      {error && <p className="msg" style={{ color: 'var(--bad)' }} role="alert">{error}</p>}
    </div>
  );
}
