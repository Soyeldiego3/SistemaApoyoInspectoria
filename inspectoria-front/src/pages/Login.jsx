import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getToken, login } from '../api.js';

// Autenticación usuario/contraseña (informe 5.2): se valida en el servidor.
export default function Login() {
  const nav = useNavigate();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // Si ya hay una sesión iniciada, no se vuelve a mostrar el login.
  if (getToken()) return <Navigate to="/" replace />;

  const enviar = async (e) => {
    e.preventDefault();
    if (!user.trim() || !pass) return setError('Ingresa tu usuario y tu contraseña.');
    setError('');
    setCargando(true);
    try {
      await login(user.trim(), pass);
      nav('/', { replace: true });
    } catch (err) {
      // Sin respuesta (TypeError) o error del proxy de Vite (5xx) = backend apagado; el resto son mensajes del servidor.
      const sinServidor = err instanceof TypeError || /^Error de API \(5\d\d\)/.test(err.message);
      setError(sinServidor ? 'No se pudo conectar con el servidor. Revisa que el backend esté encendido.' : err.message);
      setPass('');
      setCargando(false);
    }
  };

  return (
    <div className="app center">
      <form className="form card" onSubmit={enviar}>
        <h1>Inspectoría</h1>
        <p className="muted">Ingresa con tu usuario para continuar.</p>
        <div className="field"><label htmlFor="u">Usuario</label>
          <input id="u" className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoFocus /></div>
        <div className="field"><label htmlFor="p">Contraseña</label>
          <input id="p" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></div>
        {error && <p role="alert" style={{ color: 'var(--bad)', fontSize: '.9rem' }}>{error}</p>}
        <button className="btn" disabled={cargando}>{cargando ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </div>
  );
}
