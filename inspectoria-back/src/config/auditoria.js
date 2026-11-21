module.exports = {
  MIN_DIAS_REGISTRADOS: 5,
  DIAS_TENDENCIA_RECIENTE: 7,
  // Pesos del puntaje: solo ordenan a los alumnos dentro de cada nivel.
  PESO_INASISTENCIA: 3,
  PESO_ATRASO: 1,
  PESO_RACHA_AUSENCIAS: 2,
  PESO_TENDENCIA: 1,
  // Niveles de prioridad (reglas explicables para inspectoría).
  // 85% es la asistencia mínima para la promoción.
  ASISTENCIA_MINIMA: 85,
  ASISTENCIA_ALERTA: 90,
  RACHA_ALTA: 3, // ausencias seguidas sin justificar
  RECIENTES_MEDIA: 3, // incidencias sin justificar en los últimos DIAS_TENDENCIA_RECIENTE días
  ATRASOS_MEDIA: 3, // atrasos sin justificar en el rango
  ATRASOS_ALTA: 5,
};
