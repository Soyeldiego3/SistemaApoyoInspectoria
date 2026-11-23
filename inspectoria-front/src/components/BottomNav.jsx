import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutGrid, ClipboardCheck, Users, BarChart3, UserPlus, Settings } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { getConteoAlertas } from '../api.js';
import { hayFiltrosAuditar } from '../filtrosAuditar.js';
import { fechaLocal } from '../fechas.js';

const tabs = [
  { to: '/', label: 'Inicio', Icon: LayoutGrid, end: true },
  { to: '/auditar', label: 'Auditar', Icon: ClipboardCheck },
  { to: '/alumnos', label: 'Alumnos', Icon: Users },
  { to: '/graficos', label: 'Gráficos', Icon: BarChart3 },
  { to: '/usuarios', label: 'Usuarios', Icon: UserPlus },
  // Al fondo del menú lateral. Incluye la sincronización con el portal (antes en "Datos")
  { to: '/ajustes', label: 'Ajustes', Icon: Settings, abajo: true },
];

export default function BottomNav() {
  const { esAdmin } = useAuth();
  const { pathname, state } = useLocation();
  // La ficha de un alumno abierta desde Auditoría sigue resaltando "Auditar"
  const desdeAuditoria = pathname.startsWith('/alumnos/') && Boolean(state?.returnTo?.startsWith('/auditar'));
  // Igual con Gráficos: la ficha abierta desde el Top 5 sigue resaltando "Gráficos"
  const desdeGraficos = pathname.startsWith('/alumnos/') && Boolean(state?.returnTo?.startsWith('/graficos'));
  const activa = (to, isActive) => {
    if (to === '/auditar') return isActive || desdeAuditoria;
    if (to === '/graficos') return isActive || desdeGraficos;
    if (to === '/alumnos') return isActive && !desdeAuditoria && !desdeGraficos;
    return isActive;
  };
  // Alertas de patrones nuevas (badge sobre "Auditar"); se refresca al navegar y al gestionar una
  const [alertasNuevas, setAlertasNuevas] = useState(0);
  useEffect(() => {
    let activo = true;
    // Mismo rango que abre el badge: "Este mes"
    const hoy = new Date();
    const cargar = () => getConteoAlertas({ desde: fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fechaLocal(hoy) })
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
