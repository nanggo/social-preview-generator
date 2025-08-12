/**
 * Simple logging utility for the social preview generator
 */
/* eslint-disable no-console */

export interface LogContext {
  operation?: string;
  url?: string;
  error?: Error;
  metadata?: Record<string, unknown>;
}

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Simple logger implementation
 */
export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.WARN;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    return messageLevelIndex >= currentLevelIndex;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [social-preview-generator]`;

    if (!context) {
      return `${prefix} ${message}`;
    }

    const contextParts: string[] = [];
    if (context.operation) contextParts.push(`operation=${context.operation}`);
    if (context.url) contextParts.push(`url=${context.url}`);

    const contextStr = contextParts.length > 0 ? ` {${contextParts.join(', ')}}` : '';
    return `${prefix} ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage(LogLevel.DEBUG, message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage(LogLevel.INFO, message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, context));
      if (context?.error) {
        console.warn('Error details:', context.error);
      }
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(LogLevel.ERROR, message, context));
      if (context?.error) {
        console.error('Error details:', context.error);
      }
    }
  }
}

/**
 * Default logger instance
 */
export const logger = Logger.getInstance();

/**
 * Convenience functions for common logging patterns
 */
export const logImageFetchError = (url: string, error: Error): void => {
  logger.warn(`Failed to fetch image`, {
    operation: 'image-fetch',
    url,
    error,
  });
};

export const logMetadataExtractionError = (url: string, error: Error): void => {
  logger.warn(`Failed to extract metadata`, {
    operation: 'metadata-extraction',
    url,
    error,
  });
};

export const logTemplateError = (templateName: string, error: Error): void => {
  logger.error(`Template generation failed`, {
    operation: 'template-generation',
    error,
    metadata: { templateName },
  });
};
