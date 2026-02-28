import { vi } from 'vitest';

// Global test setup
beforeAll(() => {
  // Set timezone to UTC for consistent date testing
  process.env.TZ = 'UTC';
});

afterEach(() => {
  // Clear all mocks after each test
  vi.clearAllMocks();
});

// Timeout is configured in vitest.config.ts via testTimeout: 30000
