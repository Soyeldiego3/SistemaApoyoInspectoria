// Cuadrícula 3x3 que se ilumina celda por celda mientras se procesa algo (inspirada en Grid Loader de SmoothUI)
export default function GridLoader({ pequeno = false }) {
  return (
    <span className={pequeno ? 'gridloader sm' : 'gridloader'} aria-hidden="true">
      {Array.from({ length: 9 }).map((_, i) => <i key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}
    </span>
  );
}
