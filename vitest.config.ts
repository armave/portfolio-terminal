import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'worker.test.js']
  },
  server: {
    hmr: {
      protocol: 'ws',
      host: 'localhost',
    }
  }
});
