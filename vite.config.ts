import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // relative assets: works at / locally and at /ring0/ on GitHub Pages
  plugins: [react()],
  ssr: { noExternal: ['lz-string'] }, // CommonJS; bundle it so the prerender step can import it
  test: { include: ['src/**/*.test.ts'] },
});
