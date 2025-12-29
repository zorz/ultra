/**
 * Error Handling Infrastructure
 *
 * Unified error handling for the Ultra editor.
 * Provides typed errors, error codes, and centralized handling.
 *
 * Features:
 * - Custom error classes with codes and context
 * - Recoverable vs. critical error distinction
 * - Centralized error handler with callbacks
 * - Status bar and dialog integration points
 *
 * @example
 * // Throwing a typed error
 * throw new FileError(
 *   'File not found: config.json',
 *   ErrorCodes.FILE_NOT_FOUND,
 *   { path: 'config.json' }
 * );
 *
 * @example
 * // Using the error handler
 * try {
 *   await saveDocument(doc);
 * } catch (error) {
 *   errorHandler.handle(error);
 * }
 *
 * @example
 * // Registering custom handler
 * errorHandler.onError(ErrorCodes.LSP_CONNECTION_FAILED, (error) => {
 *   showNotification('LSP server disconnected. Attempting reconnect...');
 *   lspManager.reconnect();
 * });
 */

import { debugLog } from '../debug.ts';

/**
 * Error codes for the Ultra editor
 */
export const ErrorCodes = {
  // General
  UNKNOWN: 'UNKNOWN',
  OPERATION_CANCELLED: 'OPERATION_CANCELLED',

  // File operations
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_ALREADY_EXISTS: 'FILE_ALREADY_EXISTS',
  FILE_SAVE_FAILED: 'FILE_SAVE_FAILED',
  FILE_READ_FAILED: 'FILE_READ_FAILED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  DIRECTORY_NOT_FOUND: 'DIRECTORY_NOT_FOUND',
  DIRECTORY_NOT_EMPTY: 'DIRECTORY_NOT_EMPTY',

  // Git operations
  GIT_NOT_INITIALIZED: 'GIT_NOT_INITIALIZED',
  GIT_OPERATION_FAILED: 'GIT_OPERATION_FAILED',
  GIT_CONFLICT: 'GIT_CONFLICT',
  GIT_REMOTE_FAILED: 'GIT_REMOTE_FAILED',
  GIT_UNCOMMITTED_CHANGES: 'GIT_UNCOMMITTED_CHANGES',

  // LSP operations
  LSP_CONNECTION_FAILED: 'LSP_CONNECTION_FAILED',
  LSP_REQUEST_TIMEOUT: 'LSP_REQUEST_TIMEOUT',
  LSP_SERVER_ERROR: 'LSP_SERVER_ERROR',
  LSP_NOT_SUPPORTED: 'LSP_NOT_SUPPORTED',

  // Theme/Config
  THEME_LOAD_FAILED: 'THEME_LOAD_FAILED',
  THEME_NOT_FOUND: 'THEME_NOT_FOUND',
  CONFIG_PARSE_FAILED: 'CONFIG_PARSE_FAILED',
  CONFIG_INVALID: 'CONFIG_INVALID',

  // Editor operations
  BUFFER_OVERFLOW: 'BUFFER_OVERFLOW',
  INVALID_POSITION: 'INVALID_POSITION',
  INVALID_RANGE: 'INVALID_RANGE',
  UNDO_STACK_EMPTY: 'UNDO_STACK_EMPTY',
  REDO_STACK_EMPTY: 'REDO_STACK_EMPTY',

  // UI/Render
  RENDER_FAILED: 'RENDER_FAILED',
  TERMINAL_ERROR: 'TERMINAL_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Context information for errors
 */
export interface ErrorContext {
  /** File path if relevant */
  path?: string;
  /** Line number if relevant */
  line?: number;
  /** Column number if relevant */
  column?: number;
  /** Operation that failed */
  operation?: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Base application error class
 *
 * All Ultra errors extend from this class.
 */
export class UltraError extends Error {
  /** Error code for programmatic handling */
  readonly code: ErrorCode;
  /** Whether the error is recoverable (show in status bar) vs critical (show dialog) */
  readonly recoverable: boolean;
  /** Additional context about the error */
  readonly context?: ErrorContext;
  /** Original error if this wraps another error */
  override readonly cause?: Error;
  /** Timestamp when error occurred */
  readonly timestamp: number;

  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.UNKNOWN,
    options: {
      recoverable?: boolean;
      context?: ErrorContext;
      cause?: Error;
    } = {}
  ) {
    super(message);
    (this as { name: string }).name = 'UltraError';
    this.code = code;
    this.recoverable = options.recoverable ?? true;
    this.context = options.context;
    this.cause = options.cause;
    this.timestamp = Date.now();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UltraError);
    }
  }

  /**
   * Create a string representation with context
   */
  override toString(): string {
    let str = `[${this.code}] ${this.message}`;
    if (this.context?.path) {
      str += ` (${this.context.path})`;
    }
    return str;
  }

  /**
   * Convert to a plain object for logging/serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * File operation errors
 */
export class FileError extends UltraError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.FILE_READ_FAILED,
    context?: ErrorContext
  ) {
    super(message, code, { recoverable: true, context });
    (this as { name: string }).name = 'FileError';
  }
}

/**
 * Git operation errors
 */
export class GitError extends UltraError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.GIT_OPERATION_FAILED,
    context?: ErrorContext
  ) {
    super(message, code, { recoverable: true, context });
    (this as { name: string }).name = 'GitError';
  }
}

/**
 * LSP-related errors
 */
export class LSPError extends UltraError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.LSP_SERVER_ERROR,
    context?: ErrorContext
  ) {
    super(message, code, { recoverable: true, context });
    (this as { name: string }).name = 'LSPError';
  }
}

/**
 * Configuration/Theme errors
 */
export class ConfigError extends UltraError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.CONFIG_INVALID,
    context?: ErrorContext
  ) {
    super(message, code, { recoverable: true, context });
    (this as { name: string }).name = 'ConfigError';
  }
}

/**
 * Editor operation errors (typically programming errors)
 */
export class EditorError extends UltraError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.UNKNOWN,
    context?: ErrorContext
  ) {
    super(message, code, { recoverable: false, context });
    (this as { name: string }).name = 'EditorError';
  }
}

/**
 * Error handler callback type
 */
export type ErrorHandlerCallback = (error: UltraError) => void;

/**
 * Callbacks for displaying errors to the user
 */
export interface ErrorDisplayCallbacks {
  /** Show message in status bar */
  showStatusMessage?: (message: string, isError?: boolean) => void;
  /** Show error dialog for critical errors */
  showErrorDialog?: (error: UltraError) => void;
  /** Log to debug output */
  logDebug?: (message: string) => void;
}

/**
 * Centralized error handler service
 *
 * Provides a single point for handling all application errors
 * with support for custom handlers per error code.
 */
export class ErrorHandler {
  private handlers = new Map<ErrorCode, ErrorHandlerCallback[]>();
  private globalHandlers: ErrorHandlerCallback[] = [];
  private displayCallbacks: ErrorDisplayCallbacks = {};
  private errorLog: UltraError[] = [];
  private maxLogSize = 100;

  /**
   * Set display callbacks for showing errors to users
   */
  setDisplayCallbacks(callbacks: ErrorDisplayCallbacks): void {
    this.displayCallbacks = callbacks;
  }

  /**
   * Handle an error
   *
   * Converts regular errors to UltraError and routes to appropriate handlers.
   *
   * @param error - Error to handle
   * @param context - Additional context to add
   */
  handle(error: Error | UltraError, context?: ErrorContext): void {
    // Convert to UltraError if needed
    const ultraError = error instanceof UltraError
      ? error
      : new UltraError(error.message, ErrorCodes.UNKNOWN, {
          recoverable: true,
          context,
          cause: error,
        });

    // Add to log
    this.addToLog(ultraError);

    // Log to debug
    this.logError(ultraError);

    // Call specific handlers for this error code
    const codeHandlers = this.handlers.get(ultraError.code);
    if (codeHandlers && codeHandlers.length > 0) {
      for (const handler of codeHandlers) {
        try {
          handler(ultraError);
        } catch (e) {
          debugLog(`[ErrorHandler] Handler threw: ${e}`);
        }
      }
      return; // Don't show default UI if custom handler exists
    }

    // Call global handlers
    for (const handler of this.globalHandlers) {
      try {
        handler(ultraError);
      } catch (e) {
        debugLog(`[ErrorHandler] Global handler threw: ${e}`);
      }
    }

    // Default UI handling
    if (ultraError.recoverable) {
      this.displayCallbacks.showStatusMessage?.(
        `Error: ${ultraError.message}`,
        true
      );
    } else {
      this.displayCallbacks.showErrorDialog?.(ultraError);
    }
  }

  /**
   * Register handler for specific error code
   *
   * @param code - Error code to handle
   * @param handler - Callback function
   * @returns Unsubscribe function
   */
  onError(code: ErrorCode, handler: ErrorHandlerCallback): () => void {
    if (!this.handlers.has(code)) {
      this.handlers.set(code, []);
    }
    this.handlers.get(code)!.push(handler);

    return () => {
      const handlers = this.handlers.get(code);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Register global error handler (called for all errors)
   *
   * @param handler - Callback function
   * @returns Unsubscribe function
   */
  onAnyError(handler: ErrorHandlerCallback): () => void {
    this.globalHandlers.push(handler);

    return () => {
      const index = this.globalHandlers.indexOf(handler);
      if (index !== -1) {
        this.globalHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Get recent errors from the log
   *
   * @param count - Maximum number of errors to return
   * @returns Array of recent errors
   */
  getRecentErrors(count: number = 10): UltraError[] {
    return this.errorLog.slice(-count);
  }

  /**
   * Get errors by code
   *
   * @param code - Error code to filter by
   * @returns Array of matching errors
   */
  getErrorsByCode(code: ErrorCode): UltraError[] {
    return this.errorLog.filter(e => e.code === code);
  }

  /**
   * Clear the error log
   */
  clearLog(): void {
    this.errorLog = [];
  }

  /**
   * Wrap a function to automatically handle errors
   *
   * @param fn - Function to wrap
   * @param context - Context to add to any errors
   * @returns Wrapped function
   */
  wrap<T extends (...args: unknown[]) => unknown>(
    fn: T,
    context?: ErrorContext
  ): T {
    return ((...args: unknown[]) => {
      try {
        const result = fn(...args);
        if (result instanceof Promise) {
          return result.catch((error: Error) => {
            this.handle(error, context);
            throw error;
          });
        }
        return result;
      } catch (error) {
        this.handle(error as Error, context);
        throw error;
      }
    }) as T;
  }

  /**
   * Create an error-boundary style wrapper for async operations
   *
   * @param fn - Async function to execute
   * @param context - Context for any errors
   * @returns Result or undefined if error occurred
   */
  async tryAsync<T>(
    fn: () => Promise<T>,
    context?: ErrorContext
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      this.handle(error as Error, context);
      return undefined;
    }
  }

  /**
   * Create an error-boundary style wrapper for sync operations
   *
   * @param fn - Function to execute
   * @param context - Context for any errors
   * @returns Result or undefined if error occurred
   */
  trySync<T>(fn: () => T, context?: ErrorContext): T | undefined {
    try {
      return fn();
    } catch (error) {
      this.handle(error as Error, context);
      return undefined;
    }
  }

  private addToLog(error: UltraError): void {
    this.errorLog.push(error);
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }
  }

  private logError(error: UltraError): void {
    const message = `[Error] ${error.code}: ${error.message}`;
    this.displayCallbacks.logDebug?.(message);

    // Also log to debug log in development
    if (process.env.NODE_ENV !== 'production') {
      debugLog(`${error.toString()} ${JSON.stringify(error.context)}`);
    }
  }
}

/**
 * Singleton error handler instance
 */
export const errorHandler = new ErrorHandler();

/**
 * Helper to create file errors with common patterns
 */
export const FileErrors = {
  notFound(path: string): FileError {
    return new FileError(
      `File not found: ${path}`,
      ErrorCodes.FILE_NOT_FOUND,
      { path }
    );
  },

  accessDenied(path: string): FileError {
    return new FileError(
      `Access denied: ${path}`,
      ErrorCodes.FILE_ACCESS_DENIED,
      { path }
    );
  },

  saveFailed(path: string, reason?: string): FileError {
    const message = reason
      ? `Failed to save ${path}: ${reason}`
      : `Failed to save ${path}`;
    return new FileError(message, ErrorCodes.FILE_SAVE_FAILED, { path });
  },

  tooLarge(path: string, size: number): FileError {
    return new FileError(
      `File too large: ${path} (${Math.round(size / 1024 / 1024)}MB)`,
      ErrorCodes.FILE_TOO_LARGE,
      { path, details: { size } }
    );
  },
};

/**
 * Helper to create git errors with common patterns
 */
export const GitErrors = {
  notInitialized(): GitError {
    return new GitError(
      'Git repository not initialized',
      ErrorCodes.GIT_NOT_INITIALIZED
    );
  },

  operationFailed(operation: string, reason?: string): GitError {
    const message = reason
      ? `Git ${operation} failed: ${reason}`
      : `Git ${operation} failed`;
    return new GitError(message, ErrorCodes.GIT_OPERATION_FAILED, { operation });
  },

  conflict(files: string[]): GitError {
    return new GitError(
      `Merge conflict in ${files.length} file(s)`,
      ErrorCodes.GIT_CONFLICT,
      { details: { files } }
    );
  },
};

/**
 * Helper to create LSP errors with common patterns
 */
export const LSPErrors = {
  connectionFailed(server: string): LSPError {
    return new LSPError(
      `Failed to connect to ${server} language server`,
      ErrorCodes.LSP_CONNECTION_FAILED,
      { details: { server } }
    );
  },

  timeout(request: string): LSPError {
    return new LSPError(
      `LSP request timed out: ${request}`,
      ErrorCodes.LSP_REQUEST_TIMEOUT,
      { operation: request }
    );
  },

  serverError(message: string): LSPError {
    return new LSPError(message, ErrorCodes.LSP_SERVER_ERROR);
  },
};

export default errorHandler;
