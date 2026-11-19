import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Skeleton } from './Skeleton.jsx';
import { useTema } from '../tema.jsx';

// data: [{ dia, <dataKey> }]. Vacío => bloque gris.
// color: nombre de un color del tema (accent, ok, warn, bad), así cambia con el modo y la paleta.
export default function BarsChart({ data = [], dataKey = 'atrasos', color = 'accent' }) {
  const { colores } = useTema();
  if (!data.length) return <Skeleton h={160} />;
  return (
    <div style={{ height: 160 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="dia" stroke={colores.muted} tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip cursor={{ fill: colores.hover }} contentStyle={{ background: colores['card-2'], border: 0, borderRadius: 10 }} />
          <Bar dataKey={dataKey} fill={colores[color]} radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
