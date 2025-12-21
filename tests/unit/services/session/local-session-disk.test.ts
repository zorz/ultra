/**
 * Tests for LocalSessionService disk I/O functionality.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, readdir } from 'fs/promises';
import { LocalSessionService } from '../../../../src/services/session/local.ts';
import type { SessionState, SessionDocumentState, SessionUIState, SessionLayoutNode } from '../../../../src/services/session/types.ts';

// Test directory
const TEST_DIR = '/tmp/ultra-session-tests';
const TEST_WORKSPACE = '/tmp/test-workspace';

function createTestPaths() {
  return {
    sessionsDir: `${TEST_DIR}/sessions`,
    workspaceSessionsDir: `${TEST_DIR}/sessions/workspaces`,
    namedSessionsDir: `${TEST_DIR}/sessions/named`,
    lastSessionFile: `${TEST_DIR}/sessions/last-session.json`,
  };
}

function createTestSession(workspaceRoot: string, documents: SessionDocumentState[] = []): SessionState {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    instanceId: `test-${Date.now()}`,
    workspaceRoot,
    documents,
    activeDocumentPath: documents[0]?.filePath ?? null,
    activePaneId: 'main',
    layout: { type: 'leaf', paneId: 'main' },
    ui: {
      sidebarVisible: true,
      sidebarWidth: 30,
      terminalVisible: false,
      terminalHeight: 10,
      gitPanelVisible: false,
      gitPanelWidth: 40,
      activeSidebarPanel: 'files',
      minimapEnabled: false,
    },
  };
}

describe('LocalSessionService Disk I/O', () => {
  let service: LocalSessionService;

  beforeEach(async () => {
    // Clean up test directory
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });

    // Create a new service instance
    service = new LocalSessionService();
    service.setSessionPaths(createTestPaths());
    await service.init(TEST_WORKSPACE);
  });

  afterEach(async () => {
    await service.shutdown();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('saveSession', () => {
    test('saves workspace session to disk', async () => {
      // Set up session state
      const session = createTestSession(TEST_WORKSPACE, [
        {
          filePath: '/test/file.ts',
          scrollTop: 100,
          scrollLeft: 0,
          cursorLine: 10,
          cursorColumn: 5,
          foldedRegions: [20, 30],
          paneId: 'main',
          tabOrder: 0,
          isActiveInPane: true,
        },
      ]);
      service.setCurrentSession(session);

      // Save session
      const sessionId = await service.saveSession();

      // Verify session ID format
      expect(sessionId).toMatch(/^workspace-[a-f0-9]{16}$/);

      // Verify file was created
      const paths = createTestPaths();
      const files = await readdir(paths.workspaceSessionsDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^[a-f0-9]{16}\.json$/);

      // Verify last-session.json was created
      const lastSessionFile = Bun.file(paths.lastSessionFile);
      expect(await lastSessionFile.exists()).toBe(true);

      const lastSession = await lastSessionFile.json();
      expect(lastSession.sessionId).toBe(sessionId);
      expect(lastSession.workspaceRoot).toBe(TEST_WORKSPACE);
    });

    test('saves named session to disk', async () => {
      const session = createTestSession(TEST_WORKSPACE);
      session.sessionName = 'My Test Session';
      service.setCurrentSession(session);

      const sessionId = await service.saveSession('My Test Session');

      expect(sessionId).toBe('named-My Test Session');

      // Verify file was created in named directory
      const paths = createTestPaths();
      const files = await readdir(paths.namedSessionsDir);
      expect(files.length).toBe(1);
      expect(files[0]).toBe('my-test-session.json');
    });
  });

  describe('loadSession', () => {
    test('loads workspace session from disk', async () => {
      // First save a session
      const originalSession = createTestSession(TEST_WORKSPACE, [
        {
          filePath: '/test/file.ts',
          scrollTop: 100,
          scrollLeft: 0,
          cursorLine: 10,
          cursorColumn: 5,
          foldedRegions: [20, 30],
          paneId: 'main',
          tabOrder: 0,
          isActiveInPane: true,
        },
      ]);
      service.setCurrentSession(originalSession);
      const sessionId = await service.saveSession();

      // Clear the in-memory session
      service.setCurrentSession(null as unknown as SessionState);

      // Load the session
      const loaded = await service.loadSession(sessionId);

      expect(loaded.workspaceRoot).toBe(TEST_WORKSPACE);
      expect(loaded.documents.length).toBe(1);
      expect(loaded.documents[0].filePath).toBe('/test/file.ts');
      expect(loaded.documents[0].scrollTop).toBe(100);
      expect(loaded.documents[0].cursorLine).toBe(10);
      expect(loaded.documents[0].foldedRegions).toEqual([20, 30]);
    });

    test('loads named session from disk', async () => {
      // Save a named session
      const originalSession = createTestSession(TEST_WORKSPACE);
      originalSession.sessionName = 'Test Named';
      service.setCurrentSession(originalSession);
      await service.saveSession('Test Named');

      // Clear in-memory
      service.setCurrentSession(null as unknown as SessionState);

      // Load the session
      const loaded = await service.loadSession('named-Test Named');

      expect(loaded.sessionName).toBe('Test Named');
      expect(loaded.workspaceRoot).toBe(TEST_WORKSPACE);
    });
  });

  describe('tryLoadLastSession', () => {
    test('loads last session for matching workspace', async () => {
      // Save a session
      const originalSession = createTestSession(TEST_WORKSPACE, [
        {
          filePath: '/test/main.ts',
          scrollTop: 50,
          scrollLeft: 0,
          cursorLine: 25,
          cursorColumn: 10,
          foldedRegions: [],
          paneId: 'main',
          tabOrder: 0,
          isActiveInPane: true,
        },
      ]);
      service.setCurrentSession(originalSession);
      await service.saveSession();

      // Clear in-memory
      service.setCurrentSession(null as unknown as SessionState);

      // Try to load last session
      const loaded = await service.tryLoadLastSession();

      expect(loaded).not.toBeNull();
      expect(loaded!.documents.length).toBe(1);
      expect(loaded!.documents[0].filePath).toBe('/test/main.ts');
    });

    test('returns null for different workspace', async () => {
      // Save session for different workspace
      const originalSession = createTestSession('/different/workspace');
      service.setCurrentSession(originalSession);

      // Manually write last-session.json for different workspace
      const paths = createTestPaths();
      await mkdir(paths.sessionsDir, { recursive: true });
      await Bun.write(paths.lastSessionFile, JSON.stringify({
        sessionId: 'workspace-different',
        workspaceRoot: '/different/workspace',
        timestamp: new Date().toISOString(),
      }));

      // Try to load - should return null since workspace doesn't match
      const loaded = await service.tryLoadLastSession();

      expect(loaded).toBeNull();
    });
  });

  describe('listSessions', () => {
    test('lists all saved sessions', async () => {
      // Save multiple sessions
      const session1 = createTestSession(TEST_WORKSPACE);
      service.setCurrentSession(session1);
      await service.saveSession();

      const session2 = createTestSession(TEST_WORKSPACE);
      session2.sessionName = 'Named Session';
      service.setCurrentSession(session2);
      await service.saveSession('Named Session');

      // List sessions
      const sessions = await service.listSessions();

      // Should have current + 2 disk sessions (one may be duplicate)
      expect(sessions.length).toBeGreaterThanOrEqual(2);

      const namedSession = sessions.find(s => s.name === 'Named Session');
      expect(namedSession).toBeDefined();
      expect(namedSession!.type).toBe('named');
    });
  });

  describe('deleteSession', () => {
    test('deletes workspace session from disk', async () => {
      // Save a session
      const session = createTestSession(TEST_WORKSPACE);
      service.setCurrentSession(session);
      const sessionId = await service.saveSession();

      // Verify file exists
      const paths = createTestPaths();
      let files = await readdir(paths.workspaceSessionsDir);
      expect(files.length).toBe(1);

      // Delete the session
      await service.deleteSession(sessionId);

      // Verify file is gone
      files = await readdir(paths.workspaceSessionsDir);
      expect(files.length).toBe(0);
    });

    test('deletes named session from disk', async () => {
      // Save a named session
      const session = createTestSession(TEST_WORKSPACE);
      session.sessionName = 'To Delete';
      service.setCurrentSession(session);
      await service.saveSession('To Delete');

      // Verify file exists
      const paths = createTestPaths();
      let files = await readdir(paths.namedSessionsDir);
      expect(files.length).toBe(1);

      // Delete the session
      await service.deleteSession('named-To Delete');

      // Verify file is gone
      files = await readdir(paths.namedSessionsDir);
      expect(files.length).toBe(0);
    });
  });

  describe('session ID consistency', () => {
    test('generates consistent session ID for same workspace', async () => {
      const session1 = createTestSession(TEST_WORKSPACE);
      service.setCurrentSession(session1);
      const id1 = await service.saveSession();

      const session2 = createTestSession(TEST_WORKSPACE);
      service.setCurrentSession(session2);
      const id2 = await service.saveSession();

      // Same workspace should produce same ID
      expect(id1).toBe(id2);
    });

    test('session ID matches saved filename', async () => {
      const session = createTestSession(TEST_WORKSPACE);
      service.setCurrentSession(session);
      const sessionId = await service.saveSession();

      // Extract hash from session ID
      const hash = sessionId.replace('workspace-', '');

      // Verify file with that hash exists
      const paths = createTestPaths();
      const files = await readdir(paths.workspaceSessionsDir);
      expect(files).toContain(`${hash}.json`);
    });
  });
});
