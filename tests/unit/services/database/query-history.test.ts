/**
 * QueryHistoryManager Unit Tests
 *
 * Tests for the query history manager.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { QueryHistoryManager } from '../../../../src/services/database/history.ts';
import { join } from 'path';
import { $ } from 'bun';
import { randomUUID } from 'crypto';

// Use a unique test directory for each test run
const TEST_BASE_DIR = '/tmp/ultra-test-query-history';

describe('QueryHistoryManager', () => {
  let manager: QueryHistoryManager;
  let testDir: string;

  beforeEach(async () => {
    // Create unique directory for each test
    testDir = join(TEST_BASE_DIR, randomUUID());
    await $`mkdir -p ${testDir}`.quiet();

    // Create manager with test config (git disabled for speed)
    manager = new QueryHistoryManager({
      historyDir: testDir,
      disableGit: true,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    await $`rm -rf ${testDir}`.quiet().nothrow();
  });

  describe('addEntry', () => {
    test('adds entry to history', async () => {
      await manager.init();

      const entry = await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test Connection',
        sql: 'SELECT * FROM users',
        executedAt: new Date(),
        durationMs: 100,
        rowCount: 10,
        status: 'success',
      });

      expect(entry.id).toBeDefined();
      expect(entry.connectionId).toBe('conn-1');
      expect(entry.sql).toBe('SELECT * FROM users');
      expect(entry.isFavorite).toBe(false);
    });

    test('multiple entries are stored', async () => {
      await manager.init();

      await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test',
        sql: 'SELECT 1',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 1,
        status: 'success',
      });

      await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test',
        sql: 'SELECT 2',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 1,
        status: 'success',
      });

      const history = await manager.getHistory();
      expect(history.length).toBe(2);
    });

    test('stores error entries', async () => {
      await manager.init();

      const entry = await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test',
        sql: 'INVALID SQL',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 0,
        status: 'error',
        error: 'Syntax error',
      });

      expect(entry.status).toBe('error');
      expect(entry.error).toBe('Syntax error');

      const history = await manager.getHistory();
      expect(history[0]?.error).toBe('Syntax error');
    });
  });

  describe('getHistory', () => {
    beforeEach(async () => {
      await manager.init();

      // Add some test entries
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        await manager.addEntry({
          connectionId: i < 3 ? 'conn-1' : 'conn-2',
          connectionName: i < 3 ? 'Connection 1' : 'Connection 2',
          sql: `SELECT ${i}`,
          executedAt: new Date(now + i * 1000), // Stagger timestamps
          durationMs: 10,
          rowCount: 1,
          status: 'success',
        });
      }
    });

    test('returns entries sorted by date descending', async () => {
      const history = await manager.getHistory();

      expect(history.length).toBe(5);
      // Newest first
      expect(history[0]?.sql).toBe('SELECT 4');
      expect(history[4]?.sql).toBe('SELECT 0');
    });

    test('filters by connection ID', async () => {
      const history = await manager.getHistory('conn-1');

      expect(history.length).toBe(3);
      expect(history.every(e => e.connectionId === 'conn-1')).toBe(true);
    });

    test('applies limit', async () => {
      const history = await manager.getHistory(undefined, 2);

      expect(history.length).toBe(2);
    });

    test('applies offset', async () => {
      const history = await manager.getHistory(undefined, 2, 2);

      expect(history.length).toBe(2);
      expect(history[0]?.sql).toBe('SELECT 2');
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await manager.init();

      await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test',
        sql: 'SELECT * FROM users WHERE active = true',
        executedAt: new Date(),
        durationMs: 10,
        rowCount: 5,
        status: 'success',
      });

      await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test',
        sql: 'SELECT * FROM orders',
        executedAt: new Date(),
        durationMs: 15,
        rowCount: 10,
        status: 'success',
      });

      await manager.addEntry({
        connectionId: 'conn-2',
        connectionName: 'Test 2',
        sql: 'SELECT * FROM users WHERE status = pending',
        executedAt: new Date(),
        durationMs: 20,
        rowCount: 3,
        status: 'success',
      });
    });

    test('finds matching entries', async () => {
      const results = await manager.search('users');

      expect(results.length).toBe(2);
    });

    test('search is case insensitive', async () => {
      const results = await manager.search('USERS');

      expect(results.length).toBe(2);
    });

    test('filters by connection', async () => {
      const results = await manager.search('users', 'conn-1');

      expect(results.length).toBe(1);
    });

    test('returns empty for no matches', async () => {
      const results = await manager.search('products');

      expect(results.length).toBe(0);
    });
  });

  describe('favorites', () => {
    beforeEach(async () => {
      await manager.init();
    });

    test('setFavorite marks entry as favorite', async () => {
      const entry = await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test',
        sql: 'SELECT * FROM important_query',
        executedAt: new Date(),
        durationMs: 10,
        rowCount: 5,
        status: 'success',
      });

      await manager.setFavorite(entry.id, true);

      const favorites = await manager.getFavorites();
      expect(favorites.length).toBe(1);
      expect(favorites[0]?.id).toBe(entry.id);
      expect(favorites[0]?.isFavorite).toBe(true);
    });

    test('setFavorite removes from favorites', async () => {
      const entry = await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test',
        sql: 'SELECT 1',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 1,
        status: 'success',
      });

      await manager.setFavorite(entry.id, true);
      await manager.setFavorite(entry.id, false);

      const favorites = await manager.getFavorites();
      expect(favorites.length).toBe(0);
    });

    test('getFavorites filters by connection', async () => {
      const entry1 = await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test 1',
        sql: 'SELECT 1',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 1,
        status: 'success',
      });

      const entry2 = await manager.addEntry({
        connectionId: 'conn-2',
        connectionName: 'Test 2',
        sql: 'SELECT 2',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 1,
        status: 'success',
      });

      await manager.setFavorite(entry1.id, true);
      await manager.setFavorite(entry2.id, true);

      const conn1Favorites = await manager.getFavorites('conn-1');
      expect(conn1Favorites.length).toBe(1);
      expect(conn1Favorites[0]?.connectionId).toBe('conn-1');
    });
  });

  describe('clear', () => {
    beforeEach(async () => {
      await manager.init();

      await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test 1',
        sql: 'SELECT 1',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 1,
        status: 'success',
      });

      await manager.addEntry({
        connectionId: 'conn-2',
        connectionName: 'Test 2',
        sql: 'SELECT 2',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 1,
        status: 'success',
      });
    });

    test('clear removes all entries', async () => {
      await manager.clear();

      const history = await manager.getHistory();
      expect(history.length).toBe(0);
    });

    test('clear with connectionId only removes that connection', async () => {
      await manager.clear('conn-1');

      const history = await manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]?.connectionId).toBe('conn-2');
    });

    test('clear also clears favorites', async () => {
      const entry = await manager.addEntry({
        connectionId: 'conn-3',
        connectionName: 'Test 3',
        sql: 'SELECT 3',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 1,
        status: 'success',
      });

      await manager.setFavorite(entry.id, true);
      await manager.clear();

      const favorites = await manager.getFavorites();
      expect(favorites.length).toBe(0);
    });
  });

  describe('lifecycle', () => {
    test('init creates history directory and files', async () => {
      await manager.init();

      const historyExists = await Bun.file(join(testDir, 'history.jsonl')).exists();
      const favoritesExists = await Bun.file(join(testDir, 'favorites.json')).exists();

      expect(historyExists).toBe(true);
      expect(favoritesExists).toBe(true);
    });

    test('shutdown resets entriesSinceCommit', async () => {
      await manager.init();

      // Add some entries
      await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Test',
        sql: 'SELECT 1',
        executedAt: new Date(),
        durationMs: 5,
        rowCount: 1,
        status: 'success',
      });

      await manager.shutdown();

      // entriesSinceCommit should be reset
      const entriesSinceCommit = (manager as any).entriesSinceCommit;
      expect(entriesSinceCommit).toBe(0);
    });

    test('double init is safe', async () => {
      await manager.init();
      await manager.init(); // Should not throw

      const history = await manager.getHistory();
      expect(history).toBeDefined();
    });
  });

  describe('persistence', () => {
    test('entries persist across manager instances', async () => {
      await manager.init();

      await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Persist Test',
        sql: 'SELECT * FROM persistence_test',
        executedAt: new Date(),
        durationMs: 10,
        rowCount: 5,
        status: 'success',
      });

      // Create new manager pointing to same directory
      const manager2 = new QueryHistoryManager({
        historyDir: testDir,
        disableGit: true,
      });
      await manager2.init();

      const history = await manager2.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]?.sql).toBe('SELECT * FROM persistence_test');

      await manager2.shutdown();
    });

    test('favorites persist across manager instances', async () => {
      await manager.init();

      const entry = await manager.addEntry({
        connectionId: 'conn-1',
        connectionName: 'Favorite Test',
        sql: 'SELECT * FROM favorite_test',
        executedAt: new Date(),
        durationMs: 10,
        rowCount: 5,
        status: 'success',
      });

      await manager.setFavorite(entry.id, true);

      // Create new manager
      const manager2 = new QueryHistoryManager({
        historyDir: testDir,
        disableGit: true,
      });
      await manager2.init();

      const favorites = await manager2.getFavorites();
      expect(favorites.length).toBe(1);
      expect(favorites[0]?.isFavorite).toBe(true);

      await manager2.shutdown();
    });
  });
});
