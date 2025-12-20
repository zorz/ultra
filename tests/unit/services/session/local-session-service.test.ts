/**
 * LocalSessionService Unit Tests
 *
 * Tests for the local session service implementation.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { LocalSessionService } from '../../../../src/services/session/local.ts';
import { SessionError, SessionErrorCode } from '../../../../src/services/session/errors.ts';
import type { EditorSettings } from '../../../../src/config/settings.ts';

describe('LocalSessionService', () => {
  let service: LocalSessionService;

  beforeEach(async () => {
    service = new LocalSessionService();
    await service.init('/test/workspace');
  });

  describe('settings', () => {
    test('getSetting returns default value', () => {
      const fontSize = service.getSetting('editor.fontSize');
      expect(fontSize).toBe(14);
    });

    test('setSetting updates value', () => {
      service.setSetting('editor.fontSize', 16);
      expect(service.getSetting('editor.fontSize')).toBe(16);
    });

    test('setSetting validates value', () => {
      expect(() => {
        service.setSetting('editor.fontSize', 5); // Below minimum of 8
      }).toThrow(SessionError);
    });

    test('setSetting validates enum values', () => {
      expect(() => {
        // @ts-expect-error - testing invalid value
        service.setSetting('editor.wordWrap', 'invalid');
      }).toThrow(SessionError);
    });

    test('getAllSettings returns all settings', () => {
      const settings = service.getAllSettings();
      expect(settings['editor.fontSize']).toBe(14);
      expect(settings['editor.tabSize']).toBe(2);
      expect(settings['workbench.colorTheme']).toBe('One Dark');
    });

    test('updateSettings updates multiple values', () => {
      service.updateSettings({
        'editor.fontSize': 18,
        'editor.tabSize': 4,
      });

      expect(service.getSetting('editor.fontSize')).toBe(18);
      expect(service.getSetting('editor.tabSize')).toBe(4);
    });

    test('updateSettings validates all values before applying', () => {
      const originalFontSize = service.getSetting('editor.fontSize');

      expect(() => {
        service.updateSettings({
          'editor.fontSize': 20,
          'editor.tabSize': 0, // Invalid - below minimum
        });
      }).toThrow(SessionError);

      // Font size should not have changed since validation failed
      expect(service.getSetting('editor.fontSize')).toBe(originalFontSize);
    });

    test('resetSettings resets to default', () => {
      service.setSetting('editor.fontSize', 20);
      service.resetSettings('editor.fontSize');
      expect(service.getSetting('editor.fontSize')).toBe(14);
    });

    test('resetSettings resets all when no key provided', () => {
      service.setSetting('editor.fontSize', 20);
      service.setSetting('editor.tabSize', 8);
      service.resetSettings();
      expect(service.getSetting('editor.fontSize')).toBe(14);
      expect(service.getSetting('editor.tabSize')).toBe(2);
    });

    test('getSettingsSchema returns schema', () => {
      const schema = service.getSettingsSchema();
      expect(schema.properties['editor.fontSize']).toBeDefined();
      expect(schema.properties['editor.fontSize'].type).toBe('number');
      expect(schema.properties['editor.fontSize'].default).toBe(14);
    });

    test('onSettingChange notifies listeners', () => {
      const changes: { key: string; value: unknown }[] = [];
      service.onSettingChange((event) => {
        changes.push({ key: event.key, value: event.value });
      });

      service.setSetting('editor.fontSize', 16);

      expect(changes.length).toBe(1);
      expect(changes[0]?.key).toBe('editor.fontSize');
      expect(changes[0]?.value).toBe(16);
    });

    test('onSettingChangeFor notifies specific listeners', () => {
      const values: number[] = [];
      service.onSettingChangeFor('editor.fontSize', (value) => {
        values.push(value);
      });

      service.setSetting('editor.fontSize', 16);
      service.setSetting('editor.tabSize', 4); // Should not trigger

      expect(values.length).toBe(1);
      expect(values[0]).toBe(16);
    });

    test('unsubscribe stops notifications', () => {
      const changes: unknown[] = [];
      const unsubscribe = service.onSettingChange((event) => {
        changes.push(event.value);
      });

      service.setSetting('editor.fontSize', 16);
      unsubscribe();
      service.setSetting('editor.fontSize', 18);

      expect(changes.length).toBe(1);
    });
  });

  describe('sessions', () => {
    test('getCurrentSession returns session after init', () => {
      const session = service.getCurrentSession();
      expect(session).not.toBeNull();
      expect(session?.workspaceRoot).toBe('/test/workspace');
    });

    test('saveSession returns session ID', async () => {
      const sessionId = await service.saveSession();
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
    });

    test('saveSession with name creates named session', async () => {
      const sessionId = await service.saveSession('my-session');
      // Named sessions get a 'named-' prefix to distinguish from workspace sessions
      expect(sessionId).toBe('named-my-session');
    });

    test('listSessions returns sessions', async () => {
      await service.saveSession();
      const sessions = await service.listSessions();
      expect(sessions.length).toBeGreaterThan(0);
    });

    test('setCurrentSession updates state', () => {
      const newSession = {
        version: 1,
        timestamp: new Date().toISOString(),
        instanceId: 'test',
        workspaceRoot: '/new/workspace',
        documents: [],
        activeDocumentPath: null,
        activePaneId: 'main',
        layout: { type: 'leaf' as const, paneId: 'main' },
        ui: {
          sidebarVisible: true,
          sidebarWidth: 30,
          terminalVisible: false,
          terminalHeight: 12,
          gitPanelVisible: false,
          gitPanelWidth: 40,
          activeSidebarPanel: 'files' as const,
          minimapEnabled: true,
        },
      };

      service.setCurrentSession(newSession);

      const current = service.getCurrentSession();
      expect(current?.workspaceRoot).toBe('/new/workspace');
    });

    test('onSessionChange notifies listeners', async () => {
      const events: { sessionId: string; type: string }[] = [];
      service.onSessionChange((event) => {
        events.push({ sessionId: event.sessionId, type: event.type });
      });

      await service.saveSession('test-session');

      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe('saved');
    });
  });

  describe('keybindings', () => {
    test('getKeybindings returns empty array initially', () => {
      const bindings = service.getKeybindings();
      expect(bindings).toEqual([]);
    });

    test('addKeybinding adds a binding', () => {
      service.addKeybinding({ key: 'ctrl+s', command: 'file.save' });

      const bindings = service.getKeybindings();
      expect(bindings.length).toBe(1);
      expect(bindings[0]?.key).toBe('ctrl+s');
      expect(bindings[0]?.command).toBe('file.save');
    });

    test('addKeybinding replaces existing binding for same key', () => {
      service.addKeybinding({ key: 'ctrl+s', command: 'file.save' });
      service.addKeybinding({ key: 'ctrl+s', command: 'file.saveAll' });

      const bindings = service.getKeybindings();
      expect(bindings.length).toBe(1);
      expect(bindings[0]?.command).toBe('file.saveAll');
    });

    test('setKeybindings replaces all bindings', () => {
      service.addKeybinding({ key: 'ctrl+s', command: 'file.save' });
      service.setKeybindings([
        { key: 'ctrl+o', command: 'file.open' },
        { key: 'ctrl+n', command: 'file.new' },
      ]);

      const bindings = service.getKeybindings();
      expect(bindings.length).toBe(2);
      expect(bindings.find(b => b.key === 'ctrl+s')).toBeUndefined();
    });

    test('removeKeybinding removes a binding', () => {
      service.addKeybinding({ key: 'ctrl+s', command: 'file.save' });
      service.removeKeybinding('ctrl+s');

      const bindings = service.getKeybindings();
      expect(bindings.length).toBe(0);
    });

    test('resolveKeybinding returns command', () => {
      service.addKeybinding({ key: 'ctrl+s', command: 'file.save' });

      const command = service.resolveKeybinding({
        key: 's',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });

      expect(command).toBe('file.save');
    });

    test('resolveKeybinding returns null for unknown key', () => {
      const command = service.resolveKeybinding({
        key: 'x',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });

      expect(command).toBeNull();
    });

    test('getBindingForCommand returns key', () => {
      service.addKeybinding({ key: 'ctrl+s', command: 'file.save' });

      const key = service.getBindingForCommand('file.save');
      expect(key).toBe('ctrl+s');
    });

    test('getBindingForCommand returns null for unknown command', () => {
      const key = service.getBindingForCommand('unknown.command');
      expect(key).toBeNull();
    });
  });

  describe('themes', () => {
    test('listThemes returns builtin themes', () => {
      const themes = service.listThemes();
      expect(themes.length).toBeGreaterThan(0);
      expect(themes.some(t => t.id === 'One Dark')).toBe(true);
    });

    test('getTheme returns theme', () => {
      const theme = service.getTheme('One Dark');
      expect(theme).not.toBeNull();
      expect(theme?.name).toBe('One Dark');
      expect(theme?.type).toBe('dark');
    });

    test('getTheme returns null for unknown theme', () => {
      const theme = service.getTheme('Unknown Theme');
      expect(theme).toBeNull();
    });

    test('getCurrentTheme returns current theme', () => {
      const theme = service.getCurrentTheme();
      expect(theme).toBeDefined();
      expect(theme.colors['editor.background']).toBeDefined();
    });

    test('setTheme changes current theme', () => {
      service.setTheme('One Light');

      const theme = service.getCurrentTheme();
      expect(theme.id).toBe('One Light');
      expect(theme.type).toBe('light');
    });

    test('setTheme throws for unknown theme', () => {
      expect(() => {
        service.setTheme('Unknown Theme');
      }).toThrow(SessionError);
    });
  });

  describe('lifecycle', () => {
    test('getWorkspaceRoot returns workspace root', () => {
      expect(service.getWorkspaceRoot()).toBe('/test/workspace');
    });

    test('setWorkspaceRoot updates workspace', () => {
      service.setWorkspaceRoot('/new/workspace');
      expect(service.getWorkspaceRoot()).toBe('/new/workspace');
    });

    test('shutdown saves session', async () => {
      const events: string[] = [];
      service.onSessionChange((event) => {
        events.push(event.type);
      });

      await service.shutdown();

      expect(events).toContain('saved');
    });
  });
});
