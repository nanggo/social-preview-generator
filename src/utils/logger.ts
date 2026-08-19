/**
 * Simple logging utility for the social preview generator
 */
/* eslint-disable no-console */

import { createSafeErrorDetails, getSafeUrlOrigin } from './network-diagnostics';

export interface LogContext {
  operation?: string;
  url?: string;
  origin?: string;
  requestId?: string;
  hostname?: string;
  actualIP?: string;
  cachedIPs?: string[];
  reason?: string;
  blockedIPs?: string[];
  allowedIPs?: string[];
  address?: string;
  family?: number;
  totalAddresses?: number;
  remoteAddress?: string;
  remotePort?: number;
  error?: unknown;
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
    const origin = context.origin ?? getSafeUrlOrigin(context.url);
    if (origin) contextParts.push(`origin=${origin}`);
    if (context.requestId) contextParts.push(`requestId=${context.requestId}`);
    if (context.error) {
      const safeError = createSafeErrorDetails(context.error);
      if (safeError?.name) contextParts.push(`errorName=${safeError.name}`);
      if (safeError?.code) contextParts.push(`errorCode=${safeError.code}`);
      if (safeError?.status !== undefined) contextParts.push(`status=${safeError.status}`);
    }

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
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(LogLevel.ERROR, message, context));
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
