require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const xlsx = require('xlsx');

const app = express();
app.use(express.json()); 

app.post('/api/descargar-e-importar', async (req, res) => {
  // 1. EXTRAER LAS VARIABLES DEL POST
  const { curso, mes } = req.body;

  // Validamos que realmente se hayan enviado las variables
  if (!curso || !mes) {
    return res.status(400).json({ error: 'Faltan las variables "curso" o "mes".' });
  }

  console.log(`Petición recibida. Curso: ${curso}, Mes: ${mes}`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    // --- LOGIN ---
    await page.goto('http://127.0.0.1:3000');
    await page.locator('#user').fill(process.env.USUARIO);
    await page.locator('#pass').fill(process.env.PASS);
    await page.locator('#loginForm > button').click();
    await page.waitForSelector('#side');

    // --- NAVEGACIÓN ---
    // Asistencia mensual por curso
    const botonExiste = await page.locator('#nav > ul > li:nth-child(2) > div > ul > li:nth-child(1) > div > ul > li:nth-child(5) > button').isVisible();
    if (botonExiste) {
      // asistnecia mensual por curso
        await page.locator('#nav > ul > li:nth-child(2) > div > ul > li:nth-child(1) > div > ul > li:nth-child(5) > button').click();
    } else {
        console.log('El botón no existe, cliqueando el desplegable...');
        await page.locator('#nav > ul > li:nth-child(2) > div > ul > li:nth-child(1) > button').click();
        await page.locator('#nav > ul > li:nth-child(2) > div > ul > li:nth-child(1) > div > ul > li:nth-child(5) > button').click();
    }
    
    // filtrar por curso y mes
    await page.locator('#mCurso').selectOption({ label: curso });
    await page.locator('#mMes').selectOption({ label: mes });
    await page.waitForTimeout(500);

    // Ir a Asistencia Mensual por Curso
    await page.locator('#tbl > table > tbody > tr > td:nth-child(4) > button').click();

    // TODO: Modificar para que guarde guarde en memoria ram y lea directamente desde ahí, sin necesidad de guardar en disco

    // --- Descargar asistencia como exel ---
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#xls').click();
    
    const download = await downloadPromise;
    const rutaGuardado = './Archivos/asistencia_' + curso + '_' + mes + '.xlsx';
    await download.saveAs(rutaGuardado);

    // --- LEER EXCEL ---
    const workbook = xlsx.readFile(rutaGuardado); 
    const sheetName = workbook.SheetNames[0];
    let dataExcel = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // --- BASE DE DATOS ---
    await mandar_todo_al_back(dataExcel);

    res.status(200).json({ 
      mensaje: 'Proceso completado', 
      filtrosAplicados: { curso, mes },
      totalRegistrosProcesados: dataExcel.length 
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await browser.close();
  }
});

async function mandar_todo_al_back(datos) {
  console.log(`Insertando ${datos.length} filas en la base de datos...`);
}

app.listen(3005, () => {
  console.log(`API corriendo en http://localhost:3005`);
});