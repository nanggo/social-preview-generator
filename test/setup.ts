import 'jest';

// Global test setup
beforeAll(() => {
  // Set timezone to UTC for consistent date testing
  process.env.TZ = 'UTC';
});

afterEach(() => {
  // Clear all mocks after each test
  jest.clearAllMocks();
});

// Increase timeout for integration tests
jest.setTimeout(30000);