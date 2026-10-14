# inspectoria-api

Servidor Express mínimo que lee `data/inspectoria.sqlite` y entrega los datos a la página `public/index.html`.

## Uso
```
npm install
npm start          # http://127.0.0.1:3000
```
Requiere Node 22.13 o superior (usa `node:sqlite`, sin dependencias nativas). Variables opcionales: `PORT`, `HOST`, `DB_FILE`.

Usuario de prueba: `inspector` / `inspectoria`.

## Rutas (solo lectura)
| Ruta | Contenido |
|---|---|
| `GET /api/base` | `hoy`, `cursos`, `feriados`, `alumnos` |
| `GET /api/asistencia` | `[rut, fecha, estado]` por alumno y día (P, A o T) |
| `GET /api/atrasos` | `rut, fecha, hora, just` |
| `GET /api/retiros` | `rut, fecha, hora, quien, motivo` |
| `GET /api/reingresos` | `rut, fecha, hora, motivo` |

Abrir `public/index.html` con doble clic no funciona: la página necesita el servidor para obtener los datos.
