import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.ts',
      'src/**/*.{spec,test}.ts',
      'test/**/*.{spec,test}.ts',
    ],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30000,
    passWithNoTests: true,
    exclude: [...configDefaults.exclude, 'test/integration/real-urls.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reportsDirectory: 'coverage',
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
