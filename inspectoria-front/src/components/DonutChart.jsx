import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Skeleton } from './Skeleton.jsx';

// data: [{ name, value, color }]. Vacío => bloque gris.
export default function DonutChart({ data = [] }) {
  if (!data.length) return <Skeleton h={170} />;
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div>
      <div style={{ position: 'relative', height: 170 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={52} outerRadius={78} paddingAngle={3} stroke="none">
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
          <b style={{ fontSize: '1.8rem' }}>{total}</b><span className="muted">total</span>
        </div>
      </div>
      <div className="legend">
        {data.map((d) => <span key={d.name}><i className="dot" style={{ background: d.color }} />{d.name} ({d.value})</span>)}
      </div>
    </div>
  );
}
