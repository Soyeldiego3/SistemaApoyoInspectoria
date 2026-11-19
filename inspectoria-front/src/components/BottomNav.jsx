import { NavLink } from 'react-router-dom';
import { LayoutGrid, ClipboardCheck, Users, Database, UserPlus, Settings } from 'lucide-react';
import { useAuth } from '../auth.jsx';

const tabs = [
  { to: '/', label: 'Inicio', Icon: LayoutGrid, end: true },
  { to: '/auditar', label: 'Auditar', Icon: ClipboardCheck },
  { to: '/alumnos', label: 'Alumnos', Icon: Users },
  { to: '/datos', label: 'Datos', Icon: Database },
  { to: '/usuarios', label: 'Usuarios', Icon: UserPlus },
  // Al fondo del menú lateral; solo desde el PC (sus ajustes requieren loopback)
  { to: '/ajustes', label: 'Ajustes', Icon: Settings, abajo: true },
];

export default function BottomNav() {
  const { esAdmin } = useAuth();
  const esPc = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const visibleTabs = tabs.filter((tab) => {
    if (tab.to === '/usuarios') return esAdmin;
    if (tab.to === '/ajustes') return esPc;
    return true;
  });
  return (
    <nav className="nav" aria-label="Navegación principal">
      {visibleTabs.map(({ to, label, Icon, end, abajo }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) => [isActive ? 'active' : '', abajo ? 'nav-bottom' : ''].join(' ').trim()}>
          <Icon size={22} /><span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
