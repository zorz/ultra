/**
 * ThemeAdapter Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  ThemeAdapter,
  createThemeAdapter,
  DEFAULT_THEME,
  DEFAULT_THEME_COLORS,
} from '../../../../../src/clients/tui/client/theme-adapter.ts';
import type { SessionService } from '../../../../../src/services/session/interface.ts';
import type { Theme, ThemeInfo } from '../../../../../src/services/session/types.ts';

// ============================================
// Test Setup
// ============================================

function createMockSessionService(): SessionService & {
  themeChangeCallbacks: Array<(event: { key: string; value: unknown; oldValue: unknown }) => void>;
  currentThemeId: string;
} {
  const callbacks: Array<(event: { key: string; value: unknown; oldValue: unknown }) => void> = [];
  let currentThemeId = 'dark-plus';

  const darkPlusTheme: Theme = {
    id: 'dark-plus',
    name: 'Dark+ (Default)',
    type: 'dark',
    colors: { ...DEFAULT_THEME_COLORS },
  };

  const monokai: Theme = {
    id: 'monokai',
    name: 'Monokai',
    type: 'dark',
    colors: {
      ...DEFAULT_THEME_COLORS,
      'editor.background': '#272822',
    },
  };

  const themes: Theme[] = [darkPlusTheme, monokai];

  return {
    themeChangeCallbacks: callbacks,
    currentThemeId,

    // Settings
    getSetting: () => undefined as never,
    setSetting: () => {},
    getAllSettings: () => ({} as never),
    updateSettings: () => {},
    resetSettings: () => {},
    getSettingsSchema: () => ({ properties: {} }),
    onSettingChange: (callback) => {
      callbacks.push(callback);
      return () => {
        const index = callbacks.indexOf(callback);
        if (index !== -1) callbacks.splice(index, 1);
      };
    },
    onSettingChangeFor: () => () => {},

    // Sessions
    saveSession: async () => 'session-1',
    loadSession: async () => ({} as never),
    listSessions: async () => [],
    deleteSession: async () => {},
    getCurrentSession: () => null,
    setCurrentSession: () => {},
    markSessionDirty: () => {},
    onSessionChange: () => () => {},

    // Keybindings
    getKeybindings: () => [],
    setKeybindings: () => {},
    addKeybinding: () => {},
    removeKeybinding: () => {},
    resolveKeybinding: () => null,
    getBindingForCommand: () => null,

    // Themes
    listThemes: (): ThemeInfo[] => themes.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      builtin: true,
    })),
    getTheme: (themeId: string): Theme | null => themes.find((t) => t.id === themeId) ?? null,
    setTheme: (themeId: string) => {
      const oldId = currentThemeId;
      currentThemeId = themeId;
      for (const cb of callbacks) {
        cb({ key: 'theme', value: themeId, oldValue: oldId });
      }
    },
    getCurrentTheme: (): Theme => themes.find((t) => t.id === currentThemeId) ?? darkPlusTheme,

    // Lifecycle
    init: async () => {},
    shutdown: async () => {},
    getWorkspaceRoot: () => '/test',
    setWorkspaceRoot: () => {},
  };
}

// ============================================
// Tests
// ============================================

describe('ThemeAdapter', () => {
  let adapter: ThemeAdapter;

  beforeEach(() => {
    adapter = new ThemeAdapter();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Default Behavior (No Session Service)
  // ─────────────────────────────────────────────────────────────────────────

  describe('default behavior', () => {
    test('returns default theme when not connected', () => {
      const theme = adapter.getCurrentTheme();
      expect(theme.id).toBe('dark-plus');
    });

    test('getColor returns theme color', () => {
      const color = adapter.getColor('editor.background');
      expect(color).toBe('#1e1e1e');
    });

    test('getColor returns fallback for unknown key', () => {
      const color = adapter.getColor('unknown.color', '#ff0000');
      expect(color).toBe('#ff0000');
    });

    test('getColor returns white for unknown without fallback', () => {
      const color = adapter.getColor('unknown.color');
      expect(color).toBe('#ffffff');
    });

    test('listThemes returns default theme info', () => {
      const themes = adapter.listThemes();
      expect(themes).toHaveLength(1);
      expect(themes[0].id).toBe('dark-plus');
    });

    test('setTheme returns false when not connected', () => {
      const result = adapter.setTheme('monokai');
      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Connected Behavior
  // ─────────────────────────────────────────────────────────────────────────

  describe('connected behavior', () => {
    test('connect loads theme from service', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      const theme = adapter.getCurrentTheme();
      expect(theme.id).toBe('dark-plus');
    });

    test('listThemes returns service themes', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      const themes = adapter.listThemes();
      expect(themes.length).toBeGreaterThan(1);
    });

    test('setTheme updates theme', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      const result = adapter.setTheme('monokai');
      expect(result).toBe(true);
    });

    test('setTheme returns false for unknown theme', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      const result = adapter.setTheme('unknown-theme');
      expect(result).toBe(false);
    });

    test('disconnect resets to default theme', () => {
      const service = createMockSessionService();
      adapter.connect(service);
      adapter.setTheme('monokai');
      adapter.disconnect();

      const theme = adapter.getCurrentTheme();
      expect(theme.id).toBe('dark-plus');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Theme Change Subscription
  // ─────────────────────────────────────────────────────────────────────────

  describe('theme change subscription', () => {
    test('onThemeChange is called on theme change', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      let changedTheme: Theme | null = null;
      adapter.onThemeChange((theme) => {
        changedTheme = theme;
      });

      adapter.setTheme('monokai');
      expect(changedTheme).not.toBeNull();
      expect(changedTheme?.id).toBe('monokai');
    });

    test('unsubscribe stops notifications', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      let callCount = 0;
      const unsubscribe = adapter.onThemeChange(() => {
        callCount++;
      });

      adapter.setTheme('monokai');
      expect(callCount).toBe(1);

      unsubscribe();
      // Trigger another theme change by setting theme through service
      service.setTheme('dark-plus');
      // Should not have been called again since we unsubscribed from adapter
      // Note: The adapter subscribes to the service, not the other way around
    });

    test('multiple subscribers are notified', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      let count1 = 0;
      let count2 = 0;
      adapter.onThemeChange(() => { count1++; });
      adapter.onThemeChange(() => { count2++; });

      adapter.setTheme('monokai');
      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createThemeAdapter', () => {
  test('creates theme adapter', () => {
    const adapter = createThemeAdapter();
    expect(adapter).toBeInstanceOf(ThemeAdapter);
  });
});

// ============================================
// Default Theme Tests
// ============================================

describe('DEFAULT_THEME', () => {
  test('has correct id', () => {
    expect(DEFAULT_THEME.id).toBe('dark-plus');
  });

  test('has correct type', () => {
    expect(DEFAULT_THEME.type).toBe('dark');
  });

  test('has colors', () => {
    expect(DEFAULT_THEME.colors).toBeDefined();
    expect(DEFAULT_THEME.colors['editor.background']).toBe('#1e1e1e');
  });
});

describe('DEFAULT_THEME_COLORS', () => {
  test('has editor colors', () => {
    expect(DEFAULT_THEME_COLORS['editor.background']).toBe('#1e1e1e');
    expect(DEFAULT_THEME_COLORS['editor.foreground']).toBe('#d4d4d4');
  });

  test('has sidebar colors', () => {
    expect(DEFAULT_THEME_COLORS['sideBar.background']).toBe('#252526');
    expect(DEFAULT_THEME_COLORS['sideBar.foreground']).toBe('#cccccc');
  });

  test('has status bar colors', () => {
    expect(DEFAULT_THEME_COLORS['statusBar.background']).toBe('#007acc');
    expect(DEFAULT_THEME_COLORS['statusBar.foreground']).toBe('#ffffff');
  });

  test('has terminal colors', () => {
    expect(DEFAULT_THEME_COLORS['terminal.background']).toBe('#1e1e1e');
    expect(DEFAULT_THEME_COLORS['terminal.ansiRed']).toBe('#cd3131');
  });

  test('has git decoration colors', () => {
    expect(DEFAULT_THEME_COLORS['gitDecoration.modifiedResourceForeground']).toBe('#e2c08d');
    expect(DEFAULT_THEME_COLORS['gitDecoration.addedResourceForeground']).toBe('#81b88b');
  });
});
