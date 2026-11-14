import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Audit from './pages/Audit.jsx';
import Students from './pages/Students.jsx';
import StudentDetail from './pages/StudentDetail.jsx';
import Sync from './pages/Sync.jsx';
import Users from './pages/Users.jsx';
import { getToken } from './api.js';

function Protected({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
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
        <Route path="datos" element={<Sync />} />
        <Route path="usuarios" element={<Users />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
