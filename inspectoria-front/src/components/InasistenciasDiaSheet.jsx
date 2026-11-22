import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getInasistenciasDia } from '../api.js';

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
// "2026-11-03" -> "Lun 03-11" (fecha local, sin desfase de zona horaria)
const etiquetaDia = (iso) => {
  const fecha = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return `${DIAS_SEMANA[fecha.getDay()]} ${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
};

// Ventana centrada sobre la página: alumnos que faltaron el día elegido en el calendario.
export default function InasistenciasDiaSheet({ fecha, curso, onCerrar }) {
  const [alumnos, setAlumnos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!fecha) return undefined;
    let activo = true;
    setCargando(true);
    setError('');
    setAlumnos([]);
    getInasistenciasDia({ fecha, curso })
      .then((data) => { if (activo) setAlumnos(data.alumnos); })
      .catch((e) => {
        if (activo) setError(e instanceof TypeError ? 'No hay conexión con el servidor local.' : (e.message || 'No se pudieron cargar las inasistencias del día.'));
      })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [fecha, curso]);

  // Mientras el panel está abierto se bloquea el scroll de la página de fondo y Escape lo cierra.
  // Solo se bloquea <html>: si también se bloquea <body> (que mide 100% de alto), la página salta al inicio.
  // Al cerrar se vuelve a la misma posición por si el navegador la movió.
  useEffect(() => {
    if (!fecha) return undefined;
    const html = document.documentElement;
    const posicion = window.scrollY;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    const teclas = (e) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', teclas);
    return () => {
      html.style.overflow = prev;
      window.scrollTo(0, posicion);
      document.removeEventListener('keydown', teclas);
    };
  }, [fecha, onCerrar]);

  if (!fecha) return null;

  return (
    <div className="overlay centrado" onClick={onCerrar}>
      <div className="sheet modal" role="dialog" aria-modal="true" aria-labelledby="titulo-dia" onClick={(e) => e.stopPropagation()}>
        <h2 id="titulo-dia">Inasistencias del {etiquetaDia(fecha)}</h2>
        {!cargando && !error && (
          <p className="muted">
            {alumnos.length} {alumnos.length === 1 ? 'alumno' : 'alumnos'} · {curso || 'Todos los cursos'}
          </p>
        )}
        {cargando && <p className="muted">Cargando…</p>}
        {error && <p className="msg" role="alert" style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}>{error}</p>}
        {!cargando && !error && (
          alumnos.length ? (
            <div className="list">
              {alumnos.map((a) => (
                <Link key={a.rut} to={`/alumnos/${encodeURIComponent(a.rut)}?vista=inasistencias`}
                  state={{ returnTo: '/graficos', returnLabel: 'Gráficos' }} className="item" style={{ background: 'var(--card-2)' }}>
                  <span><b>{a.nombres} {a.apellidos}</b><span className="muted">{a.curso}</span></span>
                  <span className={`tag ${a.justificado ? 'ok' : 'bad'}`}>{a.justificado ? 'Justificada' : 'Sin justificar'}</span>
                </Link>
              ))}
            </div>
          ) : <p className="muted">No hay inasistencias registradas este día.</p>
        )}
        <button type="button" className="btn ghost" onClick={onCerrar}>Cerrar</button>
      </div>
    </div>
  );
}
