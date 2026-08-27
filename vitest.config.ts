import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': src
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./vitest.setup.ts']
  }
});
