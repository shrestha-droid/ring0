import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  ssr: { noExternal: ['lz-string'] }, // CommonJS; bundle it so the prerender step can import it
  test: { include: ['src/**/*.test.ts'] },
});
