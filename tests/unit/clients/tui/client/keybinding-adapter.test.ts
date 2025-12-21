/**
 * KeybindingAdapter Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  KeybindingAdapter,
  createKeybindingAdapter,
  DEFAULT_KEYBINDINGS,
} from '../../../../../src/clients/tui/client/keybinding-adapter.ts';
import type { SessionService } from '../../../../../src/services/session/interface.ts';
import type { KeyBinding, ParsedKey } from '../../../../../src/services/session/types.ts';

// ============================================
// Test Setup
// ============================================

function createMockSessionService(): SessionService & {
  bindings: KeyBinding[];
} {
  const bindings: KeyBinding[] = [
    { key: 'ctrl+s', command: 'file.save' },
    { key: 'ctrl+o', command: 'file.open' },
    { key: 'ctrl+f', command: 'editor.find' },
  ];

  return {
    bindings,

    // Settings
    getSetting: () => undefined as never,
    setSetting: () => {},
    getAllSettings: () => ({} as never),
    updateSettings: () => {},
    resetSettings: () => {},
    getSettingsSchema: () => ({ properties: {} }),
    onSettingChange: () => () => {},
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
    getKeybindings: () => bindings,
    setKeybindings: (newBindings) => {
      bindings.length = 0;
      bindings.push(...newBindings);
    },
    addKeybinding: (binding) => {
      bindings.push(binding);
    },
    removeKeybinding: (key) => {
      const index = bindings.findIndex((b) => b.key === key);
      if (index !== -1) bindings.splice(index, 1);
    },
    resolveKeybinding: (parsedKey: ParsedKey): string | null => {
      const keyString = [
        parsedKey.ctrl ? 'ctrl' : null,
        parsedKey.shift ? 'shift' : null,
        parsedKey.alt ? 'alt' : null,
        parsedKey.key.toLowerCase(),
      ].filter(Boolean).join('+');

      const binding = bindings.find((b) => b.key === keyString);
      return binding?.command ?? null;
    },
    getBindingForCommand: (commandId: string): string | null => {
      const binding = bindings.find((b) => b.command === commandId);
      return binding?.key ?? null;
    },

    // Themes
    listThemes: () => [],
    getTheme: () => null,
    setTheme: () => {},
    getCurrentTheme: () => ({
      id: 'dark',
      name: 'Dark',
      type: 'dark',
      colors: {},
    } as never),

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

describe('KeybindingAdapter', () => {
  let adapter: KeybindingAdapter;

  beforeEach(() => {
    adapter = new KeybindingAdapter();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Default Behavior (No Session Service)
  // ─────────────────────────────────────────────────────────────────────────

  describe('default behavior', () => {
    test('returns default keybindings when not connected', () => {
      const bindings = adapter.getKeybindings();
      expect(bindings.length).toBeGreaterThan(0);
    });

    test('addKeybinding adds to local bindings', () => {
      const before = adapter.getKeybindings().length;
      adapter.addKeybinding({ key: 'ctrl+t', command: 'test.command' });
      const after = adapter.getKeybindings().length;
      expect(after).toBe(before + 1);
    });

    test('removeKeybinding removes from local bindings', () => {
      adapter.addKeybinding({ key: 'ctrl+t', command: 'test.command' });
      adapter.removeKeybinding('ctrl+t');
      const binding = adapter.getKeybindings().find((b) => b.key === 'ctrl+t');
      expect(binding).toBeUndefined();
    });

    test('getBindingForCommand returns binding', () => {
      const binding = adapter.getBindingForCommand('file.save');
      expect(binding).toBe('ctrl+s');
    });

    test('getBindingForCommand returns null for unknown', () => {
      const binding = adapter.getBindingForCommand('unknown.command');
      expect(binding).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Connected Behavior
  // ─────────────────────────────────────────────────────────────────────────

  describe('connected behavior', () => {
    test('getKeybindings returns service bindings', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      const bindings = adapter.getKeybindings();
      expect(bindings).toHaveLength(3);
    });

    test('addKeybinding adds to service', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      adapter.addKeybinding({ key: 'ctrl+t', command: 'test.command' });
      expect(service.bindings).toHaveLength(4);
    });

    test('removeKeybinding removes from service', () => {
      const service = createMockSessionService();
      adapter.connect(service);

      adapter.removeKeybinding('ctrl+s');
      expect(service.bindings).toHaveLength(2);
    });

    test('disconnect reverts to local bindings', () => {
      const service = createMockSessionService();
      adapter.connect(service);
      adapter.disconnect();

      const bindings = adapter.getKeybindings();
      expect(bindings.length).toBe(DEFAULT_KEYBINDINGS.length);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Command Handlers
  // ─────────────────────────────────────────────────────────────────────────

  describe('command handlers', () => {
    test('registerCommand adds handler', () => {
      let called = false;
      adapter.registerCommand('test.command', () => { called = true; });

      adapter.addKeybinding({ key: 'ctrl+t', command: 'test.command' });
      adapter.handleKeyEvent({ key: 't', ctrl: true, shift: false, alt: false, meta: false });

      expect(called).toBe(true);
    });

    test('registerCommand returns unsubscribe', () => {
      let called = false;
      const unsubscribe = adapter.registerCommand('test.command', () => { called = true; });

      adapter.addKeybinding({ key: 'ctrl+t', command: 'test.command' });
      unsubscribe();

      const handled = adapter.handleKeyEvent({ key: 't', ctrl: true, shift: false, alt: false, meta: false });
      expect(handled).toBe(false);
    });

    test('registerCommands adds multiple handlers', () => {
      let count = 0;
      adapter.registerCommands({
        'test.one': () => { count++; },
        'test.two': () => { count++; },
      });

      // Use unique key combinations that don't conflict with defaults
      adapter.addKeybinding({ key: 'ctrl+alt+x', command: 'test.one' });
      adapter.addKeybinding({ key: 'ctrl+alt+y', command: 'test.two' });

      adapter.handleKeyEvent({ key: 'x', ctrl: true, shift: false, alt: true, meta: false });
      adapter.handleKeyEvent({ key: 'y', ctrl: true, shift: false, alt: true, meta: false });

      expect(count).toBe(2);
    });

    test('registerCommands returns unsubscribe for all', () => {
      let count = 0;
      const unsubscribe = adapter.registerCommands({
        'test.one': () => { count++; },
        'test.two': () => { count++; },
      });

      unsubscribe();

      adapter.addKeybinding({ key: 'ctrl+alt+x', command: 'test.one' });
      const handled = adapter.handleKeyEvent({ key: 'x', ctrl: true, shift: false, alt: true, meta: false });
      expect(handled).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Context Providers
  // ─────────────────────────────────────────────────────────────────────────

  describe('context providers', () => {
    test('registerContext adds context', () => {
      let editorFocused = true;
      adapter.registerContext('editorFocus', () => editorFocused);

      // Context is used for when clauses
    });

    test('registerContext returns unsubscribe', () => {
      const unsubscribe = adapter.registerContext('editorFocus', () => true);
      unsubscribe();
      // Context removed
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Key Event Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('key event handling', () => {
    test('handleKeyEvent returns true for matched binding', () => {
      let called = false;
      adapter.registerCommand('file.save', () => { called = true; });

      const handled = adapter.handleKeyEvent({ key: 's', ctrl: true, shift: false, alt: false, meta: false });

      expect(handled).toBe(true);
      expect(called).toBe(true);
    });

    test('handleKeyEvent returns false for unmatched binding', () => {
      const handled = adapter.handleKeyEvent({ key: 'x', ctrl: true, shift: false, alt: false, meta: false });
      expect(handled).toBe(false);
    });

    test('handleKeyEvent returns false when no handler', () => {
      // Binding exists but no handler
      const handled = adapter.handleKeyEvent({ key: 's', ctrl: true, shift: false, alt: false, meta: false });
      expect(handled).toBe(false);
    });

    test('handleKeyEvent with modifiers', () => {
      let called = false;
      adapter.registerCommand('file.saveAs', () => { called = true; });

      adapter.handleKeyEvent({ key: 's', ctrl: true, shift: true, alt: false, meta: false });
      expect(called).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Binding Resolution
  // ─────────────────────────────────────────────────────────────────────────

  describe('binding resolution', () => {
    test('resolveBinding finds command', () => {
      const command = adapter.resolveBinding({
        key: 's',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });
      expect(command).toBe('file.save');
    });

    test('resolveBinding returns null for unknown', () => {
      const command = adapter.resolveBinding({
        key: 'x',
        ctrl: true,
        shift: true,
        alt: true,
        meta: false,
      });
      expect(command).toBeNull();
    });

    test('resolveBinding handles case insensitive', () => {
      const command = adapter.resolveBinding({
        key: 'S',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });
      expect(command).toBe('file.save');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Key Formatting
  // ─────────────────────────────────────────────────────────────────────────

  describe('key formatting', () => {
    test('formatKeyBinding formats ctrl', () => {
      const formatted = adapter.formatKeyBinding('ctrl+s');
      expect(formatted).toBe('⌃S');
    });

    test('formatKeyBinding formats shift', () => {
      const formatted = adapter.formatKeyBinding('shift+s');
      expect(formatted).toBe('⇧S');
    });

    test('formatKeyBinding formats alt', () => {
      const formatted = adapter.formatKeyBinding('alt+s');
      expect(formatted).toBe('⌥S');
    });

    test('formatKeyBinding formats meta', () => {
      const formatted = adapter.formatKeyBinding('meta+s');
      expect(formatted).toBe('⌘S');
    });

    test('formatKeyBinding formats combined', () => {
      const formatted = adapter.formatKeyBinding('ctrl+shift+s');
      expect(formatted).toBe('⌃⇧S');
    });

    test('formatKeyBinding formats special keys', () => {
      const enter = adapter.formatKeyBinding('enter');
      expect(enter).toBe('↵');

      const escape = adapter.formatKeyBinding('escape');
      expect(escape).toBe('Esc');

      const backspace = adapter.formatKeyBinding('backspace');
      expect(backspace).toBe('⌫');
    });

    test('formatKeyBinding formats arrow keys', () => {
      expect(adapter.formatKeyBinding('arrowup')).toBe('↑');
      expect(adapter.formatKeyBinding('arrowdown')).toBe('↓');
      expect(adapter.formatKeyBinding('arrowleft')).toBe('←');
      expect(adapter.formatKeyBinding('arrowright')).toBe('→');
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createKeybindingAdapter', () => {
  test('creates keybinding adapter', () => {
    const adapter = createKeybindingAdapter();
    expect(adapter).toBeInstanceOf(KeybindingAdapter);
  });
});

// ============================================
// Default Keybindings Tests
// ============================================

describe('DEFAULT_KEYBINDINGS', () => {
  test('has file operations', () => {
    const save = DEFAULT_KEYBINDINGS.find((b) => b.command === 'file.save');
    expect(save).toBeDefined();
    expect(save?.key).toBe('ctrl+s');

    const open = DEFAULT_KEYBINDINGS.find((b) => b.command === 'file.open');
    expect(open).toBeDefined();
    expect(open?.key).toBe('ctrl+o');
  });

  test('has edit operations', () => {
    const undo = DEFAULT_KEYBINDINGS.find((b) => b.command === 'edit.undo');
    expect(undo).toBeDefined();
    expect(undo?.key).toBe('ctrl+z');

    const redo = DEFAULT_KEYBINDINGS.find((b) => b.command === 'edit.redo');
    expect(redo).toBeDefined();
  });

  test('has navigation', () => {
    const gotoLine = DEFAULT_KEYBINDINGS.find((b) => b.command === 'editor.gotoLine');
    expect(gotoLine).toBeDefined();

    const quickOpen = DEFAULT_KEYBINDINGS.find((b) => b.command === 'quickOpen');
    expect(quickOpen).toBeDefined();
  });

  test('has search operations', () => {
    const find = DEFAULT_KEYBINDINGS.find((b) => b.command === 'editor.find');
    expect(find).toBeDefined();

    const replace = DEFAULT_KEYBINDINGS.find((b) => b.command === 'editor.findAndReplace');
    expect(replace).toBeDefined();
  });

  test('has view operations', () => {
    const sidebar = DEFAULT_KEYBINDINGS.find((b) => b.command === 'view.toggleSidebar');
    expect(sidebar).toBeDefined();

    const terminal = DEFAULT_KEYBINDINGS.find((b) => b.command === 'view.toggleTerminal');
    expect(terminal).toBeDefined();
  });
});
