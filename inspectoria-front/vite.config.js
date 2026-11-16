import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',                          // rutas relativas, necesario con file://
  build: {
    outDir: '../desktop/front-dist',   // salida directa a la carpeta de Electron
    emptyOutDir: true,
  },
});