/**
 * Session Service Errors
 *
 * Error types for session operations.
 */

/**
 * Session error codes.
 */
export enum SessionErrorCode {
  /** Setting not found */
  SETTING_NOT_FOUND = 'SETTING_NOT_FOUND',
  /** Invalid setting value */
  INVALID_VALUE = 'INVALID_VALUE',
  /** Session not found */
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  /** Session already exists */
  SESSION_EXISTS = 'SESSION_EXISTS',
  /** Failed to save session */
  SAVE_FAILED = 'SAVE_FAILED',
  /** Failed to load session */
  LOAD_FAILED = 'LOAD_FAILED',
  /** Theme not found */
  THEME_NOT_FOUND = 'THEME_NOT_FOUND',
  /** Invalid keybinding */
  INVALID_KEYBINDING = 'INVALID_KEYBINDING',
  /** Configuration directory not accessible */
  CONFIG_DIR_ERROR = 'CONFIG_DIR_ERROR',
  /** Not initialized */
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  /** Generic error */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Session operation error.
 *
 * Thrown when a session operation fails.
 */
export class SessionError extends Error {
  override readonly name = 'SessionError';

  constructor(
    /** Error code for programmatic handling */
    public readonly code: SessionErrorCode,
    /** Human-readable error message */
    message: string,
    /** Additional context data */
    public readonly data?: unknown,
    /** Underlying error if any */
    public override readonly cause?: Error
  ) {
    super(message);
    Object.setPrototypeOf(this, SessionError.prototype);
  }

  /**
   * Create a SETTING_NOT_FOUND error.
   */
  static settingNotFound(key: string): SessionError {
    return new SessionError(
      SessionErrorCode.SETTING_NOT_FOUND,
      `Setting not found: ${key}`,
      { key }
    );
  }

  /**
   * Create an INVALID_VALUE error.
   */
  static invalidValue(key: string, value: unknown, reason: string): SessionError {
    return new SessionError(
      SessionErrorCode.INVALID_VALUE,
      `Invalid value for setting '${key}': ${reason}`,
      { key, value, reason }
    );
  }

  /**
   * Create a SESSION_NOT_FOUND error.
   */
  static sessionNotFound(sessionId: string): SessionError {
    return new SessionError(
      SessionErrorCode.SESSION_NOT_FOUND,
      `Session not found: ${sessionId}`,
      { sessionId }
    );
  }

  /**
   * Create a SAVE_FAILED error.
   */
  static saveFailed(sessionId: string, reason: string): SessionError {
    return new SessionError(
      SessionErrorCode.SAVE_FAILED,
      `Failed to save session '${sessionId}': ${reason}`,
      { sessionId, reason }
    );
  }

  /**
   * Create a LOAD_FAILED error.
   */
  static loadFailed(sessionId: string, reason: string): SessionError {
    return new SessionError(
      SessionErrorCode.LOAD_FAILED,
      `Failed to load session '${sessionId}': ${reason}`,
      { sessionId, reason }
    );
  }

  /**
   * Create a THEME_NOT_FOUND error.
   */
  static themeNotFound(themeId: string): SessionError {
    return new SessionError(
      SessionErrorCode.THEME_NOT_FOUND,
      `Theme not found: ${themeId}`,
      { themeId }
    );
  }

  /**
   * Create an INVALID_KEYBINDING error.
   */
  static invalidKeybinding(key: string, reason: string): SessionError {
    return new SessionError(
      SessionErrorCode.INVALID_KEYBINDING,
      `Invalid keybinding '${key}': ${reason}`,
      { key, reason }
    );
  }

  /**
   * Create a NOT_INITIALIZED error.
   */
  static notInitialized(): SessionError {
    return new SessionError(
      SessionErrorCode.NOT_INITIALIZED,
      'Session service not initialized'
    );
  }

  /**
   * Wrap an unknown error as a SessionError.
   */
  static wrap(error: unknown): SessionError {
    if (error instanceof SessionError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;

    return new SessionError(SessionErrorCode.UNKNOWN, message, undefined, cause);
  }
}
