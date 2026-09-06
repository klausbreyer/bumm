import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/bumm/' : '/',
  plugins: [tailwindcss()],
  worker: { format: 'es' },
}));
