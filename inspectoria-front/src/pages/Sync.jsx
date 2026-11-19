import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FileUp, RefreshCw } from 'lucide-react';
import {
  getCredencialesPortal,
  guardarCredencialesPortal,
  iniciarSync,
  olvidarCredencialesPortal,
  probarCredencialesPortal,
} from '../api.js';
import GridLoader from '../components/GridLoader.jsx';
import CredencialesSheet, { MENSAJES_PORTAL } from '../components/CredencialesSheet.jsx';

// RF-01: obtener asistencia por extracción automática (Playwright) o importando CSV/Excel
export default function Sync() {
  const location = useLocation();
  const navigate = useNavigate();
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const [estado, setEstado] = useState('inactivo'); // inactivo | cargando | ok | error
  const [archivo, setArchivo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [mostrarCredenciales, setMostrarCredenciales] = useState(false);
  const [guardadas, setGuardadas] = useState(false);
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
      setCredenciales((actuales) => ({
        ...actuales,
        usuario: info.usuario || actuales.usuario,
        urlPortal: info.urlPortal || actuales.urlPortal,
      }));
    } catch (error) {
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
      setMostrarCredenciales(false);
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
          {esPc && (
            <Link to="/ajustes" className="muted" style={{ display: 'inline-block', marginTop: 10, fontSize: '.85rem' }}>
              Configurar credenciales en Ajustes
            </Link>
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
        <p className="msg" style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }} role="alert">
          {mensaje}
        </p>
      )}

      {mostrarCredenciales && (
        <CredencialesSheet
          accion={accionModal}
          credenciales={credenciales}
          setCredenciales={setCredenciales}
          procesando={procesando}
          mensajeError={estado === 'error' ? mensajeModal : ''}
          guardadas={guardadas}
          passRef={passRef}
          onSubmit={enviarCredenciales}
          onCerrar={() => setMostrarCredenciales(false)}
          onCancelar={cancelarOperacion}
          onOlvidar={olvidar}
        />
      )}
    </>
  );
}