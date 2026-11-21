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
  // Alertas de patrones (pestaña "Alertas" de Auditar)
  ALERTAS: {
    // Días de clase con datos necesarios para buscar patrones de calendario
    minDiasRango: 15,
    // Falta siempre el mismo día de la semana
    mismoDia: { minFaltas: 4, minEseDia: 3, proporcion: 0.5, factor: 2, alta: 5 },
    // Faltas pegadas a fines de semana o días sin clases
    finDeSemana: { minFaltas: 3, proporcion: 0.6 },
    // Licencias médicas aprobadas en el rango
    licencias: { minLicencias: 3, minCortas: 2, diasCorta: 1, alta: 5 },
    // Caída reciente de asistencia (puntos porcentuales)
    caida: { diasRecientes: 14, minDiasRecientes: 5, minDiasRango: 20, puntos: 15 },
  },
};
