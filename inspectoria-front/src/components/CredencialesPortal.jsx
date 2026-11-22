import { useEffect, useRef, useState } from 'react';
import {
  getCredencialesPortal,
  guardarCredencialesPortal,
  olvidarCredencialesPortal,
  probarCredencialesPortal,
} from '../api.js';
import CredencialesSheet, { MENSAJES_PORTAL } from './CredencialesSheet.jsx';

const TIMEOUT_MS = 45000;
const VACIAS = { usuario: '', pass: '', urlPortal: '', recordar: false, enMemoria: false };

// Tarjeta de Ajustes: estado de las credenciales del portal y acciones Modificar / Probar / Olvidar.
// `version` cambia cuando otra tarjeta (Extracción automática) modifica las credenciales.
export default function CredencialesPortal({ version = 0 }) {
  const [estadoPortal, setEstadoPortal] = useState('cargando'); // cargando | vacio | ok | invalidas | error
  const [portal, setPortal] = useState(null);
  const [modal, setModal] = useState(null); // null | 'guardar' | 'probar'
  const [credenciales, setCredenciales] = useState(VACIAS);
  const [procesando, setProcesando] = useState(false);
  const [mensajeModal, setMensajeModal] = useState('');
  const [aviso, setAviso] = useState(null); // { tipo: 'ok' | 'error', texto }
  const passRef = useRef(null);
  const controllerRef = useRef(null);
  const timeoutRef = useRef(null);

  const guardadas = Boolean(portal?.guardadas || portal?.enMemoria);

  const cargarEstadoPortal = async () => {
    try {
      const info = await getCredencialesPortal();
      setPortal(info);
      setEstadoPortal(info.invalidas ? 'invalidas' : (info.guardadas || info.enMemoria ? 'ok' : 'vacio'));
    } catch (error) {
      setEstadoPortal('error');
      setAviso({ tipo: 'error', texto: error.message || 'No se pudo consultar el estado de las credenciales.' });
    }
  };

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    cargarEstadoPortal();
  }, [version]);

  const limpiarTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  const abrirModal = (accion) => {
    setModal(accion);
    setAviso(null);
    setMensajeModal('');
    setProcesando(false);
    setCredenciales({ ...VACIAS, usuario: portal?.usuario || '', urlPortal: portal?.urlPortal || '' });
  };

  const textoError = (e) => MENSAJES_PORTAL[e.code]
    || (e instanceof TypeError ? 'No hay conexión con el servidor local.' : (e.message || 'Ocurrió un error inesperado.'));

  const enviar = async (e) => {
    e.preventDefault();
    if (!credenciales.usuario.trim() || !credenciales.pass) {
      setMensajeModal('Ingresa el usuario y la contraseña del portal.');
      return;
    }
    const datos = {
      usuario: credenciales.usuario.trim(),
      pass: credenciales.pass,
      urlPortal: credenciales.urlPortal.trim() || undefined,
    };
    setProcesando(true);
    setMensajeModal('');
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    limpiarTimeout();
    timeoutRef.current = setTimeout(() => controllerRef.current?.abort(), TIMEOUT_MS);
    try {
      if (modal === 'probar') {
        await probarCredencialesPortal(datos, { signal: controllerRef.current.signal });
        setAviso({ tipo: 'ok', texto: 'Conexión al portal verificada.' });
      } else {
        await guardarCredencialesPortal(datos, { signal: controllerRef.current.signal });
        setAviso({ tipo: 'ok', texto: 'Credenciales guardadas y verificadas.' });
      }
      setModal(null);
      await cargarEstadoPortal();
    } catch (error) {
      setMensajeModal(controllerRef.current?.signal.aborted
        ? 'Operación cancelada o detenida por timeout.'
        : textoError(error));
      setTimeout(() => passRef.current?.focus(), 0);
    } finally {
      limpiarTimeout();
      setProcesando(false);
      setCredenciales((actuales) => ({ ...actuales, pass: '' }));
    }
  };

  const cancelarOperacion = () => {
    controllerRef.current?.abort();
    limpiarTimeout();
    setProcesando(false);
    setMensajeModal('Operación cancelada.');
    setCredenciales((actuales) => ({ ...actuales, pass: '' }));
  };

  const olvidar = async () => {
    if (!window.confirm('¿Olvidar las credenciales guardadas y en memoria?')) return;
    try {
      await olvidarCredencialesPortal();
      setPortal(null);
      setEstadoPortal('vacio');
      setModal(null);
      setAviso({ tipo: 'ok', texto: 'Credenciales olvidadas en este equipo.' });
    } catch (e) {
      setAviso({ tipo: 'error', texto: textoError(e) });
    }
  };

  return (
    <>
      <section className="card">
        <div>
          <h2>Credenciales del portal</h2>
          {estadoPortal === 'cargando' && <p className="muted">Consultando estado…</p>}
          {estadoPortal === 'vacio' && <p className="muted">No configuradas.</p>}
          {estadoPortal === 'ok' && (
            <p className="muted">
              Configuradas para <strong>{portal?.usuario}</strong>
              {portal?.enMemoria ? ' · solo en memoria' : ''}
            </p>
          )}
          {estadoPortal === 'invalidas' && (
            <p role="alert" style={{ color: 'var(--bad)' }}>
              Las credenciales guardadas están inválidas. Actualízalas para continuar.
            </p>
          )}
          {portal?.urlPortal && <p className="muted">Portal: {portal.urlPortal}</p>}
        </div>
        <div className="portal-acciones">
          <button className="btn" onClick={() => abrirModal('guardar')}>Modificar</button>
          <button className="btn outline" onClick={() => abrirModal('probar')}>Probar conexión</button>
          {guardadas && <button className="btn peligro" onClick={olvidar}>Olvidar</button>}
        </div>
        {aviso && (
          <p className="msg" role={aviso.tipo === 'error' ? 'alert' : 'status'} style={{ marginTop: 14,
            ...(aviso.tipo === 'error' ? { color: 'var(--bad)', background: 'var(--bad-soft)' } : {}) }}>
            {aviso.texto}
          </p>
        )}
      </section>

      {modal && (
        <CredencialesSheet
          accion={modal}
          credenciales={credenciales}
          setCredenciales={setCredenciales}
          procesando={procesando}
          mensajeError={mensajeModal}
          guardadas={guardadas}
          passRef={passRef}
          onSubmit={enviar}
          onCerrar={() => setModal(null)}
          onCancelar={cancelarOperacion}
          onOlvidar={olvidar}
        />
      )}
    </>
  );
}
