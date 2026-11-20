import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    hookTimeout: 120000,
    testTimeout: 120000,
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@cvit/ai': path.resolve(__dirname, './packages/ai/src'),
      '@cvit/auth': path.resolve(__dirname, './packages/auth/src'),
      '@cvit/api-client': path.resolve(__dirname, './packages/api-client/src'),
      '@cvit/lti': path.resolve(__dirname, './packages/lti/src'),
    },
  },
});

