import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Autenticación usuario/contraseña (informe 5.2). Por ahora simulada.
export default function Login() {
  const nav = useNavigate();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');

  const enviar = (e) => {
    e.preventDefault();
    if (!user || !pass) return;
    localStorage.setItem('auth', '1'); // TODO: reemplazar por login contra la API
    nav('/', { replace: true });
  };

  return (
    <div className="app center">
      <form className="form card" onSubmit={enviar}>
        <h1>Inspectoría</h1>
        <p className="muted">Ingresa con tu usuario para continuar.</p>
        <div className="field"><label htmlFor="u">Usuario</label>
          <input id="u" className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" /></div>
        <div className="field"><label htmlFor="p">Contraseña</label>
          <input id="p" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></div>
        <button className="btn">Ingresar</button>
      </form>
    </div>
  );
}
