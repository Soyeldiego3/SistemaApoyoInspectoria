import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { crearUsuario } from '../api.js';

// Crear usuarios de la plataforma (quedan guardados en la base de datos del servidor).
export default function Users() {
  const [nombre, setNombre] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [msg, setMsg] = useState(null); // { ok: boolean, texto: string }
  const [enviando, setEnviando] = useState(false);

  const crear = async (e) => {
    e.preventDefault();
    if (!nombre.trim() || !pass) return setMsg({ ok: false, texto: 'Completa el usuario y la contraseña.' });
    if (pass !== pass2) return setMsg({ ok: false, texto: 'Las contraseñas no coinciden.' });
    setEnviando(true);
    setMsg(null);
    try {
      const u = await crearUsuario(nombre.trim(), pass);
      setMsg({ ok: true, texto: `Usuario "${u.nombre}" creado.` });
      setNombre(''); setPass(''); setPass2('');
    } catch (err) {
      setMsg({ ok: false, texto: err instanceof TypeError ? 'No hay conexión con el servidor local.' : err.message });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="form card" style={{ maxWidth: 480 }} onSubmit={crear}>
      <h2>Nuevo usuario</h2>
      <p className="muted">Podrá ingresar a la plataforma con este usuario y contraseña.</p>
      <div className="field"><label htmlFor="nu">Usuario</label>
        <input id="nu" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" /></div>
      <div className="field"><label htmlFor="np">Contraseña (mínimo 8 caracteres)</label>
        <input id="np" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="np2">Repetir contraseña</label>
        <input id="np2" type="password" className="input" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" /></div>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--ok)' : 'var(--bad)', fontSize: '.9rem' }}>{msg.texto}</p>
      )}
      <button className="btn" disabled={enviando}>
        <UserPlus size={16} style={{ verticalAlign: -3, marginRight: 8 }} />{enviando ? 'Creando…' : 'Crear usuario'}
      </button>
    </form>
  );
}
