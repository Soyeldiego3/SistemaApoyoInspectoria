import { NavLink } from 'react-router-dom';
import { LayoutGrid, ClipboardCheck, Users, Database } from 'lucide-react';

const tabs = [
  { to: '/', label: 'Inicio', Icon: LayoutGrid, end: true },
  { to: '/auditar', label: 'Auditar', Icon: ClipboardCheck },
  { to: '/alumnos', label: 'Alumnos', Icon: Users },
  { to: '/datos', label: 'Datos', Icon: Database },
];

export default function BottomNav() {
  return (
    <nav className="nav" aria-label="Navegación principal">
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon size={22} /><span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
