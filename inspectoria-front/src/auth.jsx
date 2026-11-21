import { createContext, useContext, useEffect, useState } from 'react';
import { canjearCodigo, cerrarSesion, getCuenta, getToken, login as apiLogin } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [rol, setRol] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [avisoAcceso, setAvisoAcceso] = useState('');

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
    try {
      const cuenta = await getCuenta();
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
    const iniciar = async () => {
      // Si se llegó escaneando el QR del PC, la URL trae ?codigo=…: se canjea por una sesión
      const params = new URLSearchParams(window.location.search);
      const codigo = params.get('codigo');
      if (codigo) {
        // Se borra de la URL antes de usarlo, para que no quede en el historial
        params.delete('codigo');
        const resto = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${resto ? `?${resto}` : ''}${window.location.hash}`);
        try {
          await canjearCodigo(codigo);
        } catch (error) {
          setAvisoAcceso(error.message || 'No se pudo iniciar sesión con el código QR.');
        }
      }
      await refreshCuenta();
    };
    iniciar().catch(() => setCargando(false));
  }, []);

  const ingresar = async (nombre, password) => {
    const data = await apiLogin(nombre, password);
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
      avisoAcceso,
      esAdmin: rol === 'admin',
      ingresar,
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
