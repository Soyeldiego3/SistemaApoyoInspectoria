import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, FileUp, RefreshCw } from 'lucide-react';
import {
  getCredencialesPortal,
  guardarCredencialesPortal,
  iniciarSync,
  olvidarCredencialesPortal,
  probarCredencialesPortal,
} from '../api.js';
import GridLoader from '../components/GridLoader.jsx';

const MENSAJES_PORTAL = {
  LOGIN_RECHAZADO: 'El portal rechazó el usuario o la contraseña',
  PORTAL_INACCESIBLE: 'No se pudo conectar con el portal; revisa la red o la URL',
  NAVEGADOR_NO_DISPONIBLE: 'No se encontró Microsoft Edge',
  ESTRUCTURA_CAMBIADA: 'El portal cambió y no se pudo extraer la información.',
  CREDENCIALES_REQUERIDAS: 'Las credenciales del portal son necesarias para sincronizar.',
};

// RF-01: obtener asistencia por extracción automática (Playwright) o importando CSV/Excel
export default function Sync() {
  const location = useLocation();
  const navigate = useNavigate();
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const [estado, setEstado] = useState('inactivo'); // inactivo | cargando | ok | error
  const [archivo, setArchivo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [mostrarCredenciales, setMostrarCredenciales] = useState(false);
  const [mostrarPass, setMostrarPass] = useState(false);
  const [guardadas, setGuardadas] = useState(false);
  const [estadoPortal, setEstadoPortal] = useState('cargando');
  const [portal, setPortal] = useState(null);
  const [accionModal, setAccionModal] = useState('sync'); // sync | probar | guardar
  const [procesando, setProcesando] = useState(false);
  const [mensajeModal, setMensajeModal] = useState('');
  const passRef = useRef(null);
  const controllerRef = useRef(null);
  const timeoutRef = useRef(null);
  const [credenciales, setCredenciales] = useState({
    usuario: '', pass: '', urlPortal: '', recordar: false, enMemoria: false,
  });

  const cargarEstadoPortal = async () => {
    if (!esPc) return;
    try {
      const info = await getCredencialesPortal();
      setPortal(info);
      setGuardadas(Boolean(info.guardadas || info.enMemoria));
      setEstadoPortal(info.invalidas ? 'invalidas' : (info.guardadas || info.enMemoria ? 'ok' : 'vacio'));
      setCredenciales((actuales) => ({
        ...actuales,
        usuario: info.usuario || actuales.usuario,
        urlPortal: info.urlPortal || actuales.urlPortal,
      }));
    } catch (error) {
      setEstadoPortal('error');
      setMensaje(error.message);
    }
  };

  useEffect(() => {
    cargarEstadoPortal();
  }, [esPc]);

  useEffect(() => {
    if (location.state?.abrirCredenciales) {
      setMostrarCredenciales(true);
      if (location.state.accionModal) setAccionModal(location.state.accionModal);
      if (location.state.mensaje) {
        setMensaje(location.state.mensaje);
        setEstado('error');
        setMensajeModal(location.state.mensaje);
      }
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    controllerRef.current?.abort();
  }, []);

  const mostrarError = (e) => {
    const codigo = e.code;
    const mensaje = MENSAJES_PORTAL[codigo]
      || (e instanceof TypeError ? 'No hay conexión con el servidor local.' : (e.message || 'Ocurrió un error inesperado.'));
    setMensaje(mensaje);
    setEstado('error');
    setMensajeModal(mensaje);
    setCredenciales((actuales) => ({ ...actuales, pass: '' }));
    if (mostrarCredenciales) {
      setTimeout(() => passRef.current?.focus(), 0);
    }
  };

  const abrirModal = (accion) => {
    setAccionModal(accion);
    setMostrarCredenciales(true);
    setMostrarPass(false);
    setMensaje('');
    setMensajeModal('');
    setProcesando(false);
    setCredenciales((actuales) => ({
      ...actuales,
      usuario: portal?.usuario || actuales.usuario,
      urlPortal: portal?.urlPortal || actuales.urlPortal,
      pass: '',
    }));
  };

  const sincronizar = async (datos) => {
    setEstado('cargando');
    setProcesando(true);
    setMensaje('');
    setMensajeModal('');
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      controllerRef.current?.abort();
      setProcesando(false);
      setEstado('error');
      setMensaje('La operación tardó demasiado. Puedes cancelarla o intentarlo nuevamente.');
      setMensajeModal('La operación tardó demasiado. Puedes cancelarla o intentarlo nuevamente.');
    }, 45000);
    try {
      const data = await iniciarSync(datos, { signal: controllerRef.current.signal });
      const errores = data.errores?.length || 0;
      const detalleErrores = errores ? ` ${errores} cursos tuvieron errores.` : '';
      setMensaje(`Asistencia actualizada: ${data.cursosProcesados} de ${data.totalCursos} cursos, ${data.totalAlumnos} alumnos, ${data.filasAsistencia} registros y ${data.filasAtrasos} atrasos.${detalleErrores}`);
      setEstado(errores ? 'error' : 'ok');
      setMostrarCredenciales(false);
      if (datos?.recordar) setGuardadas(true);
    } catch (e) {
      if (controllerRef.current?.signal.aborted) {
        setMensajeModal('Operación cancelada o detenida por timeout.');
        setMensaje('Operación cancelada o detenida por timeout.');
        setEstado('error');
        setCredenciales((actuales) => ({ ...actuales, pass: '' }));
      } else {
        if (e.code === 'CREDENCIALES_REQUERIDAS' || e.code === 'LOGIN_RECHAZADO') {
          if (esPc) abrirModal('sync');
          setCredenciales((actuales) => ({ ...actuales, pass: '' }));
        }
        mostrarError(e);
      }
    } finally {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setProcesando(false);
      setEstado((actual) => actual === 'cargando' ? 'inactivo' : actual);
    }
  };

  const extraer = async () => {
    setEstado('cargando');
    setMensaje('');
    try {
      const info = await getCredencialesPortal();
      setPortal(info);
      setGuardadas(Boolean(info.guardadas || info.enMemoria));
      if (info.usuario) {
        setCredenciales((actuales) => ({ ...actuales, usuario: info.usuario }));
      }
      if (!info.guardadas && !info.enMemoria) {
        if (esPc) abrirModal('sync');
        setEstado('inactivo');
        return;
      }
      if (info.invalidas) {
        if (esPc) abrirModal('guardar');
        setMensaje('Las credenciales guardadas están inválidas. Actualízalas para sincronizar.');
        setEstado('error');
        return;
      }
      await sincronizar();
    } catch (e) {
      mostrarError(e);
    }
  };

  const enviarCredenciales = async (e) => {
    e.preventDefault();
    if (!credenciales.usuario.trim() || !credenciales.pass) {
      setMensaje('Ingresa el usuario y la contraseña del portal.');
      setEstado('error');
      setMensajeModal('Ingresa el usuario y la contraseña del portal.');
      return;
    }
    const datos = {
      usuario: credenciales.usuario.trim(),
      pass: credenciales.pass,
      urlPortal: credenciales.urlPortal.trim() || undefined,
    };
    if (accionModal === 'probar') {
      setEstado('cargando');
      setProcesando(true);
      setMensajeModal('');
      controllerRef.current?.abort();
      controllerRef.current = new AbortController();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        controllerRef.current?.abort();
      }, 45000);
      try {
        await probarCredencialesPortal(datos, { signal: controllerRef.current.signal });
        setMensaje('Conexión al portal verificada.');
        setEstado('ok');
        setMensajeModal('');
        setMostrarCredenciales(false);
        await cargarEstadoPortal();
      } catch (error) {
        if (controllerRef.current?.signal.aborted) {
          setMensajeModal('Operación cancelada o detenida por timeout.');
          setMensaje('Operación cancelada o detenida por timeout.');
          setEstado('error');
        } else {
          mostrarError(error);
        }
      } finally {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        setProcesando(false);
        setCredenciales((actuales) => ({ ...actuales, pass: '' }));
      }
    } else if (accionModal === 'guardar') {
      setEstado('cargando');
      setProcesando(true);
      setMensajeModal('');
      controllerRef.current?.abort();
      controllerRef.current = new AbortController();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        controllerRef.current?.abort();
      }, 45000);
      try {
        await guardarCredencialesPortal(datos, { signal: controllerRef.current.signal });
        setMensaje('Credenciales guardadas y verificadas.');
        setEstado('ok');
        setMensajeModal('');
        setMostrarCredenciales(false);
        await cargarEstadoPortal();
      } catch (error) {
        if (controllerRef.current?.signal.aborted) {
          setMensajeModal('Operación cancelada o detenida por timeout.');
          setMensaje('Operación cancelada o detenida por timeout.');
          setEstado('error');
        } else {
          mostrarError(error);
        }
      } finally {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        setProcesando(false);
        setCredenciales((actuales) => ({ ...actuales, pass: '' }));
      }
    } else {
      await sincronizar({
        ...datos,
        recordar: credenciales.recordar,
        enMemoria: credenciales.enMemoria,
      });
      setCredenciales((actuales) => ({ ...actuales, pass: '' }));
    }
  };

  const cancelarOperacion = () => {
    controllerRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setProcesando(false);
    setEstado('error');
    setMensajeModal('Operación cancelada.');
    setMensaje('Operación cancelada.');
    setCredenciales((actuales) => ({ ...actuales, pass: '' }));
    setTimeout(() => passRef.current?.focus(), 0);
  };

  const olvidar = async () => {
    if (!window.confirm('¿Olvidar las credenciales guardadas y en memoria?')) return;
    try {
      await olvidarCredencialesPortal();
      setGuardadas(false);
      setPortal(null);
      setEstadoPortal('vacio');
      setCredenciales({ usuario: '', pass: '', urlPortal: '', recordar: false, enMemoria: false });
      setMensaje('Credenciales olvidadas en este equipo.');
      setEstado('ok');
    } catch (e) {
      mostrarError(e);
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
      {esPc && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="row">
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
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost" onClick={() => abrirModal('guardar')}>Modificar</button>
              <button className="btn ghost" onClick={() => abrirModal('probar')}>Probar conexión</button>
              {guardadas && <button className="btn ghost" onClick={olvidar}>Olvidar</button>}
            </div>
          </div>
        </section>
      )}

      <div className="cols2">
        <section className="card">
          <h2>Extracción automática</h2>
          <p className="muted" style={{ margin: '4px 0 14px' }}>Descarga la asistencia de todos los cursos del mes actual.</p>

          <button className={estado === 'cargando' && !mostrarCredenciales ? 'btn sincronizando' : 'btn'} onClick={extraer} disabled={estado === 'cargando'}>
            {estado === 'cargando' && !mostrarCredenciales
              ? <GridLoader pequeno />
              : <RefreshCw size={16} style={{ verticalAlign: -3, marginRight: 8 }} />}
            {estado === 'cargando' ? 'Sincronizando…' : 'Sincronizar todos'}
          </button>
          {estado === 'cargando' && !mostrarCredenciales && (
            <p className="muted" role="status" style={{ marginTop: 10 }}>
              Descargando todos los cursos desde el portal, puede tardar unos segundos.
            </p>
          )}
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

      {mostrarCredenciales && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="portal-title">
          <form className="sheet" onSubmit={enviarCredenciales}>
            <div className="grab" />
            <div className="row">
              <h2 id="portal-title">Credenciales del portal</h2>
              <button type="button" className="iconbtn" onClick={() => {
                if (procesando) cancelarOperacion();
                setMostrarCredenciales(false);
              }} aria-label="Cerrar">×</button>
            </div>
            <p className="muted">
              {accionModal === 'probar' ? 'Comprueba el acceso sin guardar cambios.' :
                accionModal === 'guardar' ? 'Se validarán antes de guardarse.' :
                'Se usan durante la sincronización.'}
            </p>
            <div className="field">
              <label htmlFor="portal-user">Usuario</label>
              <input id="portal-user" className="input" value={credenciales.usuario}
                onChange={(e) => setCredenciales({ ...credenciales, usuario: e.target.value })}
                autoComplete="username" autoFocus />
            </div>
            <div className="field">
              <label htmlFor="portal-pass">Contraseña</label>
              <div style={{ position: 'relative' }}>
                <input id="portal-pass" className="input" type={mostrarPass ? 'text' : 'password'}
                  value={credenciales.pass}
                  ref={passRef}
                  onChange={(e) => setCredenciales({ ...credenciales, pass: e.target.value })}
                  autoComplete="current-password" style={{ paddingRight: 48 }} />
                <button type="button" className="iconbtn" onClick={() => setMostrarPass(!mostrarPass)}
                  aria-label={mostrarPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  style={{ position: 'absolute', right: 12, top: 12 }}>
                  {mostrarPass ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="portal-url">URL del portal</label>
              <input id="portal-url" className="input" type="url" value={credenciales.urlPortal}
                onChange={(e) => setCredenciales({ ...credenciales, urlPortal: e.target.value })}
                placeholder="Usar URL configurada por defecto" />
            </div>
            {accionModal === 'sync' && (
              <>
                <label className="row" style={{ justifyContent: 'flex-start', fontSize: '.85rem' }}>
                  <input type="checkbox" checked={credenciales.recordar}
                    onChange={(e) => setCredenciales({ ...credenciales, recordar: e.target.checked })} />
                  Recordarme en este equipo
                </label>
                {!credenciales.recordar && (
                  <label className="row" style={{ justifyContent: 'flex-start', fontSize: '.85rem' }}>
                    <input type="checkbox" checked={credenciales.enMemoria}
                      onChange={(e) => setCredenciales({ ...credenciales, enMemoria: e.target.checked })} />
                    Mantener en memoria mientras la app esté abierta
                  </label>
                )}
              </>
            )}
            {mensajeModal && estado === 'error' && <p role="alert" style={{ color: 'var(--bad)', fontSize: '.9rem' }}>{mensajeModal}</p>}
            <button className="btn" disabled={procesando}>
              {procesando ? 'Procesando…' :
                accionModal === 'probar' ? 'Probar conexión' :
                accionModal === 'guardar' ? 'Guardar y verificar' : 'Sincronizar'}
            </button>
            {procesando && <button type="button" className="btn ghost" onClick={cancelarOperacion}>Cancelar</button>}
            {guardadas && <button type="button" className="btn ghost" onClick={olvidar}>Olvidar credenciales guardadas</button>}
          </form>
        </div>
      )}
    </>
  );
}