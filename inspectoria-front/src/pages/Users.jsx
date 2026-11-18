import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { crearUsuario, editarUsuario, eliminarUsuario, getUsuarios } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Users() {
  const { usuario: usuarioActual } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [nombre, setNombre] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [rol, setRol] = useState('inspector');
  const [activo, setActivo] = useState(true);
  const [editando, setEditando] = useState(null);
  const [msg, setMsg] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = async () => {
    try {
      const data = await getUsuarios();
      setUsuarios(data.usuarios || []);
    } catch (err) {
      setMsg({ ok: false, texto: err.code === 'SIN_PERMISO' ? 'No tienes permiso para esta acción.' : err.message });
    }
  };

  useEffect(() => { cargar(); }, []);

  const limpiar = () => {
    setNombre('');
    setPass('');
    setPass2('');
    setRol('inspector');
    setActivo(true);
    setEditando(null);
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) return setMsg({ ok: false, texto: 'Completa el nombre de usuario.' });
    if (!editando && (!pass || pass !== pass2)) return setMsg({ ok: false, texto: 'Completa y confirma la contraseña.' });
    setEnviando(true);
    setMsg(null);
    try {
      if (editando) {
        const cambios = { nombre: nombre.trim(), rol, activo };
        if (pass) cambios.password = pass;
        await editarUsuario(editando.nombre, cambios);
        setMsg({ ok: true, texto: 'Usuario actualizado.' });
      } else {
        await crearUsuario(nombre.trim(), pass, rol, activo);
        setMsg({ ok: true, texto: `Usuario "${nombre.trim()}" creado.` });
      }
      limpiar();
      await cargar();
    } catch (err) {
      setMsg({
        ok: false,
        texto: err.code === 'SIN_PERMISO'
          ? 'No tienes permiso para esta acción.'
          : err.code === 'ULTIMO_ADMIN'
            ? 'No puedes desactivar, degradar o eliminar al último administrador activo.'
            : err.message,
      });
    } finally {
      setEnviando(false);
    }
  };

  const editar = (usuario) => {
    setEditando(usuario);
    setNombre(usuario.nombre);
    setRol(usuario.rol);
    setActivo(usuario.activo);
    setPass('');
    setPass2('');
    setMsg(null);
  };

  const eliminar = async (usuario) => {
    if (!window.confirm(`¿Eliminar al usuario "${usuario.nombre}"?`)) return;
    try {
      await eliminarUsuario(usuario.nombre);
      setMsg({ ok: true, texto: 'Usuario eliminado.' });
      if (editando?.nombre === usuario.nombre) limpiar();
      await cargar();
    } catch (err) {
      setMsg({
        ok: false,
        texto: err.code === 'ULTIMO_ADMIN'
          ? 'No puedes desactivar, degradar o eliminar al último administrador activo.'
          : err.code === 'SIN_PERMISO'
            ? 'No tienes permiso para esta acción.'
            : err.message,
      });
    }
  };

  return (
    <div className="cols2">
      <form className="form card" onSubmit={guardar}>
        <h2>{editando ? 'Editar usuario' : 'Nuevo usuario'}</h2>
        <div className="field">
          <label htmlFor="usuario-nombre">Usuario</label>
          <input id="usuario-nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="usuario-rol">Rol</label>
          <select id="usuario-rol" className="input" value={rol} onChange={(e) => setRol(e.target.value)}>
            <option value="inspector">Inspector</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <label className="row" style={{ justifyContent: 'flex-start', fontSize: '.85rem' }}>
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          Usuario activo
        </label>
        <div className="field">
          <label htmlFor="usuario-pass">{editando ? 'Nueva contraseña (opcional)' : 'Contraseña (mínimo 8 caracteres)'}</label>
          <input id="usuario-pass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </div>
        {editando ? null : (
          <div className="field">
            <label htmlFor="usuario-pass2">Repetir contraseña</label>
            <input id="usuario-pass2" type="password" className="input" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
          </div>
        )}
        {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--ok)' : 'var(--bad)', fontSize: '.9rem' }}>{msg.texto}</p>}
        <div className="row">
          <button className="btn" disabled={enviando}>{enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear usuario'}</button>
          {editando && <button type="button" className="btn ghost" onClick={limpiar}>Cancelar</button>}
        </div>
      </form>

      <section className="card">
        <h2>Usuarios</h2>
        <div className="list" style={{ marginTop: 12 }}>
          {usuarios.map((usuario) => (
            <div className="item" key={usuario.id}>
              <div>
                <b>{usuario.nombre}</b>
                <span className="muted">{usuario.rol === 'admin' ? 'Administrador' : 'Inspector'} · {usuario.activo ? 'Activo' : 'Inactivo'}</span>
              </div>
              <div className="tags">
                <button type="button" className="btn ghost" style={{ width: 'auto', padding: '8px 10px' }} onClick={() => editar(usuario)}>Editar</button>
                {usuario.nombre !== usuarioActual && (
                  <button type="button" className="btn ghost" style={{ width: 'auto', padding: '8px 10px', color: 'var(--bad)' }} onClick={() => eliminar(usuario)}>Eliminar</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
