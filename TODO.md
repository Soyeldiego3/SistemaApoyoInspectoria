# TODO — Sistema de Apoyo a Inspectoría

## Pendiente

- Animación de carga al importar datos de alumnos

- Probar más paletas de colores

- Seccion de Graficos (barras, torta, etc.)

- Añadir sección de ajustes: paleta de colores, tamaño de texto, modo claro/oscuro, personalización

- Dejar más explícita la asistencia y los atrasos de los estudiantes (¿separarlos en ventanas distintas?)

- Importar y exportar asistencia y atrasos como Excel

- Reemplazar o agregar la alterativa para el host local de smartphone, usar vercel o railway para hostear temporalmente los datos necesarios en la nube y asi tener acceso remoto desde otra red en caso de que la red institucional tenga restricciones en los usos de puertos. 

- Añadir efecto hover en los botones para seleccionar secciones. (inicio, auditar, alumnos, etc.)

- En auditoria enfocarse en la idea de poder detectar patrones de inasistencia y jusitificaciones. ej: alumno falta siempre el mismo dia, alumno falta mucho, razon multiples certificados medicos. asi poder iniciar alertas en casos especificos y hacer llamados de atención. 


## En progreso

- Arreglar seccion de sincronizacion de inicio.

## Completado

- Añadir un usuario admin y su panel correspondiente

- Comprobar el fallback para iniciar sesión en el portal institucional

- Compatibilidad con Linux

- Creación de roles y lógica de permisos

- Arreglo de gráficos en el dashboard de inicio

- Página "Alumnos" funcionando (incluye filtros)

- Vista/menú para ingresar credenciales de la página institucional (ya no se usa el .env)

- Generar más datos de prueba en la página institucional de prueba

- Eliminar datos de alumnos al terminar el día (se eliminan al cerrar la app)

- Sincronizar al iniciar el programa o la sesión (proceso semiautomático)

- Dejar de mostrar el skeleton cuando no hay datos (parece que está cargando algo)

- Añadir seccion de ajustes: alternar modo headless playwright (solo admin), alternar servidor web para smartphone (no mostrar en vista pequeña para evitar cortar la conexion por accidente)

- Animación de carga al importar datos de alumnos
- El token de sesión guarda el nombre del usuario, no su id. Ver auth.js:25 y sesion.js:9.
