import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarRange, RefreshCw } from 'lucide-react';
import {
  getCredencialesPortal,
  getRangoDatos,
  guardarCredencialesPortal,
  iniciarSync,
  olvidarCredencialesPortal,
  probarCredencialesPortal,
} from '../api.js';
import { fechaCorta } from '../fechas.js';
import GridLoader from './GridLoader.jsx';
import CredencialesSheet from './CredencialesSheet.jsx';
import { MENSAJES_PORTAL, esPc, marcarSyncExitosa } from '../portal.js';

// RF-01: obtener asistencia por extracción automática (Playwright). Tarjeta de Ajustes.
// Otras pantallas llegan a Ajustes con state { abrirCredenciales, accionModal, mensaje }
// para abrir aquí el modal de credenciales.
export default function ExtraccionAutomatica({ onSincronizado }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tarjetaRef = useRef(null);
  const [rango, setRango] = useState(null);
  const [estado, setEstado] = useState('inactivo'); // inactivo | cargando | ok | error
  const [mensaje, setMensaje] = useState('');
  const [mostrarCredenciales, setMostrarCredenciales] = useState(false);
  const [guardadas, setGuardadas] = useState(false);
  const [portal, setPortal] = useState(null);
  const [accionModal, setAccionModal] = useState('sync'); // sync | probar | guardar
  const [procesando, setProcesando] = useState(false);
  const [mensajeModal, setMensajeModal] = useState('');
  const passRef = useRef(null);
  // 'mes' = mes actual (lo de siempre) · 'anio' = año escolar completo (marzo a hoy)
  const periodoRef = useRef('mes');
  const [versionDatos, setVersionDatos] = useState(0);
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
  }, []);

  useEffect(() => {
    getRangoDatos().then(setRango).catch(() => setRango(null));
  }, [versionDatos]);

  useEffect(() => {
    if (location.state?.abrirCredenciales || location.state?.mensaje) {
      tarjetaRef.current?.scrollIntoView({ block: 'center' });
    }
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
    const anual = periodoRef.current === 'anio';
    timeoutRef.current = setTimeout(() => {
      controllerRef.current?.abort();
      setProcesando(false);
      setEstado('error');
      setMensaje('La operación tardó demasiado. Puedes cancelarla o intentarlo nuevamente.');
      setMensajeModal('La operación tardó demasiado. Puedes cancelarla o intentarlo nuevamente.');
    }, 600000); // la primera sincronización trae el año escolar (varios meses por curso)
    try {
      const cuerpo = anual ? { ...(datos || {}), periodo: 'anio' } : datos;
      const data = await iniciarSync(cuerpo, { signal: controllerRef.current.signal });
      const errores = data.errores?.length || 0;
      const detalleErrores = errores ? ` ${errores} cursos tuvieron errores.` : '';
      const detalleMeses = data.meses?.length > 1 ? ` Meses: ${data.meses[0]} a ${data.meses.at(-1)}.` : '';
      const detalleAvisos = data.advertencias?.length ? ` ${data.advertencias.length} meses no se pudieron descargar.` : '';
      const segundos = Math.round((data.duracionMs || 0) / 1000);
      const detalleDuracion = data.duracionMs
        ? ` Tardó ${segundos >= 60 ? `${Math.floor(segundos / 60)} min ${segundos % 60} s` : `${segundos} s`}.`
        : '';
      setMensaje(`Asistencia actualizada: ${data.cursosProcesados} de ${data.totalCursos} cursos, ${data.totalAlumnos} alumnos, ${data.filasAsistencia} registros y ${data.filasAtrasos} atrasos.${detalleMeses}${detalleAvisos}${detalleErrores}${detalleDuracion}`);
      setEstado(errores ? 'error' : 'ok');
      // Inicio deja de mostrar "Reintentar" si la sincronización automática había fallado
      if (!errores) marcarSyncExitosa();
      setVersionDatos((v) => v + 1);
      setMostrarCredenciales(false);
      if (datos?.recordar) setGuardadas(true);
      onSincronizado?.();
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

  const extraer = async (periodo = 'mes') => {
    periodoRef.current = periodo;
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
        onSincronizado?.();
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
      // En esta tarjeta el panel se abre en 'guardar' cuando se quería sincronizar (desde Inicio,
      // Auditar, Alumnos o por credenciales inválidas): al guardarlas, se sincroniza solo.
      setEstado('cargando');
      setProcesando(true);
      setMensajeModal('');
      controllerRef.current?.abort();
      controllerRef.current = new AbortController();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        controllerRef.current?.abort();
      }, 45000);
      let guardadasOk = false;
      try {
        await guardarCredencialesPortal(datos, { signal: controllerRef.current.signal });
        guardadasOk = true;
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
      if (guardadasOk) {
        onSincronizado?.(); // refresca la tarjeta "Credenciales del portal"
        await sincronizar(); // mismo período que se pidió (mes, o año escolar)
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
      onSincronizado?.();
    } catch (e) {
      mostrarError(e);
    }
  };

  const sincronizandoFuera = estado === 'cargando' && !mostrarCredenciales;
  // Si los datos no parten en marzo, faltan meses del año escolar (p. ej. para el Master)
  const hoy = new Date();
  const faltanMeses = rango?.desde && Number(rango.desde.slice(5, 7)) > 3 && hoy.getMonth() > 2;

  return (
    <>
      <section className="card sync-card" ref={tarjetaRef}>
        <h2>Extracción automática</h2>
        <p className="muted" style={{ margin: '4px 0 14px' }}>Descarga la asistencia de todos los cursos del mes anterior y el actual.</p>

        <button className={sincronizandoFuera ? 'btn sincronizando' : 'btn'} onClick={() => extraer('mes')} disabled={estado === 'cargando'}>
          {sincronizandoFuera
            ? <GridLoader pequeno />
            : <RefreshCw size={16} style={{ verticalAlign: -3, marginRight: 8 }} />}
          {estado === 'cargando' ? 'Sincronizando…' : 'Sincronizar todos'}
        </button>
        {sincronizandoFuera && (
          <p className="muted" role="status" style={{ marginTop: 10 }}>
            {periodoRef.current === 'anio'
              ? 'Descargando el año escolar de todos los cursos (un archivo por mes); puede tardar varios minutos.'
              : 'Descargando todos los cursos desde el portal, puede tardar unos segundos.'}
          </p>
        )}

        <p className="muted sync-rango">
          <CalendarRange size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {rango?.desde
            ? `Datos cargados: ${fechaCorta(rango.desde)} a ${fechaCorta(rango.hasta)} (${rango.dias} días).`
            : 'Aún no hay asistencia cargada.'}
          {faltanMeses && ' Faltan meses del año escolar.'}
        </p>
        <button type="button" className="linkbtn" disabled={estado === 'cargando'} onClick={() => {
          if (window.confirm('Se descargará la asistencia de marzo a hoy de todos los cursos. Puede tardar varios minutos. ¿Continuar?')) {
            extraer('anio');
          }
        }}>
          Sincronizar año escolar (marzo a hoy)
        </button>

        {estado === 'ok' && <p className="msg" role="status" style={{ marginTop: 12 }}>{mensaje || 'Asistencia actualizada.'}</p>}
        {estado === 'error' && mensaje && (
          <p className="msg error" style={{ marginTop: 12 }} role="alert">
            {mensaje}
          </p>
        )}
      </section>

      {mostrarCredenciales && (
        <CredencialesSheet
          accion={accionModal}
          credenciales={credenciales}
          setCredenciales={setCredenciales}
          procesando={procesando}
          mensajeError={estado === 'error' ? mensajeModal : ''}
          guardadas={guardadas}
          sincronizaAlGuardar
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