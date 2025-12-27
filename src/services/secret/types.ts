/**
 * Secret Service Types
 *
 * Type definitions for secret/credential management.
 */

/**
 * Options for storing a secret.
 */
export interface SecretOptions {
  /** Optional expiration date */
  expiresAt?: Date;
  /** Human-readable description */
  description?: string;
  /** Force storage to a specific provider */
  provider?: string;
}

/**
 * Information about a stored secret.
 */
export interface SecretInfo {
  /** Secret key */
  key: string;
  /** Provider that stores this secret */
  provider: string;
  /** When the secret was created */
  createdAt?: Date;
  /** When the secret expires (if set) */
  expiresAt?: Date;
  /** Human-readable description */
  description?: string;
}

/**
 * Secret provider interface.
 *
 * Providers implement the actual storage mechanism for secrets.
 * Multiple providers can be registered with different priorities.
 */
export interface SecretProvider {
  /** Unique provider identifier */
  readonly id: string;
  /** Human-readable provider name */
  readonly name: string;
  /** Whether this provider is read-only */
  readonly isReadOnly: boolean;
  /** Whether this provider supports secret expiration */
  readonly supportsExpiry: boolean;
  /** Whether this provider is available on the current platform */
  readonly isAvailable: boolean;

  /**
   * Initialize the provider.
   * Called once when the provider is registered.
   */
  init?(): Promise<void>;

  /**
   * Get a secret value.
   * @returns The secret value, or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Store a secret.
   * @throws if provider is read-only or storage fails
   */
  set(key: string, value: string, options?: SecretOptions): Promise<void>;

  /**
   * Delete a secret.
   * @returns true if the secret was deleted, false if not found
   */
  delete(key: string): Promise<boolean>;

  /**
   * List all secret keys.
   * @param prefix Optional prefix filter
   */
  list(prefix?: string): Promise<string[]>;

  /**
   * Check if a secret exists.
   */
  has(key: string): Promise<boolean>;

  /**
   * Get information about a secret.
   */
  getInfo?(key: string): Promise<SecretInfo | null>;
}

/**
 * Registered provider with priority.
 */
export interface RegisteredProvider {
  /** The provider instance */
  provider: SecretProvider;
  /** Priority (lower = higher priority, checked first) */
  priority: number;
}

/**
 * Secret change event types.
 */
export type SecretChangeType = 'set' | 'delete' | 'expire';

/**
 * Secret change event.
 */
export interface SecretChangeEvent {
  /** Secret key that changed */
  key: string;
  /** Type of change */
  type: SecretChangeType;
  /** Provider that stored/deleted the secret */
  provider: string;
}

/**
 * Callback for secret change events.
 */
export type SecretChangeCallback = (event: SecretChangeEvent) => void;

/**
 * Unsubscribe function.
 */
export type Unsubscribe = () => void;
