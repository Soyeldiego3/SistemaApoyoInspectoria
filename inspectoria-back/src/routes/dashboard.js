const express = require('express');
const { abrirDb } = require('../services/asistencia');
const { obtenerIncidentes } = require('../services/incidentes');

const router = express.Router();
let db;

function obtenerDb() {
  if (!db) db = abrirDb();
  return db;
}

function fechaLocal(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

function porcentaje(exitosos, total) {
  return total ? Number((exitosos / total * 100).toFixed(1)) : null;
}

function obtenerDiasSemana(hoy) {
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7));
  const dias = [];

  for (const fecha = new Date(inicio); fecha <= hoy; fecha.setDate(fecha.getDate() + 1)) {
    dias.push({
      fecha: fechaLocal(fecha),
      dia: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][fecha.getDay()],
    });
  }

  return dias;
}

function obtenerReincidenciasPorMes(conexion, anio, hoy) {
  const desde = `${anio}-01-01`;
  const elegibles = new Map(conexion.prepare(`
    SELECT mes, COUNT(*) AS total
    FROM (
      SELECT substr(t.fecha, 1, 7) AS mes, m.rut_alumno
      FROM atraso t
      JOIN matricula m ON m.id_matricula = t.id_matricula
      WHERE t.fecha BETWEEN ? AND ?
        AND t.justificado_portal = 0
        AND NOT EXISTS (
          SELECT 1 FROM justificativo j
          WHERE j.rut_alumno = m.rut_alumno
            AND j.estado_documento = 'APROBADO'
            AND t.fecha BETWEEN j.fecha_inicio AND j.fecha_fin
        )
      GROUP BY substr(t.fecha, 1, 7), m.rut_alumno
      HAVING COUNT(DISTINCT t.id_atraso) >= 3
    )
    GROUP BY mes
    ORDER BY mes
  `).all(desde, hoy).map((fila) => [fila.mes, fila.total]));
  const incidentes = obtenerIncidentes(conexion, { desde, hasta: hoy, tipo: 'atrasos' });
  const porAlumnoMes = new Map();

  for (const incidente of incidentes) {
    if (incidente.justificado) continue;
    const clave = `${incidente.fecha.slice(0, 7)}::${incidente.rut}`;
    porAlumnoMes.set(clave, (porAlumnoMes.get(clave) || 0) + 1);
  }

  const alertas = new Map();
  for (const [clave, total] of porAlumnoMes) {
    if (total < 3) continue;
    const mes = clave.slice(0, 7);
    alertas.set(mes, (alertas.get(mes) || 0) + 1);
  }

  return { elegibles, alertas };
}

router.get('/', (req, res) => {
  try {
    const conexion = obtenerDb();
    const ahora = new Date();
    const hoy = fechaLocal(ahora);
    const anio = hoy.slice(0, 4);
    const mesActual = hoy.slice(0, 7);
    const diasSemana = obtenerDiasSemana(ahora);
    const desdeSemana = diasSemana[0].fecha;

    const conteoAsistencia = conexion.prepare(`
      SELECT
        SUM(CASE WHEN estado = 'P' THEN 1 ELSE 0 END) AS presentes,
        SUM(CASE WHEN estado IN ('A', 'F') THEN 1 ELSE 0 END) AS inasistencias
      FROM asistencia
      WHERE fecha = ?
    `).get(hoy);
    const inasistenciasSemana = conexion.prepare(`
      SELECT COUNT(*) AS total
      FROM asistencia
      WHERE fecha BETWEEN ? AND ? AND estado IN ('A', 'F')
    `).get(desdeSemana, hoy).total;
    const atrasosPorFecha = new Map(conexion.prepare(`
      SELECT fecha, COUNT(*) AS atrasos
      FROM atraso
      WHERE fecha BETWEEN ? AND ?
      GROUP BY fecha
    `).all(desdeSemana, hoy).map((fila) => [fila.fecha, fila.atrasos]));
    const sincronizacionesSemana = new Map(conexion.prepare(`
      SELECT fecha, COUNT(*) AS intentos, SUM(exitosa) AS exitosas
      FROM sync_ejecucion
      WHERE fecha BETWEEN ? AND ?
      GROUP BY fecha
    `).all(desdeSemana, hoy).map((fila) => [fila.fecha, fila]));

    const sincronizaciones = conexion.prepare(`
      SELECT COUNT(*) AS intentos, COALESCE(SUM(exitosa), 0) AS exitosas
      FROM sync_ejecucion
    `).get();
    const sincronizacionesPorDia = conexion.prepare(`
      SELECT fecha, COUNT(*) AS intentos, SUM(exitosa) AS exitosas
      FROM sync_ejecucion
      GROUP BY fecha
      ORDER BY fecha DESC
      LIMIT 7
    `).all().reverse();
    const { elegibles, alertas } = obtenerReincidenciasPorMes(conexion, anio, hoy);
    const totalElegibles = elegibles.get(mesActual) || 0;
    const totalAlertas = alertas.get(mesActual) || 0;
    const rto = conexion.prepare(`
      SELECT AVG(duracion_ms) AS promedio_ms, COUNT(duracion_ms) AS mediciones
      FROM justificativo
    `).get();
    const rtoPorMes = conexion.prepare(`
      SELECT substr(creado_en, 1, 7) AS mes, AVG(duracion_ms) AS promedio_ms
      FROM justificativo
      WHERE duracion_ms IS NOT NULL AND creado_en IS NOT NULL
      GROUP BY substr(creado_en, 1, 7)
      ORDER BY mes
    `).all();
    const valorTse = porcentaje(sincronizaciones.exitosas, sincronizaciones.intentos);
    const valorTadr = porcentaje(totalAlertas, totalElegibles);
    const valorRto = rto.mediciones
      ? Number((rto.promedio_ms / 1000).toFixed(2))
      : null;
    const porcentajeRto = valorRto == null
      ? 0
      : Math.max(0, Math.min(100, 100 - valorRto * 10));

    res.json({
      kpis: {
        tse: {
          valor: valorTse,
          ayuda: sincronizaciones.intentos
            ? `${sincronizaciones.exitosas} de ${sincronizaciones.intentos} intentos · Meta ≥ 95%`
            : 'Sin intentos registrados · Meta ≥ 95%',
        },
        tadr: {
          valor: valorTadr,
          ayuda: totalElegibles
            ? `${totalAlertas} de ${totalElegibles} detectados · Meta 100%`
            : 'Sin alumnos con 3+ atrasos este mes · Meta 100%',
        },
        rto: {
          valor: valorRto,
          pct: porcentajeRto,
          ayuda: rto.mediciones
            ? `${rto.mediciones} justificativos medidos · Meta < 10 s`
            : 'Sin mediciones todavía · Meta < 10 s',
        },
      },
      reincidencias: totalAlertas,
      inasistenciasSemana,
      inasistencias: [
        { name: 'Presentes', value: conteoAsistencia.presentes || 0, color: '#30d19b' },
        { name: 'Inasistencias', value: conteoAsistencia.inasistencias || 0, color: '#ff5a5f' },
      ],
      atrasos: diasSemana.map(({ fecha, dia }) => ({
        dia,
        atrasos: atrasosPorFecha.get(fecha) || 0,
      })),
      sincronizaciones: diasSemana.map(({ fecha, dia }) => {
        const registro = sincronizacionesSemana.get(fecha);
        return {
          dia,
          tse: registro ? porcentaje(registro.exitosas, registro.intentos) : null,
        };
      }),
      graficos: {
        tse: sincronizacionesPorDia.map((fila) => ({
          dia: fila.fecha.slice(5),
          tse: porcentaje(fila.exitosas, fila.intentos),
        })),
        tadr: [...elegibles.entries()].map(([mes, total]) => ({
          dia: mes,
          tadr: porcentaje(alertas.get(mes) || 0, total),
        })),
        rto: rtoPorMes.map((fila) => ({
          dia: fila.mes,
          rto: Number((fila.promedio_ms / 1000).toFixed(2)),
        })),
      },
    });
  } catch (error) {
    console.error('Error al consultar datos del dashboard:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los datos del dashboard.' });
  }
});

module.exports = router;
