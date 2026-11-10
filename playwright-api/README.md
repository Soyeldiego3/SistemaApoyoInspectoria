# API Extractor de Asistencia (Playwright)

Esta API automatiza el login, la navegación y la extracción de planillas de asistencia en Excel usando Playwright y Node.js. Recibe un curso y un mes, descarga el reporte correspondiente, lo procesa usando `xlsx` y lo prepara para la base de datos.

## Instalación

1. Clona el repositorio.

2. Instala las dependencias necesarias:
   ```bash
   npm install
   npx playwright install chromium

3. Crear archivo .env

   USUARIO=
   PASS=

4. Iniciar el servidor web:
   ```bash
   npm start  


## Como usar la API

1. Conectarse a esta url
   .../api/descargar-e-importar

2. usar la siguiente estructura en el body de la consulta tipo post

   {
    "curso": "1°M A",
    "mes": "Octubre"
   }