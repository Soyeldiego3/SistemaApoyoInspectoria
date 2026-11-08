import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// host: true => accesible desde el smartphone por la red Wi-Fi del colegio
export default defineConfig({ plugins: [react()], server: { host: true } });
