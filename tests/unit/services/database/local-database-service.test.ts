/**
 * LocalDatabaseService Unit Tests
 *
 * Tests for the local database service implementation.
 * Note: These tests require the postgres package to be installed.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, spyOn } from 'bun:test';
import { DatabaseError } from '../../../../src/services/database/errors.ts';
import type { ConnectionConfig, DatabaseBackend } from '../../../../src/services/database/types.ts';

// Check if postgres package is available
let postgresAvailable = false;
try {
  // Try to resolve the postgres package
  await import('postgres');
  postgresAvailable = true;
} catch {
  postgresAvailable = false;
}

// Only run tests if postgres is available
const describeWithPostgres = postgresAvailable ? describe : describe.skip;

describeWithPostgres('LocalDatabaseService', () => {
  // Dynamic imports - only loaded when postgres is available
  let LocalDatabaseService: typeof import('../../../../src/services/database/local.ts').LocalDatabaseService;
  let localSecretService: typeof import('../../../../src/services/secret/local.ts').localSecretService;
  let service: InstanceType<typeof LocalDatabaseService>;
  let secretGetSpy: ReturnType<typeof spyOn>;

  beforeAll(async () => {
    // Import modules
    const dbModule = await import('../../../../src/services/database/local.ts');
    LocalDatabaseService = dbModule.LocalDatabaseService;
    const secretModule = await import('../../../../src/services/secret/local.ts');
    localSecretService = secretModule.localSecretService;
  });

  beforeEach(() => {
    // Create fresh service
    service = new LocalDatabaseService();

    // Bypass actual initialization
    (service as any).initialized = true;

    // Spy on the secret service get method to return test passwords
    secretGetSpy = spyOn(localSecretService, 'get').mockImplementation(async (key: string) => {
      if (key === 'test-password-secret') return 'test-password';
      if (key === 'missing-secret') return null;
      return 'default-password';
    });
  });

  afterEach(async () => {
    if (service) {
      await service.shutdown();
    }
    if (secretGetSpy) {
      secretGetSpy.mockRestore();
    }
  });

  describe('connection management', () => {
    const validConfig: ConnectionConfig = {
      name: 'Test Connection',
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      username: 'testuser',
      passwordSecret: 'test-password-secret',
      scope: 'global',
    };

    test('createConnection creates a new connection', async () => {
      const id = await service.createConnection(validConfig);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const conn = service.getConnection(id);
      expect(conn).not.toBeNull();
      expect(conn?.name).toBe('Test Connection');
      expect(conn?.status).toBe('disconnected');
    });

    test('createConnection validates required fields', async () => {
      // Missing name
      await expect(service.createConnection({
        ...validConfig,
        name: '',
      })).rejects.toThrow(DatabaseError);

      // Missing host
      await expect(service.createConnection({
        ...validConfig,
        host: '',
      })).rejects.toThrow(DatabaseError);

      // Invalid port
      await expect(service.createConnection({
        ...validConfig,
        port: 0,
      })).rejects.toThrow(DatabaseError);

      // Missing database
      await expect(service.createConnection({
        ...validConfig,
        database: '',
      })).rejects.toThrow(DatabaseError);
    });

    test('createConnection prevents duplicate IDs', async () => {
      const id = await service.createConnection(validConfig);

      await expect(service.createConnection({
        ...validConfig,
        id,
        name: 'Another Connection',
      })).rejects.toThrow(DatabaseError);
    });

    test('listConnections returns all connections', async () => {
      await service.createConnection({ ...validConfig, name: 'Conn1' });
      await service.createConnection({ ...validConfig, name: 'Conn2' });
      await service.createConnection({ ...validConfig, name: 'Conn3' });

      const connections = service.listConnections();
      expect(connections.length).toBe(3);
    });

    test('listConnections filters by scope', async () => {
      await service.createConnection({ ...validConfig, name: 'Global', scope: 'global' });
      await service.createConnection({ ...validConfig, name: 'Project', scope: 'project' });

      const global = service.listConnections('global');
      expect(global.length).toBe(1);
      expect(global[0]?.name).toBe('Global');

      const project = service.listConnections('project');
      expect(project.length).toBe(1);
      expect(project[0]?.name).toBe('Project');
    });

    test('deleteConnection removes connection', async () => {
      const id = await service.createConnection(validConfig);
      expect(service.getConnection(id)).not.toBeNull();

      await service.deleteConnection(id);
      expect(service.getConnection(id)).toBeNull();
    });

    test('deleteConnection throws for non-existent connection', async () => {
      await expect(service.deleteConnection('non-existent'))
        .rejects.toThrow(DatabaseError);
    });

    test('updateConnection updates config', async () => {
      const id = await service.createConnection(validConfig);

      await service.updateConnection(id, {
        name: 'Updated Name',
        port: 5433,
      });

      const conn = service.getConnection(id);
      expect(conn?.name).toBe('Updated Name');
    });

    test('updateConnection throws for non-existent connection', async () => {
      await expect(service.updateConnection('non-existent', { name: 'New Name' }))
        .rejects.toThrow(DatabaseError);
    });
  });

  describe('events', () => {
    test('onConnectionChange notifies on create', async () => {
      const events: { type: string; id: string }[] = [];
      service.onConnectionChange((event) => {
        events.push({ type: event.type, id: event.connectionId });
      });

      const id = await service.createConnection({
        name: 'Event Test',
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        username: 'user',
        passwordSecret: 'test-password-secret',
        scope: 'global',
      });

      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe('created');
      expect(events[0]?.id).toBe(id);
    });

    test('connect emits connecting event before connected', async () => {
      // This test verifies that the 'connecting' event is emitted before 'connected'
      // to allow UI to show connection-in-progress state
      const id = await service.createConnection({
        name: 'Connect Event Test',
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        username: 'user',
        passwordSecret: 'test-password-secret',
        scope: 'global',
      });

      const events: { type: string; status: string }[] = [];
      service.onConnectionChange((event) => {
        events.push({ type: event.type, status: event.connection?.status || 'unknown' });
      });

      // Try to connect - will fail since no real database, but should emit 'connecting' first
      try {
        await service.connect(id);
      } catch {
        // Connection will fail, but we want to verify the event sequence
      }

      // Should have at least a 'connecting' event
      const connectingEvent = events.find(e => e.type === 'connecting');
      expect(connectingEvent).toBeDefined();
      expect(connectingEvent?.status).toBe('connecting');

      // If there's an error event, it should come after connecting
      const errorEvent = events.find(e => e.type === 'error');
      if (errorEvent) {
        const connectingIndex = events.findIndex(e => e.type === 'connecting');
        const errorIndex = events.findIndex(e => e.type === 'error');
        expect(connectingIndex).toBeLessThan(errorIndex);
      }
    });

    test('onConnectionChange notifies on delete', async () => {
      const id = await service.createConnection({
        name: 'Delete Test',
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        username: 'user',
        passwordSecret: 'test-password-secret',
        scope: 'global',
      });

      const events: { type: string }[] = [];
      service.onConnectionChange((event) => {
        events.push({ type: event.type });
      });

      await service.deleteConnection(id);

      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe('deleted');
    });

    test('unsubscribe stops notifications', async () => {
      const events: string[] = [];
      const unsubscribe = service.onConnectionChange((event) => {
        events.push(event.connectionId);
      });

      await service.createConnection({
        name: 'First',
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        username: 'user',
        passwordSecret: 'test-password-secret',
        scope: 'global',
      });

      unsubscribe();

      await service.createConnection({
        name: 'Second',
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        username: 'user',
        passwordSecret: 'test-password-secret',
        scope: 'global',
      });

      expect(events.length).toBe(1);
    });
  });

  describe('lifecycle', () => {
    test('getWorkspaceRoot returns null initially', () => {
      expect(service.getWorkspaceRoot()).toBeNull();
    });
  });
});

// Always run these tests since they don't need postgres
describe('LocalDatabaseService - no postgres required', () => {
  test('postgres package availability is detected', () => {
    // Just documenting the state
    if (postgresAvailable) {
      console.log('postgres package is available');
    } else {
      console.log('postgres package is NOT available - some tests skipped');
    }
    expect(true).toBe(true);
  });
});
