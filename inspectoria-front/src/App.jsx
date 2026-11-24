import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Audit from './pages/Audit.jsx';
import Students from './pages/Students.jsx';
import StudentDetail from './pages/StudentDetail.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import Charts from './pages/Charts.jsx';
import { getToken } from './api.js';
import { useAuth } from './auth.jsx';

function Protected({ children }) {
  const { cargando } = useAuth();
  if (cargando) return null;
  return getToken() ? children : <Navigate to="/login" replace />;
}

function AdminGuard({ children }) {
  const { esAdmin } = useAuth();
  return esAdmin ? children : <Navigate to="/" replace state={{ aviso: 'No tienes permiso para esta acción.' }} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="auditar" element={<Audit />} />
        <Route path="alumnos" element={<Students />} />
        <Route path="alumnos/:rut" element={<StudentDetail />} />
        <Route path="graficos" element={<Charts />} />
        {/* La antigua página Datos: la sincronización está en Ajustes y exportar/importar en Inicio y Alumnos */}
        <Route path="datos" element={<Navigate to="/ajustes" replace />} />
        <Route path="usuarios" element={<AdminGuard><Users /></AdminGuard>} />
        <Route path="ajustes" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
