/**
 * Session Service Integration Tests
 *
 * Tests for the Session Service ECP adapter methods.
 * These tests verify the JSON-RPC interface works correctly.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestECPClient, createTestClient } from '../helpers/ecp-client.ts';

describe('Session Service ECP Integration', () => {
  let client: TestECPClient;

  beforeEach(async () => {
    client = createTestClient({ workspaceRoot: '/test/workspace' });
    await client.initSession();
  });

  afterEach(async () => {
    await client.shutdown();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Settings (config/*) Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('config/get', () => {
    test('returns default value for setting', async () => {
      const result = await client.request<{ value: number }>('config/get', {
        key: 'editor.fontSize',
      });

      expect(result.value).toBe(14);
    });

    test('returns updated value after set', async () => {
      await client.request('config/set', {
        key: 'editor.fontSize',
        value: 18,
      });

      const result = await client.request<{ value: number }>('config/get', {
        key: 'editor.fontSize',
      });

      expect(result.value).toBe(18);
    });

    test('returns error for missing key', async () => {
      const response = await client.requestRaw('config/get', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });
  });

  describe('config/set', () => {
    test('sets a number setting', async () => {
      const result = await client.request<{ success: boolean }>('config/set', {
        key: 'editor.fontSize',
        value: 20,
      });

      expect(result.success).toBe(true);

      const { value } = await client.request<{ value: number }>('config/get', {
        key: 'editor.fontSize',
      });
      expect(value).toBe(20);
    });

    test('sets a boolean setting', async () => {
      const result = await client.request<{ success: boolean }>('config/set', {
        key: 'editor.insertSpaces',
        value: false,
      });

      expect(result.success).toBe(true);

      const { value } = await client.request<{ value: boolean }>('config/get', {
        key: 'editor.insertSpaces',
      });
      expect(value).toBe(false);
    });

    test('sets a string setting', async () => {
      const result = await client.request<{ success: boolean }>('config/set', {
        key: 'editor.wordWrap',
        value: 'on',
      });

      expect(result.success).toBe(true);

      const { value } = await client.request<{ value: string }>('config/get', {
        key: 'editor.wordWrap',
      });
      expect(value).toBe('on');
    });

    test('rejects invalid value', async () => {
      const response = await client.requestRaw('config/set', {
        key: 'editor.fontSize',
        value: 5, // Below minimum of 8
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32301); // InvalidValue
    });

    test('rejects invalid enum value', async () => {
      const response = await client.requestRaw('config/set', {
        key: 'editor.wordWrap',
        value: 'invalid',
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32301); // InvalidValue
    });

    test('returns error for missing key', async () => {
      const response = await client.requestRaw('config/set', { value: 14 });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });

    test('returns error for missing value', async () => {
      const response = await client.requestRaw('config/set', {
        key: 'editor.fontSize',
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });
  });

  describe('config/getAll', () => {
    test('returns all settings', async () => {
      const result = await client.request<{ settings: Record<string, unknown> }>('config/getAll', {});

      expect(result.settings).toBeDefined();
      expect(result.settings['editor.fontSize']).toBe(14);
      expect(result.settings['editor.tabSize']).toBe(2);
      expect(result.settings['workbench.colorTheme']).toBe('One Dark');
    });
  });

  describe('config/reset', () => {
    test('resets specific setting to default', async () => {
      // Change setting
      await client.request('config/set', {
        key: 'editor.fontSize',
        value: 20,
      });

      // Reset it
      const result = await client.request<{ success: boolean }>('config/reset', {
        key: 'editor.fontSize',
      });

      expect(result.success).toBe(true);

      // Verify reset
      const { value } = await client.request<{ value: number }>('config/get', {
        key: 'editor.fontSize',
      });
      expect(value).toBe(14);
    });

    test('resets all settings when no key provided', async () => {
      // Change multiple settings
      await client.request('config/set', { key: 'editor.fontSize', value: 20 });
      await client.request('config/set', { key: 'editor.tabSize', value: 8 });

      // Reset all
      const result = await client.request<{ success: boolean }>('config/reset', {});

      expect(result.success).toBe(true);

      // Verify reset
      const { settings } = await client.request<{ settings: Record<string, unknown> }>('config/getAll', {});
      expect(settings['editor.fontSize']).toBe(14);
      expect(settings['editor.tabSize']).toBe(2);
    });
  });

  describe('config/schema', () => {
    test('returns settings schema', async () => {
      const result = await client.request<{ schema: { properties: Record<string, unknown> } }>('config/schema', {});

      expect(result.schema).toBeDefined();
      expect(result.schema.properties).toBeDefined();
      expect(result.schema.properties['editor.fontSize']).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sessions (session/*) Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('session/save', () => {
    test('saves session and returns ID', async () => {
      const result = await client.request<{ sessionId: string }>('session/save', {});

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
    });

    test('saves session with custom name', async () => {
      const result = await client.request<{ sessionId: string }>('session/save', {
        name: 'my-session',
      });

      // Named sessions get a 'named-' prefix to distinguish from workspace sessions
      expect(result.sessionId).toBe('named-my-session');
    });
  });

  describe('session/list', () => {
    test('returns list of sessions', async () => {
      // Save a session first
      await client.request('session/save', { name: 'test-session' });

      const result = await client.request<{ sessions: Array<{ id: string }> }>('session/list', {});

      expect(result.sessions).toBeDefined();
      expect(Array.isArray(result.sessions)).toBe(true);
      expect(result.sessions.length).toBeGreaterThan(0);
    });
  });

  describe('session/load', () => {
    test('loads a saved session', async () => {
      // Save a session first and get the actual sessionId
      const { sessionId } = await client.request<{ sessionId: string }>('session/save', { name: 'load-test' });

      const result = await client.request<{ workspaceRoot: string }>('session/load', {
        sessionId,
      });

      expect(result.workspaceRoot).toBe('/test/workspace');
    });

    test('returns error for missing sessionId', async () => {
      const response = await client.requestRaw('session/load', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });

    test('returns error for non-existent session', async () => {
      const response = await client.requestRaw('session/load', {
        sessionId: 'non-existent',
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32302); // SessionNotFound
    });
  });

  describe('session/delete', () => {
    test('deletes a saved session', async () => {
      // Save a session first and get the actual sessionId
      const { sessionId } = await client.request<{ sessionId: string }>('session/save', { name: 'delete-test' });

      const result = await client.request<{ success: boolean }>('session/delete', {
        sessionId,
      });

      expect(result.success).toBe(true);

      // Verify it's deleted
      const response = await client.requestRaw('session/load', {
        sessionId,
      });
      expect(response.error).toBeDefined();
    });

    test('returns error for missing sessionId', async () => {
      const response = await client.requestRaw('session/delete', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });
  });

  describe('session/current', () => {
    test('returns current session state', async () => {
      const result = await client.request<{ workspaceRoot: string; documents: unknown[] }>('session/current', {});

      expect(result).toBeDefined();
      expect(result.workspaceRoot).toBe('/test/workspace');
      expect(result.documents).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Keybindings (keybindings/*) Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('keybindings/get', () => {
    test('returns empty array initially', async () => {
      const result = await client.request<{ bindings: unknown[] }>('keybindings/get', {});

      expect(result.bindings).toEqual([]);
    });

    test('returns bindings after adding', async () => {
      await client.request('keybindings/add', {
        binding: { key: 'ctrl+s', command: 'file.save' },
      });

      const result = await client.request<{ bindings: Array<{ key: string; command: string }> }>('keybindings/get', {});

      expect(result.bindings.length).toBe(1);
      expect(result.bindings[0]?.key).toBe('ctrl+s');
      expect(result.bindings[0]?.command).toBe('file.save');
    });
  });

  describe('keybindings/add', () => {
    test('adds a keybinding', async () => {
      const result = await client.request<{ success: boolean }>('keybindings/add', {
        binding: { key: 'ctrl+o', command: 'file.open' },
      });

      expect(result.success).toBe(true);

      const { bindings } = await client.request<{ bindings: Array<{ key: string }> }>('keybindings/get', {});
      expect(bindings.some((b) => b.key === 'ctrl+o')).toBe(true);
    });

    test('replaces existing binding for same key', async () => {
      await client.request('keybindings/add', {
        binding: { key: 'ctrl+s', command: 'file.save' },
      });
      await client.request('keybindings/add', {
        binding: { key: 'ctrl+s', command: 'file.saveAll' },
      });

      const { bindings } = await client.request<{ bindings: Array<{ key: string; command: string }> }>('keybindings/get', {});
      expect(bindings.length).toBe(1);
      expect(bindings[0]?.command).toBe('file.saveAll');
    });

    test('returns error for missing binding', async () => {
      const response = await client.requestRaw('keybindings/add', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });

    test('returns error for binding without key', async () => {
      const response = await client.requestRaw('keybindings/add', {
        binding: { command: 'file.save' },
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });
  });

  describe('keybindings/set', () => {
    test('replaces all keybindings', async () => {
      await client.request('keybindings/add', {
        binding: { key: 'ctrl+s', command: 'file.save' },
      });

      const result = await client.request<{ success: boolean }>('keybindings/set', {
        bindings: [
          { key: 'ctrl+o', command: 'file.open' },
          { key: 'ctrl+n', command: 'file.new' },
        ],
      });

      expect(result.success).toBe(true);

      const { bindings } = await client.request<{ bindings: Array<{ key: string }> }>('keybindings/get', {});
      expect(bindings.length).toBe(2);
      expect(bindings.find((b) => b.key === 'ctrl+s')).toBeUndefined();
    });

    test('returns error for missing bindings array', async () => {
      const response = await client.requestRaw('keybindings/set', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });
  });

  describe('keybindings/remove', () => {
    test('removes a keybinding', async () => {
      await client.request('keybindings/add', {
        binding: { key: 'ctrl+s', command: 'file.save' },
      });

      const result = await client.request<{ success: boolean }>('keybindings/remove', {
        key: 'ctrl+s',
      });

      expect(result.success).toBe(true);

      const { bindings } = await client.request<{ bindings: unknown[] }>('keybindings/get', {});
      expect(bindings.length).toBe(0);
    });

    test('returns error for missing key', async () => {
      const response = await client.requestRaw('keybindings/remove', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });
  });

  describe('keybindings/resolve', () => {
    test('resolves key to command', async () => {
      await client.request('keybindings/add', {
        binding: { key: 'ctrl+s', command: 'file.save' },
      });

      const result = await client.request<{ command: string | null }>('keybindings/resolve', {
        key: { key: 's', ctrl: true, shift: false, alt: false, meta: false },
      });

      expect(result.command).toBe('file.save');
    });

    test('returns null for unbound key', async () => {
      const result = await client.request<{ command: string | null }>('keybindings/resolve', {
        key: { key: 'x', ctrl: true, shift: false, alt: false, meta: false },
      });

      expect(result.command).toBeNull();
    });

    test('returns error for missing key', async () => {
      const response = await client.requestRaw('keybindings/resolve', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Themes (theme/*) Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('theme/list', () => {
    test('returns list of themes', async () => {
      const result = await client.request<{ themes: Array<{ id: string; name: string }> }>('theme/list', {});

      expect(result.themes).toBeDefined();
      expect(Array.isArray(result.themes)).toBe(true);
      expect(result.themes.length).toBeGreaterThan(0);
      expect(result.themes.some((t) => t.id === 'One Dark')).toBe(true);
    });
  });

  describe('theme/get', () => {
    test('returns theme by ID', async () => {
      const result = await client.request<{ theme: { id: string; name: string; type: string } }>('theme/get', {
        themeId: 'One Dark',
      });

      expect(result.theme).toBeDefined();
      expect(result.theme.name).toBe('One Dark');
      expect(result.theme.type).toBe('dark');
    });

    test('returns error for non-existent theme', async () => {
      const response = await client.requestRaw('theme/get', {
        themeId: 'Non Existent Theme',
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32303); // ThemeNotFound
    });

    test('returns error for missing themeId', async () => {
      const response = await client.requestRaw('theme/get', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });
  });

  describe('theme/set', () => {
    test('sets the current theme', async () => {
      const result = await client.request<{ success: boolean }>('theme/set', {
        themeId: 'One Light',
      });

      expect(result.success).toBe(true);

      const { theme } = await client.request<{ theme: { id: string } }>('theme/current', {});
      expect(theme.id).toBe('One Light');
    });

    test('returns error for non-existent theme', async () => {
      const response = await client.requestRaw('theme/set', {
        themeId: 'Non Existent Theme',
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32303); // ThemeNotFound
    });

    test('returns error for missing themeId', async () => {
      const response = await client.requestRaw('theme/set', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
    });
  });

  describe('theme/current', () => {
    test('returns current theme', async () => {
      const result = await client.request<{ theme: { id: string; colors: Record<string, string> } }>('theme/current', {});

      expect(result.theme).toBeDefined();
      expect(result.theme.id).toBeDefined();
      expect(result.theme.colors).toBeDefined();
      expect(result.theme.colors['editor.background']).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Error Handling Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('error handling', () => {
    test('returns method not found for unknown method', async () => {
      const response = await client.requestRaw('config/unknown', {});

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601); // MethodNotFound
    });
  });
});
