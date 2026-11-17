# inspectoria-api

Servidor Express que lee `data/inspectoria.sqlite` y entrega los datos a la página `public/index.html`. También incluye un panel local de administración en desarrollo.

## Uso
```
npm install
npm start          # http://127.0.0.1:3000
```
Requiere Node 22.13 o superior (usa `node:sqlite`, sin dependencias nativas). Variables opcionales: `PORT`, `HOST`, `DB_FILE`.

Usuario de prueba: `inspector` / `inspectoria`.

## Panel de datos

Con el servidor iniciado, abrir [http://127.0.0.1:3000/panel.html](http://127.0.0.1:3000/panel.html).
La Etapa A del panel permite seleccionar cada tabla, consultar su esquema, buscar registros,
ordenar por columna y recorrer los resultados paginados. El enlace «Ver página scrapeable»
abre `index.html` en otra pestaña para comparar los datos que consume el scraper.

El panel no tiene autenticación y está destinado únicamente a pruebas locales. El servidor
escucha en `127.0.0.1` por defecto; no debe exponerse a una red o usarse en producción.

## Rutas (solo lectura)
| Ruta | Contenido |
|---|---|
| `GET /api/base` | `hoy`, `cursos`, `feriados`, `alumnos` |
| `GET /api/asistencia` | `[rut, fecha, estado]` por alumno y día (P, A o T) |
| `GET /api/atrasos` | `rut, fecha, hora, just` |
| `GET /api/retiros` | `rut, fecha, hora, quien, motivo` |
| `GET /api/reingresos` | `rut, fecha, hora, motivo` |
| `GET /admin/api/tablas` | Tablas administrables y conteo de filas |
| `GET /admin/api/tablas/:tabla/esquema` | Columnas y claves foráneas de una tabla |
| `GET /admin/api/tablas/:tabla?page=&limit=&q=&orden=&dir=` | Listado paginado, búsqueda y orden |
| `POST /admin/api/tablas/:tabla` | Crear un registro |
| `PUT /admin/api/tablas/:tabla` | Editar un registro usando su PK |
| `DELETE /admin/api/tablas/:tabla` | Eliminar un registro usando su PK |
| `POST /admin/api/tablas/:tabla/eliminar-multiple` | Eliminar varias filas seleccionadas |
| `POST /admin/api/tablas/:tabla/masivo` | Generar datos sintéticos con semilla y reporte |
| `POST /admin/api/tablas/:tabla/importar-csv` | Importar CSV con encabezados de columnas |

Abrir `public/index.html` con doble clic no funciona: la página necesita el servidor para obtener los datos.

El botón «Generar registros» incluye atajos para asistencia, alumnos, atrasos, retiros y
reingresos. Para usar Mockaroo u otra herramienta externa, exporta un CSV sintético con
encabezados que coincidan exactamente con las columnas de la tabla y usa «Importar CSV».
No reemplaces manualmente `inspectoria.sqlite`: importa sobre una copia o crea un respaldo
antes de una carga grande.
