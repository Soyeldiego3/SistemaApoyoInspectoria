import { X } from 'lucide-react';
import { plural } from '../texto.js';

// "N alumnos" + "Limpiar filtros" (Auditoría, igual que en Alumnos)
export default function Contador({ cantidad, singular, pluralTexto, hayFiltros, onLimpiar, accion = null }) {
  return (
    <div className="row muted">
      <span>{plural(cantidad, singular, pluralTexto)}</span>
      <span className="row" style={{ gap: 16 }}>
        {hayFiltros && (
          <button className="linkbtn" type="button" onClick={onLimpiar}><X size={14} /> Limpiar filtros</button>
        )}
        {accion}
      </span>
    </div>
  );
}
