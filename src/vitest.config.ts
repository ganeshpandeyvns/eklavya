import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'core/**/*.test.ts', 'api/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['core/**/*.ts', 'lib/**/*.ts', 'services/**/*.ts', 'api/**/*.ts'],
      exclude: ['tests/**', '**/*.test.ts', '**/*.spec.ts'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
