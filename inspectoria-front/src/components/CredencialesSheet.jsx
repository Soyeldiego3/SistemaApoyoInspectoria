import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// Panel con el formulario de credenciales del portal.
// accion: 'sync' (sincronizar con estas credenciales) | 'probar' | 'guardar'
// sincronizaAlGuardar: en 'guardar', después de guardarlas se sincroniza (tarjeta de sincronización)
export default function CredencialesSheet({
  accion, credenciales, setCredenciales, procesando, mensajeError, guardadas, passRef,
  sincronizaAlGuardar = false, onSubmit, onCerrar, onCancelar, onOlvidar,
}) {
  const [mostrarPass, setMostrarPass] = useState(false);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="portal-title">
      <form className="sheet" onSubmit={onSubmit}>
        <div className="grab" />
        <div className="row">
          <h2 id="portal-title">Credenciales del portal</h2>
          <button type="button" className="iconbtn" onClick={() => {
            if (procesando) onCancelar();
            onCerrar();
          }} aria-label="Cerrar">×</button>
        </div>
        <p className="muted">
          {accion === 'probar' ? 'Comprueba el acceso sin guardar cambios.' :
            accion === 'guardar' ? (sincronizaAlGuardar
              ? 'Se validarán, se guardarán y luego se descargarán los datos.'
              : 'Se validarán antes de guardarse.') :
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
        {accion === 'sync' && (
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
        {mensajeError && <p role="alert" style={{ color: 'var(--bad)', fontSize: '.9rem' }}>{mensajeError}</p>}
        <button className="btn" disabled={procesando}>
          {procesando ? 'Procesando…' :
            accion === 'probar' ? 'Probar conexión' :
            accion === 'guardar' ? (sincronizaAlGuardar ? 'Guardar y sincronizar' : 'Guardar y verificar') :
            'Sincronizar'}
        </button>
        {procesando && <button type="button" className="btn ghost" onClick={onCancelar}>Cancelar</button>}
        {guardadas && <button type="button" className="btn ghost" onClick={onOlvidar}>Olvidar credenciales guardadas</button>}
      </form>
    </div>
  );
}
