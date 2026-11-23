import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
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
  const { ingresar } = useAuth();
  const [requiereAdmin, setRequiereAdmin] = useState(false);
  const [modoSetup, setModoSetup] = useState(false);
  const [adminPass2, setAdminPass2] = useState('');

  useEffect(() => {
    if (!esPc) return;
    getSetupEstado()
      .then((estado) => setRequiereAdmin(Boolean(estado.requiereAdmin)))
      .catch(() => setRequiereAdmin(false));
  }, []);

  // Si ya hay una sesión iniciada, no se vuelve a mostrar el login.
  if (getToken()) return <Navigate to="/" replace />;

  const enviar = async (e) => {
    e.preventDefault();
    if (!user.trim() || !pass) return setError('Ingresa tu usuario y tu contraseña.');
    setError('');
    setCargando(true);
    try {
      await ingresar(user.trim(), pass);
      nav('/', { replace: true });
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
    <div className="app center">
      <form className="form card" onSubmit={modoSetup ? configurarAdmin : enviar}>
        <h1>Inspectoría</h1>
        <p className="muted">{modoSetup ? 'Crea la primera cuenta administradora.' : 'Ingresa con tu usuario para continuar.'}</p>
        <div className="field"><label htmlFor="u">Usuario</label>
          <input id="u" className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoFocus /></div>
        <div className="field"><label htmlFor="p">Contraseña</label>
          <input id="p" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></div>
        {modoSetup && (
          <div className="field"><label htmlFor="p2">Confirmar contraseña</label>
            <input id="p2" type="password" className="input" value={adminPass2} onChange={(e) => setAdminPass2(e.target.value)} autoComplete="new-password" /></div>
        )}
        {error && <p role="alert" style={{ color: 'var(--bad)', fontSize: '.9rem' }}>{error}</p>}
        <button className="btn" disabled={cargando}>{cargando
          ? (modoSetup ? 'Creando…' : 'Ingresando…')
          : (modoSetup ? 'Crear administrador' : 'Ingresar')}</button>
        {requiereAdmin && esPc && !modoSetup && (
          <button type="button" className="btn ghost" onClick={() => { setModoSetup(true); setError(''); }}>
            Configurar administrador
          </button>
        )}
      </form>
    </div>
  );
}
