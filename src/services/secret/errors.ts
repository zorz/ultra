/**
 * Secret Service Errors
 *
 * Error types for secret operations.
 */

/**
 * Secret error codes.
 */
export enum SecretErrorCode {
  /** No writable provider available */
  NO_WRITABLE_PROVIDER = 'NO_WRITABLE_PROVIDER',
  /** Provider not found */
  PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND',
  /** Provider is read-only */
  PROVIDER_READ_ONLY = 'PROVIDER_READ_ONLY',
  /** Secret not found */
  SECRET_NOT_FOUND = 'SECRET_NOT_FOUND',
  /** Secret has expired */
  SECRET_EXPIRED = 'SECRET_EXPIRED',
  /** Keychain access denied */
  KEYCHAIN_ACCESS_DENIED = 'KEYCHAIN_ACCESS_DENIED',
  /** Keychain not available */
  KEYCHAIN_NOT_AVAILABLE = 'KEYCHAIN_NOT_AVAILABLE',
  /** Encryption/decryption failed */
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  /** Invalid secret key format */
  INVALID_KEY = 'INVALID_KEY',
  /** Storage error */
  STORAGE_ERROR = 'STORAGE_ERROR',
}

/**
 * Secret operation error.
 *
 * Thrown when a secret operation fails.
 */
export class SecretError extends Error {
  override readonly name = 'SecretError';

  constructor(
    /** Error code for programmatic handling */
    public readonly code: SecretErrorCode,
    /** Human-readable error message */
    message: string,
    /** Underlying error if any */
    public override readonly cause?: Error
  ) {
    super(message);
    Object.setPrototypeOf(this, SecretError.prototype);
  }

  /**
   * Create a NO_WRITABLE_PROVIDER error.
   */
  static noWritableProvider(): SecretError {
    return new SecretError(
      SecretErrorCode.NO_WRITABLE_PROVIDER,
      'No writable secret provider available'
    );
  }

  /**
   * Create a PROVIDER_NOT_FOUND error.
   */
  static providerNotFound(providerId: string): SecretError {
    return new SecretError(
      SecretErrorCode.PROVIDER_NOT_FOUND,
      `Secret provider not found: ${providerId}`
    );
  }

  /**
   * Create a PROVIDER_READ_ONLY error.
   */
  static providerReadOnly(providerId: string): SecretError {
    return new SecretError(
      SecretErrorCode.PROVIDER_READ_ONLY,
      `Secret provider is read-only: ${providerId}`
    );
  }

  /**
   * Create a SECRET_NOT_FOUND error.
   */
  static secretNotFound(key: string): SecretError {
    return new SecretError(
      SecretErrorCode.SECRET_NOT_FOUND,
      `Secret not found: ${key}`
    );
  }

  /**
   * Create a SECRET_EXPIRED error.
   */
  static secretExpired(key: string): SecretError {
    return new SecretError(
      SecretErrorCode.SECRET_EXPIRED,
      `Secret has expired: ${key}`
    );
  }

  /**
   * Create a KEYCHAIN_ACCESS_DENIED error.
   */
  static keychainAccessDenied(): SecretError {
    return new SecretError(
      SecretErrorCode.KEYCHAIN_ACCESS_DENIED,
      'Access to system keychain was denied'
    );
  }

  /**
   * Create a KEYCHAIN_NOT_AVAILABLE error.
   */
  static keychainNotAvailable(): SecretError {
    return new SecretError(
      SecretErrorCode.KEYCHAIN_NOT_AVAILABLE,
      'System keychain is not available on this platform'
    );
  }

  /**
   * Create an ENCRYPTION_FAILED error.
   */
  static encryptionFailed(operation: 'encrypt' | 'decrypt', cause?: Error): SecretError {
    return new SecretError(
      SecretErrorCode.ENCRYPTION_FAILED,
      `Failed to ${operation} secret`,
      cause
    );
  }

  /**
   * Create an INVALID_KEY error.
   */
  static invalidKey(key: string, reason: string): SecretError {
    return new SecretError(
      SecretErrorCode.INVALID_KEY,
      `Invalid secret key "${key}": ${reason}`
    );
  }

  /**
   * Create a STORAGE_ERROR error.
   */
  static storageError(message: string, cause?: Error): SecretError {
    return new SecretError(
      SecretErrorCode.STORAGE_ERROR,
      message,
      cause
    );
  }

  /**
   * Wrap an unknown error as a SecretError.
   */
  static wrap(error: unknown): SecretError {
    if (error instanceof SecretError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;

    return new SecretError(SecretErrorCode.STORAGE_ERROR, message, cause);
  }
}
