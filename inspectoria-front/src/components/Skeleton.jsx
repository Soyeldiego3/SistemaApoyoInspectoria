// Bloque gris que marca dónde irán los datos
export function Skeleton({ h = 16, w = '100%' }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

// Estado vacío: filas fantasma + mensaje que dice qué hacer
export function EmptyState({ texto, filas = 3 }) {
  return (
    <div className="list">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="item"><div style={{ flex: 1, display: 'grid', gap: 8 }}>
          <Skeleton h={14} w="55%" /><Skeleton h={10} w="35%" /></div><Skeleton h={22} w={70} /></div>
      ))}
      <p className="muted" style={{ textAlign: 'center', marginTop: 6 }}>{texto}</p>
    </div>
  );
}
