require('dotenv').config();
const express = require('express');
const { abrirSesion } = require('./sesion_portal.js');
const { descargarAsistencia } = require('./extraer_asistencia');
const { extraerTablaAtrasos } = require('./extraer_atrasos');
const { extraerCursos } = require('./extraer_cursos');
const { parsearAsistencia, abrirDb, guardar } = require('./asistencia');
const { parsearAtrasos, guardarAtrasos } = require('./atrasos');

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const app = express();
app.use(express.json());

const db = abrirDb('asistencia.db');
let ocupado = false; // solo un navegador Playwright a la vez
let cursos = [];     // se llena al iniciar

// Abre sesión, ejecuta la tarea y cierra
async function conSesion(tarea) {
  if (ocupado) throw new Error('Ya hay una sincronización en curso.');
  ocupado = true;
  let sesion;
  try {
    sesion = await abrirSesion();
    return await tarea(sesion);
  } finally {
    ocupado = false;
    await sesion?.cerrar();
  }
}

// La misma lógica de antes, para un solo curso
function sincronizarCurso(curso, mes) {
  return conSesion(async (sesion) => {
    const buffer = await descargarAsistencia(sesion.page, curso, mes);
    const data = parsearAsistencia(buffer);
    const filasAsistencia = guardar(db, data);

    const mm = String(data.mes).padStart(2, '0');
    const ultimoDia = new Date(data.anio, data.mes, 0).getDate(); // 28, 30 o 31
    const atrasos = parsearAtrasos(await extraerTablaAtrasos(sesion.page));
    const filasAtrasos = guardarAtrasos(db, atrasos, {
      desde: `${data.anio}-${mm}-01`,
      hasta: `${data.anio}-${mm}-${ultimoDia}`,
      curso: data.curso,
    });

    return { totalAlumnos: data.alumnos.length, filasAsistencia, filasAtrasos };
  });
}

// Re-sincronizar un curso (botón del front)
app.post('/api/descargar-e-importar', async (req, res) => {
  const { curso, mes } = req.body;
  if (!curso || !mes) {
    return res.status(400).json({ error: 'Faltan las variables "curso" o "mes".' });
  }
  console.log(`Petición recibida. Curso: ${curso}, Mes: ${mes}`);
  try {
    res.status(200).json({ mensaje: 'Proceso completado', ...(await sincronizarCurso(curso, mes)) });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Lista de cursos para el selector del front
app.get('/api/cursos', (req, res) => res.json({ cursos }));

// Al iniciar: extrae los cursos y sincroniza uno por uno
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function sincronizacionInicial() {
  const mes = MESES[new Date().getMonth()];
  cursos = await conSesion((sesion) => extraerCursos(sesion.page));
  console.log(`Cursos encontrados: ${cursos.join(', ')}`);

  for (const curso of cursos) {
    try {
      await sincronizarCurso(curso, mes);
      console.log(`OK: ${curso}`);
    } catch (e) {
      console.error(`Falló ${curso}: ${e.message}`); // un error no detiene a los demás
    }
    await esperar(2000); // pausa mínima entre cursos
  }
  console.log('Sincronización inicial terminada.');
}

app.get('/api/alumnos', (req, res) => {
  try {
    const alumnos = db.prepare(`
      SELECT a.rut, a.nombres, a.apellidos, c.nombre AS curso,
        (SELECT COUNT(*) FROM atraso t
          WHERE t.id_matricula = m.id_matricula
            AND t.justificado_portal = 0
            AND NOT EXISTS (SELECT 1 FROM justificativo j
                            WHERE j.rut_alumno = a.rut
                              AND t.fecha BETWEEN j.fecha_inicio AND j.fecha_fin)
        ) AS atrasos,
        (SELECT COUNT(*) FROM asistencia s
          WHERE s.id_matricula = m.id_matricula
            AND s.estado = 'A'
            AND NOT EXISTS (SELECT 1 FROM justificativo j
                            WHERE j.rut_alumno = a.rut
                              AND s.fecha BETWEEN j.fecha_inicio AND j.fecha_fin)
        ) AS pendientes
      FROM alumno a
      JOIN matricula m ON m.rut_alumno = a.rut
      JOIN curso c ON c.id_curso = m.id_curso
      WHERE m.anio = (SELECT MAX(anio) FROM matricula)
      ORDER BY c.nombre, a.apellidos, a.nombres
    `).all();
    res.json({ alumnos });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3005, () => {
  console.log('API corriendo en http://localhost:3005');
  sincronizacionInicial().catch((e) => console.error('Sincronización inicial falló:', e.message));
});