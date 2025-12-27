/**
 * LocalSecretService Unit Tests
 *
 * Tests for the local secret service implementation.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { LocalSecretService } from '../../../../src/services/secret/local.ts';
import { SecretError, SecretErrorCode } from '../../../../src/services/secret/errors.ts';
import type { SecretProvider } from '../../../../src/services/secret/types.ts';

/**
 * Create a mock provider for testing.
 */
function createMockProvider(options: {
  id: string;
  name?: string;
  isReadOnly?: boolean;
  isAvailable?: boolean;
  secrets?: Map<string, string>;
}): SecretProvider {
  const secrets = options.secrets ?? new Map();

  return {
    id: options.id,
    name: options.name ?? options.id,
    isReadOnly: options.isReadOnly ?? false,
    isAvailable: options.isAvailable ?? true,

    async get(key: string): Promise<string | null> {
      return secrets.get(key) ?? null;
    },

    async set(key: string, value: string): Promise<void> {
      if (options.isReadOnly) {
        throw new Error('Provider is read-only');
      }
      secrets.set(key, value);
    },

    async delete(key: string): Promise<boolean> {
      if (options.isReadOnly) {
        return false;
      }
      return secrets.delete(key);
    },

    async list(prefix?: string): Promise<string[]> {
      const keys = Array.from(secrets.keys());
      if (prefix) {
        return keys.filter(k => k.startsWith(prefix));
      }
      return keys;
    },

    async has(key: string): Promise<boolean> {
      return secrets.has(key);
    },
  };
}

describe('LocalSecretService', () => {
  let service: LocalSecretService;

  beforeEach(() => {
    // Create a fresh service for each test (not initialized)
    service = new LocalSecretService();
  });

  afterEach(async () => {
    await service.shutdown();
  });

  describe('provider management', () => {
    test('addProvider registers a provider', () => {
      const provider = createMockProvider({ id: 'test-provider' });
      service.addProvider(provider, 10);

      const providers = service.getProviders();
      expect(providers.length).toBe(1);
      expect(providers[0]?.id).toBe('test-provider');
    });

    test('providers are sorted by priority', () => {
      const provider1 = createMockProvider({ id: 'provider1' });
      const provider2 = createMockProvider({ id: 'provider2' });
      const provider3 = createMockProvider({ id: 'provider3' });

      service.addProvider(provider3, 30);
      service.addProvider(provider1, 10);
      service.addProvider(provider2, 20);

      const providers = service.getProviders();
      expect(providers[0]?.id).toBe('provider1');
      expect(providers[1]?.id).toBe('provider2');
      expect(providers[2]?.id).toBe('provider3');
    });

    test('addProvider replaces existing provider with same ID', () => {
      const provider1 = createMockProvider({ id: 'same-id', name: 'First' });
      const provider2 = createMockProvider({ id: 'same-id', name: 'Second' });

      service.addProvider(provider1, 10);
      service.addProvider(provider2, 20);

      const providers = service.getProviders();
      expect(providers.length).toBe(1);
      expect(providers[0]?.name).toBe('Second');
      expect(providers[0]?.priority).toBe(20);
    });

    test('removeProvider removes a provider', () => {
      const provider = createMockProvider({ id: 'removable' });
      service.addProvider(provider, 10);

      const removed = service.removeProvider('removable');
      expect(removed).toBe(true);
      expect(service.getProviders().length).toBe(0);
    });

    test('removeProvider returns false for non-existent provider', () => {
      const removed = service.removeProvider('non-existent');
      expect(removed).toBe(false);
    });

    test('getProvider returns provider by ID', () => {
      const provider = createMockProvider({ id: 'find-me' });
      service.addProvider(provider, 10);

      const found = service.getProvider('find-me');
      expect(found).toBe(provider);
    });

    test('getProvider returns null for unknown ID', () => {
      const found = service.getProvider('unknown');
      expect(found).toBeNull();
    });
  });

  describe('secret operations', () => {
    beforeEach(() => {
      // Add writable and read-only providers with test secrets
      const writableSecrets = new Map([['existing', 'existing-value']]);
      const readOnlySecrets = new Map([['env-secret', 'env-value']]);

      const writable = createMockProvider({
        id: 'writable',
        secrets: writableSecrets,
      });
      const readOnly = createMockProvider({
        id: 'readonly',
        isReadOnly: true,
        secrets: readOnlySecrets,
      });

      // Writable has higher priority
      service.addProvider(writable, 10);
      service.addProvider(readOnly, 20);

      // Mark as initialized (bypass init which adds real providers)
      (service as any).initialized = true;
    });

    test('get returns value from first provider that has it', async () => {
      const value = await service.get('existing');
      expect(value).toBe('existing-value');
    });

    test('get falls back to lower priority providers', async () => {
      const value = await service.get('env-secret');
      expect(value).toBe('env-value');
    });

    test('get returns null for non-existent key', async () => {
      const value = await service.get('non-existent');
      expect(value).toBeNull();
    });

    test('set stores value in first writable provider', async () => {
      await service.set('new-key', 'new-value');
      const value = await service.get('new-key');
      expect(value).toBe('new-value');
    });

    test('set with specific provider stores in that provider', async () => {
      await service.set('specific-key', 'specific-value', { provider: 'writable' });
      const value = await service.get('specific-key');
      expect(value).toBe('specific-value');
    });

    test('set throws for read-only provider', async () => {
      await expect(service.set('key', 'value', { provider: 'readonly' }))
        .rejects.toThrow();
    });

    test('set throws for non-existent provider', async () => {
      await expect(service.set('key', 'value', { provider: 'non-existent' }))
        .rejects.toThrow();
    });

    test('delete removes from all writable providers', async () => {
      await service.set('to-delete', 'value');
      expect(await service.has('to-delete')).toBe(true);

      const deleted = await service.delete('to-delete');
      expect(deleted).toBe(true);
      expect(await service.has('to-delete')).toBe(false);
    });

    test('delete returns false when key not found', async () => {
      const deleted = await service.delete('non-existent');
      expect(deleted).toBe(false);
    });

    test('list returns keys from all providers', async () => {
      await service.set('new-key1', 'value1');
      await service.set('new-key2', 'value2');

      const keys = await service.list();
      expect(keys).toContain('existing');
      expect(keys).toContain('env-secret');
      expect(keys).toContain('new-key1');
      expect(keys).toContain('new-key2');
    });

    test('list with prefix filters keys', async () => {
      await service.set('db.password', 'secret1');
      await service.set('db.username', 'secret2');
      await service.set('api.key', 'secret3');

      const dbKeys = await service.list('db.');
      expect(dbKeys.length).toBe(2);
      expect(dbKeys).toContain('db.password');
      expect(dbKeys).toContain('db.username');
    });

    test('has returns true for existing key', async () => {
      const exists = await service.has('existing');
      expect(exists).toBe(true);
    });

    test('has returns false for non-existing key', async () => {
      const exists = await service.has('non-existent');
      expect(exists).toBe(false);
    });

    test('getInfo returns info for existing key', async () => {
      const info = await service.getInfo('existing');
      expect(info).not.toBeNull();
      expect(info?.key).toBe('existing');
      expect(info?.provider).toBe('writable');
    });

    test('getInfo returns null for non-existing key', async () => {
      const info = await service.getInfo('non-existent');
      expect(info).toBeNull();
    });
  });

  describe('events', () => {
    beforeEach(() => {
      const writable = createMockProvider({ id: 'writable' });
      service.addProvider(writable, 10);
      (service as any).initialized = true;
    });

    test('onChange notifies on set', async () => {
      const events: { key: string; type: string }[] = [];
      service.onChange((event) => {
        events.push({ key: event.key, type: event.type });
      });

      await service.set('test-key', 'test-value');

      expect(events.length).toBe(1);
      expect(events[0]?.key).toBe('test-key');
      expect(events[0]?.type).toBe('set');
    });

    test('onChange notifies on delete', async () => {
      await service.set('to-delete', 'value');

      const events: { key: string; type: string }[] = [];
      service.onChange((event) => {
        events.push({ key: event.key, type: event.type });
      });

      await service.delete('to-delete');

      expect(events.length).toBe(1);
      expect(events[0]?.key).toBe('to-delete');
      expect(events[0]?.type).toBe('delete');
    });

    test('unsubscribe stops notifications', async () => {
      const events: string[] = [];
      const unsubscribe = service.onChange((event) => {
        events.push(event.key);
      });

      await service.set('key1', 'value1');
      unsubscribe();
      await service.set('key2', 'value2');

      expect(events.length).toBe(1);
      expect(events[0]).toBe('key1');
    });
  });

  describe('lifecycle', () => {
    test('operations fail before init', async () => {
      // Service created but not initialized
      const freshService = new LocalSecretService();

      await expect(freshService.get('any-key'))
        .rejects.toThrow('SecretService not initialized');
    });

    test('shutdown clears providers and callbacks', async () => {
      const provider = createMockProvider({ id: 'test' });
      service.addProvider(provider, 10);
      (service as any).initialized = true;

      let callbackCalled = false;
      service.onChange(() => { callbackCalled = true; });

      await service.shutdown();

      expect(service.getProviders().length).toBe(0);

      // Re-add provider to test callback is gone
      service.addProvider(provider, 10);
      (service as any).initialized = true;
      await service.set('test', 'value');
      expect(callbackCalled).toBe(false);
    });
  });

  describe('no writable provider', () => {
    beforeEach(() => {
      const readOnly = createMockProvider({
        id: 'readonly',
        isReadOnly: true,
      });
      service.addProvider(readOnly, 10);
      (service as any).initialized = true;
    });

    test('set throws when no writable provider available', async () => {
      await expect(service.set('key', 'value'))
        .rejects.toThrow();
    });
  });
});
