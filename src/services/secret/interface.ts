/**
 * Secret Service Interface
 *
 * Defines the contract for secure credential storage.
 * Supports multiple backend providers (keychain, env vars, encrypted file).
 */

import type {
  SecretOptions,
  SecretInfo,
  SecretProvider,
  SecretChangeCallback,
  Unsubscribe,
} from './types.ts';

/**
 * Secret Service interface.
 *
 * Provides secure storage for credentials and sensitive data.
 * Uses a priority-based provider system:
 * 1. System Keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager)
 * 2. Environment Variables (read-only)
 * 3. Encrypted file (~/.ultra/secrets.enc) - fallback
 *
 * When getting a secret, providers are checked in priority order.
 * When setting a secret, the first writable provider is used.
 */
export interface SecretService {
  // ─────────────────────────────────────────────────────────────────────────
  // Core Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a secret value.
   * Checks providers in priority order until found.
   * @returns The secret value, or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Store a secret.
   * Uses the first available writable provider.
   * @throws SecretError if no writable provider is available
   */
  set(key: string, value: string, options?: SecretOptions): Promise<void>;

  /**
   * Delete a secret from all providers.
   * @returns true if the secret was deleted from any provider
   */
  delete(key: string): Promise<boolean>;

  /**
   * List all secret keys.
   * Aggregates keys from all providers.
   * @param prefix Optional prefix filter (e.g., "database.")
   */
  list(prefix?: string): Promise<string[]>;

  /**
   * Check if a secret exists in any provider.
   */
  has(key: string): Promise<boolean>;

  /**
   * Get information about a secret.
   * @returns Secret info, or null if not found
   */
  getInfo(key: string): Promise<SecretInfo | null>;

  // ─────────────────────────────────────────────────────────────────────────
  // Provider Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register a secret provider.
   * @param provider The provider to register
   * @param priority Priority (lower = higher priority)
   */
  addProvider(provider: SecretProvider, priority: number): void;

  /**
   * Remove a provider.
   * @param providerId The provider ID to remove
   * @returns true if the provider was removed
   */
  removeProvider(providerId: string): boolean;

  /**
   * Get all registered providers.
   */
  getProviders(): Array<{ id: string; name: string; priority: number; isReadOnly: boolean }>;

  /**
   * Get a specific provider by ID.
   */
  getProvider(providerId: string): SecretProvider | null;

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to secret changes.
   */
  onChange(callback: SecretChangeCallback): Unsubscribe;

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the service.
   * Loads and initializes all providers.
   */
  init(): Promise<void>;

  /**
   * Shutdown the service.
   * Cleans up any resources.
   */
  shutdown(): Promise<void>;
}
