import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, LabelList, ResponsiveContainer } from 'recharts';
import { Skeleton } from './Skeleton.jsx';
import { useTema } from '../tema.jsx';

// data: [{ dia, <dataKey> }]. Vacío => bloque gris.
// color: nombre de un color del tema (accent, ok, warn, bad), así cambia con el modo y la paleta.
// ejeX: campo de la categoría (por defecto "dia"; en Gráficos también "curso").
// horizontal: barras acostadas, una fila por categoría. valores: muestra el número sin pasar el mouse.
// sufijo: texto tras el número (ej. "%").
// resaltado: valor de ejeX que conserva su color; las demás barras quedan en gris de fondo.
// onElegir: al hacer clic en una barra recibe su valor de ejeX.
export default function BarsChart({
  data = [], dataKey = 'atrasos', color = 'accent', ejeX = 'dia',
  horizontal = false, valores = false, sufijo = '', resaltado = '', onElegir,
}) {
  const { colores } = useTema();
  if (!data.length) return <Skeleton h={160} />;
  const alto = horizontal ? Math.max(160, data.length * 30 + 16) : 160;
  const estiloEje = { stroke: colores.muted, tickLine: false, axisLine: false, fontSize: 12 };
  return (
    <div style={{ height: alto }}>
      <ResponsiveContainer>
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: valores && !horizontal ? 20 : 8, right: valores && horizontal ? 40 : 0, left: 0, bottom: 0 }}>
          {/* Recharts no busca ejes dentro de fragmentos: van como elementos sueltos */}
          {horizontal && <XAxis type="number" hide />}
          {horizontal
            ? <YAxis type="category" dataKey={ejeX} width={56} {...estiloEje} />
            : <XAxis dataKey={ejeX} {...estiloEje} />}
          <Tooltip cursor={{ fill: colores.hover }} contentStyle={{ background: colores['card-2'], border: 0, borderRadius: 10 }} />
          <Bar dataKey={dataKey} fill={colores[color]} radius={horizontal ? [0, 8, 8, 0] : [8, 8, 0, 0]}
            onClick={onElegir ? (barra) => onElegir(barra.payload?.[ejeX] ?? barra[ejeX]) : undefined} style={onElegir ? { cursor: 'pointer' } : undefined}>
            {resaltado && data.map((fila) => (
              fila[ejeX] === resaltado
                ? <Cell key={fila[ejeX]} fill={colores[color]} />
                : <Cell key={fila[ejeX]} fill={colores.muted} fillOpacity={0.3} />
            ))}
            {valores && (
              <LabelList dataKey={dataKey} position={horizontal ? 'right' : 'top'} fill={colores.muted} fontSize={12}
                formatter={(v) => `${v}${sufijo}`} />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
