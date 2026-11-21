import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutGrid, ClipboardCheck, Users, BarChart3, Database, UserPlus, Settings } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { getConteoAlertas } from '../api.js';
import { hayFiltrosAuditar } from '../filtrosAuditar.js';

const tabs = [
  { to: '/', label: 'Inicio', Icon: LayoutGrid, end: true },
  { to: '/auditar', label: 'Auditar', Icon: ClipboardCheck },
  { to: '/alumnos', label: 'Alumnos', Icon: Users },
  { to: '/graficos', label: 'Gráficos', Icon: BarChart3 },
  { to: '/datos', label: 'Datos', Icon: Database },
  { to: '/usuarios', label: 'Usuarios', Icon: UserPlus },
  // Al fondo del menú lateral. En el teléfono solo muestra Apariencia (lo demás requiere el PC)
  { to: '/ajustes', label: 'Ajustes', Icon: Settings, abajo: true },
];

export default function BottomNav() {
  const { esAdmin } = useAuth();
  const { pathname, state } = useLocation();
  // La ficha de un alumno abierta desde Auditoría sigue resaltando "Auditar"
  const desdeAuditoria = pathname.startsWith('/alumnos/') && Boolean(state?.returnTo?.startsWith('/auditar'));
  const activa = (to, isActive) => {
    if (to === '/auditar') return isActive || desdeAuditoria;
    if (to === '/alumnos') return isActive && !desdeAuditoria;
    return isActive;
  };
  // Alertas de patrones nuevas (badge sobre "Auditar"); se refresca al navegar y al gestionar una
  const [alertasNuevas, setAlertasNuevas] = useState(0);
  useEffect(() => {
    let activo = true;
    // Mismo rango que abre el badge: "Este mes"
    const hoy = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cargar = () => getConteoAlertas({ desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: iso(hoy) })
      .then((datos) => { if (activo) setAlertasNuevas(datos?.nuevas || 0); })
      .catch(() => {});
    cargar();
    window.addEventListener('alertas-actualizadas', cargar);
    return () => {
      activo = false;
      window.removeEventListener('alertas-actualizadas', cargar);
    };
  }, [pathname]);
  const visibleTabs = tabs.filter((tab) => {
    if (tab.to === '/usuarios') return esAdmin;
    return true;
  });
  return (
    <nav className="nav" aria-label="Navegación principal">
      {visibleTabs.map(({ to, label, Icon, end, abajo }) => (
        <NavLink key={to} to={to === '/auditar' && alertasNuevas && !hayFiltrosAuditar() ? '/auditar?tab=alertas' : to} end={end}
          className={({ isActive }) => [activa(to, isActive) ? 'active' : '', abajo ? 'nav-bottom' : ''].join(' ').trim()}>
          <span className="nav-icono">
            <Icon size={22} />
            {to === '/auditar' && alertasNuevas > 0 && (
              <span className="nav-badge" aria-label={`${alertasNuevas} alertas nuevas`}>
                {alertasNuevas > 99 ? '99+' : alertasNuevas}
              </span>
            )}
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
