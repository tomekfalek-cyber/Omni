import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
    },
  },
});
