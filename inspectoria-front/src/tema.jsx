import { createContext, useContext, useEffect, useState } from 'react';

// Apariencia de la app (Ajustes → Apariencia). Se guarda por dispositivo en el navegador.
const TemaContext = createContext(null);
const CLAVE_TEMA = 'inspectoria.tema';

export const MODOS = [
  { id: 'oscuro', label: 'Oscuro' },
  { id: 'claro', label: 'Claro' },
  { id: 'auto', label: 'Automático' },
];

// "muestra" es solo para el selector; los colores reales están en index.css (data-paleta)
export const PALETAS = [
  { id: 'oficina', label: 'Oficina', muestra: '#4f6d8f' },
  { id: 'azul', label: 'Azul', muestra: '#0a84ff' },
  { id: 'lavanda', label: 'Lavanda', muestra: '#7d6bf0' },
  { id: 'lasalle', label: 'De La Salle', muestra: 'linear-gradient(135deg, #1f4fa3 50%, #ffcc00 50%)' },
];

// Tamaño del texto (accesibilidad). Todo el CSS usa rem, así que basta con escalar <html>.
export const TAMANOS = [
  { id: 'normal', label: 'Normal' },
  { id: 'grande', label: 'Grande' },
  { id: 'muy-grande', label: 'Muy grande' },
];

const POR_DEFECTO = { modo: 'oscuro', paleta: 'oficina', texto: 'normal' };
const CONSULTA_CLARO = '(prefers-color-scheme: light)';

// Si no hay nada guardado (o el navegador no deja leer), se usa Oscuro + Oficina.
export function leerPreferencia() {
  try {
    const guardada = JSON.parse(localStorage.getItem(CLAVE_TEMA));
    return {
      modo: MODOS.some((m) => m.id === guardada?.modo) ? guardada.modo : POR_DEFECTO.modo,
      paleta: PALETAS.some((p) => p.id === guardada?.paleta) ? guardada.paleta : POR_DEFECTO.paleta,
      texto: TAMANOS.some((t) => t.id === guardada?.texto) ? guardada.texto : POR_DEFECTO.texto,
    };
  } catch {
    return { ...POR_DEFECTO };
  }
}

function guardarPreferencia(preferencia) {
  try {
    localStorage.setItem(CLAVE_TEMA, JSON.stringify(preferencia));
  } catch {
    // Sin almacenamiento disponible: el tema dura solo mientras la página esté abierta.
  }
}

// Pone data-modo, data-paleta y data-texto en <html>; "auto" sigue la configuración del sistema.
export function aplicarTema({ modo, paleta, texto = POR_DEFECTO.texto }) {
  const raiz = document.documentElement;
  const sistemaClaro = window.matchMedia?.(CONSULTA_CLARO).matches;
  raiz.dataset.modo = modo === 'auto' ? (sistemaClaro ? 'claro' : 'oscuro') : modo;
  raiz.dataset.paleta = paleta;
  raiz.dataset.texto = texto;
  const fondo = getComputedStyle(raiz).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', fondo);
}

// Los gráficos (SVG de Recharts) necesitan los colores ya resueltos, no var(--...).
function leerColores() {
  const estilo = getComputedStyle(document.documentElement);
  const color = (nombre) => estilo.getPropertyValue(`--${nombre}`).trim();
  return {
    accent: color('accent'),
    ok: color('ok'),
    warn: color('warn'),
    bad: color('bad'),
    muted: color('muted'),
    'card-2': color('card-2'),
    hover: color('hover'),
    'graf-1': color('graf-1'),
    'graf-2': color('graf-2'),
    'graf-3': color('graf-3'),
  };
}

export function TemaProvider({ children }) {
  const [preferencia, setPreferencia] = useState(leerPreferencia);
  const [colores, setColores] = useState(leerColores);

  useEffect(() => {
    const actualizar = () => {
      aplicarTema(preferencia);
      setColores(leerColores());
    };
    actualizar();
    guardarPreferencia(preferencia);
    if (preferencia.modo !== 'auto' || !window.matchMedia) return undefined;
    const consulta = window.matchMedia(CONSULTA_CLARO);
    consulta.addEventListener('change', actualizar);
    return () => consulta.removeEventListener('change', actualizar);
  }, [preferencia]);

  return (
    <TemaContext.Provider value={{
      modo: preferencia.modo,
      paleta: preferencia.paleta,
      texto: preferencia.texto,
      colores,
      cambiarModo: (modo) => setPreferencia((actual) => ({ ...actual, modo })),
      cambiarPaleta: (paleta) => setPreferencia((actual) => ({ ...actual, paleta })),
      cambiarTexto: (texto) => setPreferencia((actual) => ({ ...actual, texto })),
    }}>
      {children}
    </TemaContext.Provider>
  );
}

export function useTema() {
  const contexto = useContext(TemaContext);
  if (!contexto) throw new Error('useTema debe usarse dentro de TemaProvider.');
  return contexto;
}
