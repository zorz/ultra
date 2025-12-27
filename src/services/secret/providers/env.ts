/**
 * Environment Variable Secret Provider
 *
 * Read-only provider that reads secrets from environment variables.
 * Useful for CI/CD environments and containerized deployments.
 *
 * Key format: Converts dots to underscores and uppercases.
 * Example: "database.prod.password" -> "DATABASE_PROD_PASSWORD"
 *
 * Can also use a prefix (default: "ULTRA_SECRET_"):
 * Example: "database.prod.password" -> "ULTRA_SECRET_DATABASE_PROD_PASSWORD"
 */

import type { SecretProvider, SecretOptions } from '../types.ts';

/**
 * Configuration for the environment provider.
 */
export interface EnvProviderConfig {
  /** Prefix for environment variable names (default: "ULTRA_SECRET_") */
  prefix?: string;
  /** Whether to also check without prefix (default: true) */
  checkWithoutPrefix?: boolean;
}

/**
 * Convert a secret key to environment variable name.
 */
function keyToEnvName(key: string, prefix: string): string {
  const envName = key
    .replace(/\./g, '_')
    .replace(/-/g, '_')
    .toUpperCase();
  return `${prefix}${envName}`;
}

/**
 * Environment variable secret provider.
 */
export class EnvSecretProvider implements SecretProvider {
  readonly id = 'env';
  readonly name = 'Environment Variables';
  readonly isReadOnly = true;
  readonly supportsExpiry = false;
  readonly isAvailable = true;

  private prefix: string;
  private checkWithoutPrefix: boolean;

  constructor(config: EnvProviderConfig = {}) {
    this.prefix = config.prefix ?? 'ULTRA_SECRET_';
    this.checkWithoutPrefix = config.checkWithoutPrefix ?? true;
  }

  async get(key: string): Promise<string | null> {
    // First try with prefix
    const prefixedName = keyToEnvName(key, this.prefix);
    const prefixedValue = process.env[prefixedName];
    if (prefixedValue !== undefined) {
      return prefixedValue;
    }

    // Then try without prefix
    if (this.checkWithoutPrefix) {
      const directName = keyToEnvName(key, '');
      const directValue = process.env[directName];
      if (directValue !== undefined) {
        return directValue;
      }
    }

    return null;
  }

  async set(_key: string, _value: string, _options?: SecretOptions): Promise<void> {
    throw new Error('Environment provider is read-only');
  }

  async delete(_key: string): Promise<boolean> {
    throw new Error('Environment provider is read-only');
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    const envPrefix = this.prefix;

    for (const envKey of Object.keys(process.env)) {
      // Check if it starts with our prefix
      if (envKey.startsWith(envPrefix)) {
        // Convert back to dot notation
        const secretKey = envKey
          .slice(envPrefix.length)
          .toLowerCase()
          .replace(/_/g, '.');

        // Apply prefix filter if provided
        if (!prefix || secretKey.startsWith(prefix)) {
          keys.push(secretKey);
        }
      }
    }

    return keys;
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }
}

export const envSecretProvider = new EnvSecretProvider();
export default envSecretProvider;
