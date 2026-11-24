import { createContext, useContext, useEffect, useState } from 'react';
import {
  cerrarSesion, getCuenta, getToken, login as apiLogin, loginConQr as apiLoginConQr,
} from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [rol, setRol] = useState(null);
  const [cargando, setCargando] = useState(true);

  const salir = () => {
    cerrarSesion();
    setUsuario(null);
    setRol(null);
  };

  const refreshCuenta = async () => {
    if (!getToken()) {
      setUsuario(null);
      setRol(null);
      setCargando(false);
      return null;
    }
    const tokenConsultado = getToken();
    try {
      const cuenta = await getCuenta();
      // Si mientras tanto se inició otra sesión (QR del teléfono), esta respuesta ya no vale
      if (getToken() !== tokenConsultado) return null;
      setUsuario(cuenta.usuario);
      setRol(cuenta.rol);
      return cuenta;
    } catch (error) {
      if (error.message?.includes('Sesión') || error.message?.includes('sesión')) salir();
      throw error;
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    refreshCuenta().catch(() => setCargando(false));
  }, []);

  const ingresar = async (nombre, password) => {
    const data = await apiLogin(nombre, password);
    setUsuario(data.usuario);
    setRol(data.rol);
    setCargando(false);
    return data;
  };

  const ingresarConQr = async (codigo) => {
    const data = await apiLoginConQr(codigo);
    setUsuario(data.usuario);
    setRol(data.rol);
    setCargando(false);
    return data;
  };

  return (
    <AuthContext.Provider value={{
      usuario,
      rol,
      cargando,
      esAdmin: rol === 'admin',
      ingresar,
      ingresarConQr,
      salir,
      refreshCuenta,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const contexto = useContext(AuthContext);
  if (!contexto) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return contexto;
}
