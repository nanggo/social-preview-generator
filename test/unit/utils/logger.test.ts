import { Logger, LogLevel, logger, logImageFetchError, logMetadataExtractionError } from '../../../src/utils/logger';

// Mock console methods
const mockConsole = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('Logger', () => {
  beforeEach(() => {
    // Reset console mocks
    jest.clearAllMocks();
    
    // Mock console methods
    global.console.debug = mockConsole.debug;
    global.console.info = mockConsole.info;
    global.console.warn = mockConsole.warn;
    global.console.error = mockConsole.error;
  });

  afterEach(() => {
    // Reset logger to default state
    logger.setLevel(LogLevel.WARN);
  });

  describe('Logger singleton', () => {
    it('should return the same instance', () => {
      const logger1 = Logger.getInstance();
      const logger2 = Logger.getInstance();
      expect(logger1).toBe(logger2);
    });

    it('should use the exported logger instance', () => {
      expect(logger).toBe(Logger.getInstance());
    });
  });

  describe('Log levels', () => {
    it('should respect log level filtering', () => {
      logger.setLevel(LogLevel.ERROR);
      
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
      
      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.warn).not.toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });

    it('should log all levels when set to DEBUG', () => {
      logger.setLevel(LogLevel.DEBUG);
      
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
      
      expect(mockConsole.debug).toHaveBeenCalledTimes(1);
      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });

    it('should default to WARN level', () => {
      const newLogger = Logger.getInstance();
      
      newLogger.debug('debug message');
      newLogger.info('info message');
      newLogger.warn('warn message');
      
      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message formatting', () => {
    it('should format messages with timestamp and level', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('test message');
      
      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.info.mock.calls[0][0];
      expect(logCall).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z\] \[INFO\] \[social-preview-generator\] test message/);
    });

    it('should include context in formatted messages', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('test message', {
        operation: 'test-op',
        url: 'https://example.com',
      });
      
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.warn.mock.calls[0][0];
      expect(logCall).toContain('operation=test-op');
      expect(logCall).toContain('url=https://example.com');
    });

    it('should log error details when provided in context', () => {
      const testError = new Error('Test error');
      logger.setLevel(LogLevel.ERROR);
      logger.error('test error message', { error: testError });
      
      expect(mockConsole.error).toHaveBeenCalledTimes(2);
      expect(mockConsole.error.mock.calls[0][0]).toContain('test error message');
      expect(mockConsole.error.mock.calls[1]).toEqual(['Error details:', testError]);
    });
  });

  describe('Convenience functions', () => {
    beforeEach(() => {
      logger.setLevel(LogLevel.WARN);
    });

    it('should log image fetch errors correctly', () => {
      const url = 'https://example.com/image.jpg';
      const error = new Error('Fetch failed');
      
      logImageFetchError(url, error);
      
      expect(mockConsole.warn).toHaveBeenCalledTimes(2);
      expect(mockConsole.warn.mock.calls[0][0]).toContain('Failed to fetch image');
      expect(mockConsole.warn.mock.calls[0][0]).toContain('operation=image-fetch');
      expect(mockConsole.warn.mock.calls[0][0]).toContain(url);
    });

    it('should log metadata extraction errors correctly', () => {
      const url = 'https://example.com';
      const error = new Error('Extraction failed');
      
      logMetadataExtractionError(url, error);
      
      expect(mockConsole.warn).toHaveBeenCalledTimes(2);
      expect(mockConsole.warn.mock.calls[0][0]).toContain('Failed to extract metadata');
      expect(mockConsole.warn.mock.calls[0][0]).toContain('operation=metadata-extraction');
      expect(mockConsole.warn.mock.calls[0][0]).toContain(url);
    });
  });

  describe('Edge cases', () => {
    it('should handle messages without context', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('simple message');
      
      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.info.mock.calls[0][0];
      expect(logCall).toContain('simple message');
      expect(logCall).not.toContain('{');
    });

    it('should handle empty context', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('message with empty context', {});
      
      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.info.mock.calls[0][0];
      expect(logCall).toContain('message with empty context');
      expect(logCall).not.toContain('{');
    });

    it('should handle partial context', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('partial context message', {
        operation: 'test-operation',
        // url is missing
      });
      
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      const logCall = mockConsole.warn.mock.calls[0][0];
      expect(logCall).toContain('operation=test-operation');
      expect(logCall).not.toContain('url=');
    });
  });
});