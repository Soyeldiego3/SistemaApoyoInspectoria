import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, User, Lock, Eye, EyeOff, Check } from 'lucide-react';
import { getToken, getSetupEstado, crearAdministrador } from '../api.js';
import { useAuth } from '../auth.jsx';
import { esPc } from '../portal.js';

// Autenticación usuario/contraseña (informe 5.2): se valida en el servidor.
export default function Login() {
  const nav = useNavigate();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const { ingresar, ingresarConQr } = useAuth();
  const [requiereAdmin, setRequiereAdmin] = useState(false);
  const [modoSetup, setModoSetup] = useState(false);
  const [adminPass2, setAdminPass2] = useState('');
  // Solo visual: mostrar la contraseña y animación de login correcto (botón verde y salida de la tarjeta)
  const [verPass, setVerPass] = useState(false);
  const [exito, setExito] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const temporizadores = useRef([]);
  useEffect(() => () => temporizadores.current.forEach(clearTimeout), []);

  // QR de "Conectar desde el teléfono": /#/login?qr=<código de un solo uso>
  const [searchParams, setSearchParams] = useSearchParams();
  const codigoQr = searchParams.get('qr');
  const [canjeandoQr, setCanjeandoQr] = useState(Boolean(codigoQr));
  const qrIntentado = useRef(false);

  useEffect(() => {
    if (!esPc) return;
    getSetupEstado()
      .then((estado) => setRequiereAdmin(Boolean(estado.requiereAdmin)))
      .catch(() => setRequiereAdmin(false));
  }, []);

  useEffect(() => {
    if (!codigoQr || qrIntentado.current) return; // el código es de un solo uso: no reintentar
    qrIntentado.current = true;
    setCanjeandoQr(true);
    ingresarConQr(codigoQr)
      .then(() => nav('/', { replace: true }))
      .catch((err) => {
        setError(err instanceof TypeError
          ? 'No se pudo conectar con el PC. Revisa que estés en la misma red.'
          : 'El código QR venció o ya se usó. Escanea el código nuevo del PC.');
        setSearchParams({}, { replace: true }); // el código no queda en la URL ni en el historial
        setCanjeandoQr(false);
      });
  }, [codigoQr]);

  if (canjeandoQr) {
    return (
      <div className="login-pantalla">
        <div className="login-tarjeta" role="status">
          <div className="login-logo"><ShieldCheck size={26} color="#fff" /></div>
          <h1 className="login-titulo">Inspectoría</h1>
          <p className="login-subtitulo">Iniciando sesión…</p>
        </div>
      </div>
    );
  }

  // Si ya hay una sesión iniciada, no se vuelve a mostrar el login
  // (salvo durante la animación de login correcto, que navega al terminar).
  if (getToken() && !codigoQr && !exito) return <Navigate to="/" replace />;

  // El teléfono entra solo con el QR del PC: la contraseña no viaja por la red
  if (!esPc) {
    return (
      <div className="login-pantalla">
        <div className="login-tarjeta">
          <div className="login-encabezado">
            <div className="login-logo"><ShieldCheck size={26} color="#fff" /></div>
            <h1 className="login-titulo">Inspectoría</h1>
            <p className="login-subtitulo">
              Para entrar desde el teléfono, escanea el código QR del PC en Ajustes → Conectar desde el teléfono.
            </p>
          </div>
          {error && <p role="alert" className="login-error">{error}</p>}
        </div>
      </div>
    );
  }

  const enviar = async (e) => {
    e.preventDefault();
    if (!user.trim() || !pass) return setError('Ingresa tu usuario y tu contraseña.');
    setError('');
    setCargando(true);
    try {
      await ingresar(user.trim(), pass);
      // Sin animaciones (prefers-reduced-motion): se entra de inmediato, como antes
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return nav('/', { replace: true });
      setExito(true); // evita el <Navigate> mientras dura la animación
      temporizadores.current.push(setTimeout(() => setSaliendo(true), 400));
      temporizadores.current.push(setTimeout(() => nav('/', { replace: true }), 850));
    } catch (err) {
      // Sin respuesta (TypeError) o error del proxy de Vite (5xx) = backend apagado; el resto son mensajes del servidor.
      const sinServidor = err instanceof TypeError || /^Error de API \(5\d\d\)/.test(err.message);
      setError(sinServidor ? 'No se pudo conectar con el servidor. Revisa que el backend esté encendido.' : err.message);
      setPass('');
      setCargando(false);
    }
  };

  const configurarAdmin = async (e) => {
    e.preventDefault();
    if (!user.trim() || !pass || !adminPass2) return setError('Completa el usuario y ambas contraseñas.');
    if (pass !== adminPass2) return setError('Las contraseñas no coinciden.');
    setError('');
    setCargando(true);
    try {
      await crearAdministrador({ usuario: user.trim(), password: pass, confirmar: adminPass2 });
      setModoSetup(false);
      setRequiereAdmin(false);
      await ingresar(user.trim(), pass);
      nav('/', { replace: true });
    } catch (err) {
      setError(err.message || 'No se pudo crear el administrador.');
    } finally {
      setCargando(false);
      setPass('');
      setAdminPass2('');
    }
  };

  return (
    <div className="login-pantalla">
      <form className={`login-tarjeta${saliendo ? ' saliendo' : ''}`} onSubmit={modoSetup ? configurarAdmin : enviar}>
        <div className="login-encabezado">
          <div className="login-logo"><ShieldCheck size={26} color="#fff" /></div>
          <h1 className="login-titulo">Inspectoría</h1>
          <p className="login-subtitulo">Colegio De La Salle · Sistema de apoyo</p>
          {modoSetup && <p className="login-aviso">Crea la primera cuenta administradora.</p>}
        </div>
        <div className="login-campo"><label htmlFor="u">Usuario</label>
          <div className="login-control">
            <User size={18} className="login-icono" aria-hidden="true" />
            <input id="u" className="login-input" value={user} onChange={(e) => setUser(e.target.value)}
              autoComplete="username" autoFocus placeholder="Tu usuario" disabled={exito} />
          </div>
        </div>
        <div className="login-campo"><label htmlFor="p">Contraseña</label>
          <div className="login-control">
            <Lock size={18} className="login-icono" aria-hidden="true" />
            <input id="p" type={verPass ? 'text' : 'password'} className="login-input" value={pass} onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password" placeholder="••••••••" disabled={exito} />
            <button type="button" className="login-ver" onClick={() => setVerPass((v) => !v)}
              aria-label={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
              {verPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        {modoSetup && (
          <div className="login-campo"><label htmlFor="p2">Confirmar contraseña</label>
            <div className="login-control">
              <Lock size={18} className="login-icono" aria-hidden="true" />
              <input id="p2" type="password" className="login-input" value={adminPass2} onChange={(e) => setAdminPass2(e.target.value)}
                autoComplete="new-password" placeholder="••••••••" />
            </div>
          </div>
        )}
        {error && <p role="alert" className="login-error">{error}</p>}
        <button className={`login-btn${exito ? ' exito' : ''}`} disabled={cargando}>
          {exito
            ? <><Check size={20} className="login-check" aria-hidden="true" />Bienvenido</>
            : cargando
              ? (modoSetup ? 'Creando…' : 'Ingresando…')
              : (modoSetup ? 'Crear administrador' : 'Ingresar')}
        </button>
        {requiereAdmin && esPc && !modoSetup && (
          <button type="button" className="login-btn-secundario" onClick={() => { setModoSetup(true); setError(''); }}>
            Configurar administrador
          </button>
        )}
        <p className="login-pie">Acceso solo para personal autorizado</p>
      </form>
    </div>
  );
}
