/**
 * Local Secret Service Implementation
 *
 * Implements SecretService using multiple providers with priority-based lookup.
 *
 * Default provider priority:
 * 1. System Keychain (most secure)
 * 2. Environment Variables (read-only)
 * 3. Encrypted File (fallback)
 */

import { debugLog } from '../../debug.ts';
import type { SecretService } from './interface.ts';
import type {
  SecretOptions,
  SecretInfo,
  SecretProvider,
  RegisteredProvider,
  SecretChangeCallback,
  SecretChangeEvent,
  Unsubscribe,
} from './types.ts';
import { SecretError } from './errors.ts';

// Import providers
import { KeychainSecretProvider } from './providers/keychain.ts';
import { EnvSecretProvider } from './providers/env.ts';
import { EncryptedFileSecretProvider } from './providers/encrypted-file.ts';

/**
 * Default provider priorities.
 */
const DEFAULT_PRIORITIES = {
  keychain: 10,
  env: 20,
  'encrypted-file': 30,
};

/**
 * Local Secret Service.
 *
 * Manages secrets using multiple providers with priority-based lookup.
 */
export class LocalSecretService implements SecretService {
  private providers: RegisteredProvider[] = [];
  private changeCallbacks = new Set<SecretChangeCallback>();
  private initialized = false;

  // ─────────────────────────────────────────────────────────────────────────
  // Core Operations
  // ─────────────────────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    this.ensureInitialized();

    // Check providers in priority order
    for (const { provider } of this.providers) {
      try {
        const value = await provider.get(key);
        if (value !== null) {
          debugLog(`[SecretService] Found "${key}" in ${provider.id}`);
          return value;
        }
      } catch (error) {
        debugLog(`[SecretService] Error getting "${key}" from ${provider.id}: ${error}`);
        // Continue to next provider
      }
    }

    return null;
  }

  async set(key: string, value: string, options?: SecretOptions): Promise<void> {
    this.ensureInitialized();

    // Find the first writable provider (or specified provider)
    let targetProvider: SecretProvider | null = null;

    if (options?.provider) {
      const registered = this.providers.find(p => p.provider.id === options.provider);
      if (!registered) {
        throw SecretError.providerNotFound(options.provider);
      }
      if (registered.provider.isReadOnly) {
        throw SecretError.providerReadOnly(options.provider);
      }
      targetProvider = registered.provider;
    } else {
      // Find first writable provider
      for (const { provider } of this.providers) {
        if (!provider.isReadOnly && provider.isAvailable) {
          targetProvider = provider;
          break;
        }
      }
    }

    if (!targetProvider) {
      throw SecretError.noWritableProvider();
    }

    await targetProvider.set(key, value, options);
    debugLog(`[SecretService] Stored "${key}" in ${targetProvider.id}`);

    // Emit change event
    this.emitChange({
      key,
      type: 'set',
      provider: targetProvider.id,
    });
  }

  async delete(key: string): Promise<boolean> {
    this.ensureInitialized();

    let deleted = false;

    // Delete from all providers
    for (const { provider } of this.providers) {
      if (provider.isReadOnly) {
        continue;
      }

      try {
        const result = await provider.delete(key);
        if (result) {
          deleted = true;
          debugLog(`[SecretService] Deleted "${key}" from ${provider.id}`);

          this.emitChange({
            key,
            type: 'delete',
            provider: provider.id,
          });
        }
      } catch (error) {
        debugLog(`[SecretService] Error deleting "${key}" from ${provider.id}: ${error}`);
      }
    }

    return deleted;
  }

  async list(prefix?: string): Promise<string[]> {
    this.ensureInitialized();

    const allKeys = new Set<string>();

    for (const { provider } of this.providers) {
      try {
        const keys = await provider.list(prefix);
        for (const key of keys) {
          allKeys.add(key);
        }
      } catch (error) {
        debugLog(`[SecretService] Error listing from ${provider.id}: ${error}`);
      }
    }

    return Array.from(allKeys).sort();
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async getInfo(key: string): Promise<SecretInfo | null> {
    this.ensureInitialized();

    // Check providers in priority order
    for (const { provider } of this.providers) {
      try {
        if (provider.getInfo) {
          const info = await provider.getInfo(key);
          if (info) {
            return info;
          }
        } else if (await provider.has(key)) {
          return {
            key,
            provider: provider.id,
          };
        }
      } catch (error) {
        debugLog(`[SecretService] Error getting info for "${key}" from ${provider.id}: ${error}`);
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Provider Management
  // ─────────────────────────────────────────────────────────────────────────

  addProvider(provider: SecretProvider, priority: number): void {
    // Remove existing provider with same ID
    this.removeProvider(provider.id);

    // Add and sort by priority
    this.providers.push({ provider, priority });
    this.providers.sort((a, b) => a.priority - b.priority);

    debugLog(`[SecretService] Added provider ${provider.id} with priority ${priority}`);
  }

  removeProvider(providerId: string): boolean {
    const index = this.providers.findIndex(p => p.provider.id === providerId);
    if (index !== -1) {
      this.providers.splice(index, 1);
      debugLog(`[SecretService] Removed provider ${providerId}`);
      return true;
    }
    return false;
  }

  getProviders(): Array<{ id: string; name: string; priority: number; isReadOnly: boolean }> {
    return this.providers.map(({ provider, priority }) => ({
      id: provider.id,
      name: provider.name,
      priority,
      isReadOnly: provider.isReadOnly,
    }));
  }

  getProvider(providerId: string): SecretProvider | null {
    const registered = this.providers.find(p => p.provider.id === providerId);
    return registered?.provider ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  onChange(callback: SecretChangeCallback): Unsubscribe {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  private emitChange(event: SecretChangeEvent): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(event);
      } catch (error) {
        debugLog(`[SecretService] Error in change callback: ${error}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    debugLog('[SecretService] Initializing...');

    // Create default providers
    const keychainProvider = new KeychainSecretProvider();
    const envProvider = new EnvSecretProvider();
    const encryptedFileProvider = new EncryptedFileSecretProvider();

    // Initialize providers
    await keychainProvider.init?.();
    await encryptedFileProvider.init?.();

    // Register providers based on availability
    if (keychainProvider.isAvailable) {
      this.addProvider(keychainProvider, DEFAULT_PRIORITIES.keychain);
    }

    this.addProvider(envProvider, DEFAULT_PRIORITIES.env);
    this.addProvider(encryptedFileProvider, DEFAULT_PRIORITIES['encrypted-file']);

    this.initialized = true;
    debugLog(`[SecretService] Initialized with ${this.providers.length} providers`);
  }

  async shutdown(): Promise<void> {
    debugLog('[SecretService] Shutting down...');
    this.providers = [];
    this.changeCallbacks.clear();
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SecretService not initialized. Call init() first.');
    }
  }
}

// Singleton instance
export const localSecretService = new LocalSecretService();
export default localSecretService;
