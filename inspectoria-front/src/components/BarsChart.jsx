import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Skeleton } from './Skeleton.jsx';

// data: [{ dia, <dataKey> }]. Vacío => bloque gris.
export default function BarsChart({ data = [], dataKey = 'atrasos', color = '#0a84ff' }) {
  if (!data.length) return <Skeleton h={160} />;
  return (
    <div style={{ height: 160 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="dia" stroke="#9a9aa0" tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,.05)' }} contentStyle={{ background: '#343438', border: 0, borderRadius: 10 }} />
          <Bar dataKey={dataKey} fill={color} radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
