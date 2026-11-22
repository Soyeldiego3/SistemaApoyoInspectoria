# TODO — Sistema de Apoyo a Inspectoría

## Pendiente

- Comprobar que datos locales se puedan exportar o realizar copias de seguridad para evitar perdida de trabajo

- Imporatar y exportar notas de alertas en auditoria

- Importar y exportar atrasos como Excel

- Reemplazar o agregar la alterativa para el host local de smartphone, usar vercel o railway para hostear temporalmente los datos necesarios en la nube y asi tener acceso remoto desde otra red en caso de que la red institucional tenga restricciones en los usos de puertos. 

- Pasar el inicio de sesion en la url hacia el telefono.

- aparte de mostrat top 5 atrasos. mostrar top 5 de inasistencias. 

- grafico de top curso, etc. 

- busqueda por nombre, rut, etc. de alumnos en auditoria.

- agregar boton de auditar dentro de los detalles del alumno.

## En progreso



## Completado

- Dejar más explícita la asistencia y los atrasos de los estudiantes de la seccion de alumnos: ficha con resumen y pestañas Inasistencias/Atrasos; cada justificativo aplica solo a su tipo

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

- Arreglar seccion de sincronizacion de inicio.

- Probar más paletas de colores

- Añadir sección de ajustes: paleta de colores, tamaño de texto, modo claro/oscuro, personalización

- Añadir efecto hover en los botones para seleccionar secciones. (inicio, auditar, alumnos, etc.)

- Importar y exportar asistencia como Excel

- Aumentado el rango de sincronizacion por defecto. ultimos 2 meses. al consultar datos fuera de rango intenta una sincronizacion nueva. 

- En auditoria enfocarse en la idea de poder detectar patrones de inasistencia y jusitificaciones. ej: alumno falta siempre el mismo dia, alumno falta mucho, razon multiples certificados medicos. asi poder iniciar alertas en casos especificos y hacer llamados de atención. 

- Seccion de Graficos (barras, torta, etc.)

- eliminar hoy, ayer, semana de pestaña auditoria