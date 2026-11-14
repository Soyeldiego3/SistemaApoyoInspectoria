import { Outlet, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import BottomNav from '../components/BottomNav.jsx';
import { cerrarSesion } from '../api.js';

// Marco común: cabecera + contenido (Outlet) + menú
export default function AppLayout() {
  const nav = useNavigate();
  const salir = () => { cerrarSesion(); nav('/login', { replace: true }); };
  return (
    <div className="app">
      <header className="topbar">
        <h1>Inspectoría</h1>
        <div className="row" style={{ gap: 10 }}>
          <button className="avatar iconbtn" onClick={salir} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={18} /></button>
          <div className="avatar" aria-label="Perfil">IN</div>
        </div>
      </header>
      <main className="content"><Outlet /></main>
      <BottomNav />
    </div>
  );
}
