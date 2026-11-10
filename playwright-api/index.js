require('dotenv').config();
const express = require('express');
const { abrirSesion } = require('./sesion_portal.js');
const { descargarAsistencia } = require('./extraer_asistencia');
const { extraerTablaAtrasos } = require('./extraer_atrasos');
const { parsearAsistencia, abrirDb, guardar } = require('./asistencia');
const { parsearAtrasos, guardarAtrasos } = require('./atrasos');

const app = express();
app.use(express.json());

const db = abrirDb('asistencia.db'); // se abre UNA vez al arrancar el servidor

app.post('/api/descargar-e-importar', async (req, res) => {
  const { curso, mes } = req.body;
  if (!curso || !mes) {
    return res.status(400).json({ error: 'Faltan las variables "curso" o "mes".' });
  }
  console.log(`Petición recibida. Curso: ${curso}, Mes: ${mes}`);

  let sesion;
  try {
    sesion = await abrirSesion();                 // UN solo login para todo el trabajo

    // 1) Asistencia mensual (Excel en memoria)
    const buffer = await descargarAsistencia(sesion.page, curso, mes);
    const data = parsearAsistencia(buffer);
    const filasAsistencia = guardar(db, data);

    // 2) Atrasos (tabla HTML), reutilizando la MISMA sesión
    const mm = String(data.mes).padStart(2, '0');
    const atrasos = parsearAtrasos(await extraerTablaAtrasos(sesion.page));
    const filasAtrasos = guardarAtrasos(db, atrasos, {
      desde: `${data.anio}-${mm}-01`,
      hasta: `${data.anio}-${mm}-31`,             // comparación de texto: sirve para meses de 28-31 días
      curso: data.curso,
    });

    res.status(200).json({
      mensaje: 'Proceso completado',
      filtrosAplicados: { curso, mes },
      totalAlumnos: data.alumnos.length,
      filasAsistencia,
      filasAtrasos,
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await sesion?.cerrar();
  }
});

app.listen(3005, () => {
  console.log('API corriendo en http://localhost:3005');
});