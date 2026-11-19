import { NavLink } from 'react-router-dom';
import { LayoutGrid, ClipboardCheck, Users, Database, UserPlus, Settings } from 'lucide-react';
import { useAuth } from '../auth.jsx';

const tabs = [
  { to: '/', label: 'Inicio', Icon: LayoutGrid, end: true },
  { to: '/auditar', label: 'Auditar', Icon: ClipboardCheck },
  { to: '/alumnos', label: 'Alumnos', Icon: Users },
  { to: '/datos', label: 'Datos', Icon: Database },
  { to: '/usuarios', label: 'Usuarios', Icon: UserPlus },
  // Al fondo del menú lateral. En el teléfono solo muestra Apariencia (lo demás requiere el PC)
  { to: '/ajustes', label: 'Ajustes', Icon: Settings, abajo: true },
];

export default function BottomNav() {
  const { esAdmin } = useAuth();
  const visibleTabs = tabs.filter((tab) => {
    if (tab.to === '/usuarios') return esAdmin;
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
