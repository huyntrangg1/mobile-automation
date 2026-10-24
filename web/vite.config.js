import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:5178', '/files': 'http://localhost:5178' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
