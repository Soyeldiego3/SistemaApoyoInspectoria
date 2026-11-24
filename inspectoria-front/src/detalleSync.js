import { useEffect, useState } from 'react';
import { getTareaSync } from './api.js';

// Mientras hay una sincronización en curso, consulta cada 3 s su avance en el PC
export function useDetalleSync(activo) {
  const [detalle, setDetalle] = useState(null);
  useEffect(() => {
    if (!activo) {
      setDetalle(null);
      return undefined;
    }
    let vigente = true;
    const consultar = () => getTareaSync()
      .then(({ tarea }) => {
        if (vigente) setDetalle(tarea?.estado === 'en_curso' ? tarea.detalle || null : null);
      })
      .catch(() => {});
    const intervalo = setInterval(consultar, 3000);
    consultar();
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [activo]);
  return detalle;
}
