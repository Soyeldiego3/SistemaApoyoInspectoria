# API Extractor de Asistencia (Playwright)

Esta API automatiza el login, la navegación y la extracción de planillas de asistencia en Excel usando Playwright y Node.js. Recibe un curso y un mes, descarga el reporte correspondiente, lo procesa usando `xlsx` y lo prepara para la base de datos.

## Instalación

1. Clona el repositorio.

2. Instala las dependencias necesarias:
   ```bash
   npm install
   npx playwright install chromium

3. Iniciar el servidor web:
   ```bash
   npm start  


# crear usuario en la bd

1. crear archivo ./inspectoria-back/data/inspectoria.db

2. crear usuario usando el comando dentro de ./inspectoria-back/ 
   ```bash 
   npm run usuario -- crear <usuario>


# Modificar moodo headless para Playwright

1. ir a inspectoria-back/src/extractores/

2. modificar en sesion_portal.js 
   ```bash 
   const lanzamiento = chromium.launch({ channel: 'msedge', headless: false }); //modificar a false para ver el navegador en vivo, true para ocultarlo y ejecutar en segundo plano