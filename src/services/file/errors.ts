/**
 * File Service Errors
 *
 * Error types for file operations.
 */

/**
 * Error codes for file operations.
 */
export enum FileErrorCode {
  /** File or directory not found */
  NOT_FOUND = 'FILE_NOT_FOUND',

  /** Permission denied */
  ACCESS_DENIED = 'ACCESS_DENIED',

  /** Attempted file operation on directory */
  IS_DIRECTORY = 'IS_DIRECTORY',

  /** Attempted directory operation on file */
  NOT_DIRECTORY = 'NOT_DIRECTORY',

  /** File or directory already exists */
  ALREADY_EXISTS = 'ALREADY_EXISTS',

  /** Directory is not empty */
  NOT_EMPTY = 'NOT_EMPTY',

  /** Invalid URI format */
  INVALID_URI = 'INVALID_URI',

  /** No provider for URI scheme */
  NO_PROVIDER = 'NO_PROVIDER',

  /** Operation not supported by provider */
  NOT_SUPPORTED = 'NOT_SUPPORTED',

  /** I/O error during operation */
  IO_ERROR = 'IO_ERROR',

  /** Unknown error */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Error thrown by file operations.
 */
export class FileError extends Error {
  constructor(
    /** Error code */
    public readonly code: FileErrorCode,
    /** URI that caused the error */
    public readonly uri: string,
    /** Human-readable message */
    override message: string,
    /** Underlying error, if any */
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = 'FileError';
  }

  /**
   * Create a NOT_FOUND error.
   */
  static notFound(uri: string, message?: string): FileError {
    return new FileError(
      FileErrorCode.NOT_FOUND,
      uri,
      message ?? `File not found: ${uri}`
    );
  }

  /**
   * Create an ACCESS_DENIED error.
   */
  static accessDenied(uri: string, message?: string): FileError {
    return new FileError(
      FileErrorCode.ACCESS_DENIED,
      uri,
      message ?? `Access denied: ${uri}`
    );
  }

  /**
   * Create an IS_DIRECTORY error.
   */
  static isDirectory(uri: string, message?: string): FileError {
    return new FileError(
      FileErrorCode.IS_DIRECTORY,
      uri,
      message ?? `Is a directory: ${uri}`
    );
  }

  /**
   * Create a NOT_DIRECTORY error.
   */
  static notDirectory(uri: string, message?: string): FileError {
    return new FileError(
      FileErrorCode.NOT_DIRECTORY,
      uri,
      message ?? `Not a directory: ${uri}`
    );
  }

  /**
   * Create an ALREADY_EXISTS error.
   */
  static alreadyExists(uri: string, message?: string): FileError {
    return new FileError(
      FileErrorCode.ALREADY_EXISTS,
      uri,
      message ?? `Already exists: ${uri}`
    );
  }

  /**
   * Create a NOT_EMPTY error.
   */
  static notEmpty(uri: string, message?: string): FileError {
    return new FileError(
      FileErrorCode.NOT_EMPTY,
      uri,
      message ?? `Directory not empty: ${uri}`
    );
  }

  /**
   * Create an INVALID_URI error.
   */
  static invalidUri(uri: string, message?: string): FileError {
    return new FileError(
      FileErrorCode.INVALID_URI,
      uri,
      message ?? `Invalid URI: ${uri}`
    );
  }

  /**
   * Create a NO_PROVIDER error.
   */
  static noProvider(uri: string, scheme: string): FileError {
    return new FileError(
      FileErrorCode.NO_PROVIDER,
      uri,
      `No file provider for scheme: ${scheme}`
    );
  }

  /**
   * Create a NOT_SUPPORTED error.
   */
  static notSupported(uri: string, operation: string): FileError {
    return new FileError(
      FileErrorCode.NOT_SUPPORTED,
      uri,
      `Operation not supported: ${operation}`
    );
  }

  /**
   * Create an IO_ERROR.
   */
  static ioError(uri: string, message: string, cause?: Error): FileError {
    return new FileError(
      FileErrorCode.IO_ERROR,
      uri,
      message,
      cause
    );
  }

  /**
   * Create an UNKNOWN error.
   */
  static unknown(uri: string, message: string, cause?: Error): FileError {
    return new FileError(
      FileErrorCode.UNKNOWN,
      uri,
      message,
      cause
    );
  }

  /**
   * Wrap an unknown error as a FileError.
   */
  static wrap(uri: string, error: unknown): FileError {
    if (error instanceof FileError) {
      return error;
    }

    const cause = error instanceof Error ? error : undefined;
    const message = error instanceof Error ? error.message : String(error);

    // Try to detect error type from Node.js error codes
    if (cause && 'code' in cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      switch (code) {
        case 'ENOENT':
          return FileError.notFound(uri, message);
        case 'EACCES':
        case 'EPERM':
          return FileError.accessDenied(uri, message);
        case 'EISDIR':
          return FileError.isDirectory(uri, message);
        case 'ENOTDIR':
          return FileError.notDirectory(uri, message);
        case 'EEXIST':
          return FileError.alreadyExists(uri, message);
        case 'ENOTEMPTY':
          return FileError.notEmpty(uri, message);
      }
    }

    return FileError.unknown(uri, message, cause);
  }
}
