/**
 * Database Service Errors
 *
 * Error types for database operations.
 */

/**
 * Database error codes.
 */
export enum DatabaseErrorCode {
  /** Connection not found */
  CONNECTION_NOT_FOUND = 'CONNECTION_NOT_FOUND',
  /** Connection already exists */
  CONNECTION_EXISTS = 'CONNECTION_EXISTS',
  /** Failed to connect */
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  /** Connection timeout */
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  /** Not connected */
  NOT_CONNECTED = 'NOT_CONNECTED',
  /** Authentication failed */
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',

  /** Query failed */
  QUERY_FAILED = 'QUERY_FAILED',
  /** Query timeout */
  QUERY_TIMEOUT = 'QUERY_TIMEOUT',
  /** Query cancelled */
  QUERY_CANCELLED = 'QUERY_CANCELLED',
  /** Query not found */
  QUERY_NOT_FOUND = 'QUERY_NOT_FOUND',

  /** Transaction failed */
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',

  /** Read-only mode violation */
  READ_ONLY_VIOLATION = 'READ_ONLY_VIOLATION',

  /** Schema/table not found */
  OBJECT_NOT_FOUND = 'OBJECT_NOT_FOUND',

  /** Invalid configuration */
  INVALID_CONFIG = 'INVALID_CONFIG',

  /** Secret not found */
  SECRET_NOT_FOUND = 'SECRET_NOT_FOUND',

  /** Generic database error */
  DATABASE_ERROR = 'DATABASE_ERROR',
}

/**
 * Database operation error.
 */
export class DatabaseError extends Error {
  override readonly name = 'DatabaseError';

  constructor(
    /** Error code for programmatic handling */
    public readonly code: DatabaseErrorCode,
    /** Human-readable error message */
    message: string,
    /** Connection ID if applicable */
    public readonly connectionId?: string,
    /** Underlying error if any */
    public override readonly cause?: Error
  ) {
    super(message);
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }

  /**
   * Create a CONNECTION_NOT_FOUND error.
   */
  static connectionNotFound(connectionId: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.CONNECTION_NOT_FOUND,
      `Connection not found: ${connectionId}`,
      connectionId
    );
  }

  /**
   * Create a CONNECTION_EXISTS error.
   */
  static connectionExists(connectionId: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.CONNECTION_EXISTS,
      `Connection already exists: ${connectionId}`,
      connectionId
    );
  }

  /**
   * Create a CONNECTION_FAILED error.
   */
  static connectionFailed(connectionId: string, reason: string, cause?: Error): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.CONNECTION_FAILED,
      `Failed to connect: ${reason}`,
      connectionId,
      cause
    );
  }

  /**
   * Create a CONNECTION_TIMEOUT error.
   */
  static connectionTimeout(connectionId: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.CONNECTION_TIMEOUT,
      'Connection timeout',
      connectionId
    );
  }

  /**
   * Create a NOT_CONNECTED error.
   */
  static notConnected(connectionId: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.NOT_CONNECTED,
      'Not connected to database',
      connectionId
    );
  }

  /**
   * Create an AUTHENTICATION_FAILED error.
   */
  static authFailed(connectionId: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.AUTHENTICATION_FAILED,
      'Authentication failed - check username and password',
      connectionId
    );
  }

  /**
   * Create a QUERY_FAILED error.
   */
  static queryFailed(connectionId: string, message: string, cause?: Error): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.QUERY_FAILED,
      message,
      connectionId,
      cause
    );
  }

  /**
   * Create a QUERY_TIMEOUT error.
   */
  static queryTimeout(connectionId: string, queryId: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.QUERY_TIMEOUT,
      `Query timeout: ${queryId}`,
      connectionId
    );
  }

  /**
   * Create a QUERY_CANCELLED error.
   */
  static queryCancelled(connectionId: string, queryId: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.QUERY_CANCELLED,
      `Query cancelled: ${queryId}`,
      connectionId
    );
  }

  /**
   * Create a QUERY_NOT_FOUND error.
   */
  static queryNotFound(queryId: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.QUERY_NOT_FOUND,
      `Query not found: ${queryId}`
    );
  }

  /**
   * Create a TRANSACTION_FAILED error.
   */
  static transactionFailed(connectionId: string, reason: string, cause?: Error): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.TRANSACTION_FAILED,
      `Transaction failed: ${reason}`,
      connectionId,
      cause
    );
  }

  /**
   * Create a READ_ONLY_VIOLATION error.
   */
  static readOnlyViolation(connectionId: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.READ_ONLY_VIOLATION,
      'Cannot execute write operation in read-only mode',
      connectionId
    );
  }

  /**
   * Create an OBJECT_NOT_FOUND error.
   */
  static objectNotFound(connectionId: string, type: string, name: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.OBJECT_NOT_FOUND,
      `${type} not found: ${name}`,
      connectionId
    );
  }

  /**
   * Create an INVALID_CONFIG error.
   */
  static invalidConfig(field: string, reason: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.INVALID_CONFIG,
      `Invalid configuration: ${field} - ${reason}`
    );
  }

  /**
   * Create a SECRET_NOT_FOUND error.
   */
  static secretNotFound(secretKey: string): DatabaseError {
    return new DatabaseError(
      DatabaseErrorCode.SECRET_NOT_FOUND,
      `Password secret not found: ${secretKey}`
    );
  }

  /**
   * Wrap an unknown error as a DatabaseError.
   */
  static wrap(error: unknown, connectionId?: string): DatabaseError {
    if (error instanceof DatabaseError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;

    // Try to detect specific error types from message
    if (message.includes('password authentication failed') || message.includes('SCRAM')) {
      return new DatabaseError(
        DatabaseErrorCode.AUTHENTICATION_FAILED,
        'Authentication failed - check username and password',
        connectionId,
        cause
      );
    }
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return new DatabaseError(
        DatabaseErrorCode.CONNECTION_TIMEOUT,
        'Connection timeout',
        connectionId,
        cause
      );
    }
    if (message.includes('ECONNREFUSED') || message.includes('connection refused')) {
      return new DatabaseError(
        DatabaseErrorCode.CONNECTION_FAILED,
        'Connection refused - check host and port',
        connectionId,
        cause
      );
    }
    if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
      return new DatabaseError(
        DatabaseErrorCode.CONNECTION_FAILED,
        'Host not found - check hostname',
        connectionId,
        cause
      );
    }
    if (message.includes('read-only') || message.includes('cannot execute')) {
      return new DatabaseError(
        DatabaseErrorCode.READ_ONLY_VIOLATION,
        message,
        connectionId,
        cause
      );
    }

    return new DatabaseError(
      DatabaseErrorCode.DATABASE_ERROR,
      message,
      connectionId,
      cause
    );
  }
}
