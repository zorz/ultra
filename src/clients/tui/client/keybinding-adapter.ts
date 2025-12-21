/**
 * Keybinding Adapter
 *
 * Connects the TUI client to the session service for keybinding management.
 */

import type { SessionService } from '../../../services/session/interface.ts';
import type { KeyBinding, ParsedKey, Unsubscribe } from '../../../services/session/types.ts';
import type { KeyEvent } from '../types.ts';

// ============================================
// Types
// ============================================

/**
 * Command handler function.
 */
export type CommandHandler = (args?: unknown) => void | Promise<void>;

/**
 * Context provider function.
 * Returns true if the context condition is met.
 */
export type ContextProvider = () => boolean;

/**
 * Default keybindings for the TUI client.
 */
export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // File operations
  { key: 'ctrl+s', command: 'file.save' },
  { key: 'ctrl+shift+s', command: 'file.saveAs' },
  { key: 'ctrl+o', command: 'file.open' },
  { key: 'ctrl+w', command: 'file.close' },
  { key: 'ctrl+n', command: 'file.new' },

  // Edit operations
  { key: 'ctrl+z', command: 'edit.undo' },
  { key: 'ctrl+shift+z', command: 'edit.redo' },
  { key: 'ctrl+y', command: 'edit.redo' },
  { key: 'ctrl+x', command: 'edit.cut' },
  { key: 'ctrl+c', command: 'edit.copy' },
  { key: 'ctrl+v', command: 'edit.paste' },
  { key: 'ctrl+a', command: 'edit.selectAll' },

  // Navigation
  { key: 'ctrl+g', command: 'editor.gotoLine' },
  { key: 'ctrl+p', command: 'quickOpen' },
  { key: 'ctrl+shift+p', command: 'commandPalette' },
  { key: 'ctrl+tab', command: 'editor.nextTab' },
  { key: 'ctrl+shift+tab', command: 'editor.previousTab' },

  // Search
  { key: 'ctrl+f', command: 'editor.find' },
  { key: 'ctrl+h', command: 'editor.findAndReplace' },
  { key: 'ctrl+shift+f', command: 'search.inFiles' },

  // View
  { key: 'ctrl+b', command: 'view.toggleSidebar' },
  { key: 'ctrl+`', command: 'view.toggleTerminal' },
  { key: 'ctrl+shift+e', command: 'view.focusFileExplorer' },
  { key: 'ctrl+shift+g', command: 'view.focusGit' },

  // Terminal
  { key: 'ctrl+shift+`', command: 'terminal.new' },

  // Splits
  { key: 'ctrl+\\', command: 'ultra.splitVertical' },
  { key: 'ctrl+shift+\\', command: 'ultra.splitHorizontal' },

  // Focus navigation
  { key: 'ctrl+1', command: 'focusGroup.1' },
  { key: 'ctrl+2', command: 'focusGroup.2' },
  { key: 'ctrl+3', command: 'focusGroup.3' },
  { key: 'ctrl+4', command: 'focusGroup.4' },

  // Misc
  { key: 'Escape', command: 'cancelAction' },
  { key: 'ctrl+q', command: 'quit' },
];

// ============================================
// Keybinding Adapter
// ============================================

export class KeybindingAdapter {
  private sessionService: SessionService | null = null;
  private commandHandlers = new Map<string, CommandHandler>();
  private contextProviders = new Map<string, ContextProvider>();
  private localBindings: KeyBinding[] = [...DEFAULT_KEYBINDINGS];

  /**
   * Connect to the session service.
   */
  connect(sessionService: SessionService): void {
    this.sessionService = sessionService;
  }

  /**
   * Disconnect from the session service.
   */
  disconnect(): void {
    this.sessionService = null;
  }

  /**
   * Register a command handler.
   */
  registerCommand(commandId: string, handler: CommandHandler): Unsubscribe {
    this.commandHandlers.set(commandId, handler);
    return () => {
      this.commandHandlers.delete(commandId);
    };
  }

  /**
   * Register multiple command handlers.
   */
  registerCommands(commands: Record<string, CommandHandler>): Unsubscribe {
    const unsubscribes: Unsubscribe[] = [];
    for (const [commandId, handler] of Object.entries(commands)) {
      unsubscribes.push(this.registerCommand(commandId, handler));
    }
    return () => {
      for (const unsub of unsubscribes) {
        unsub();
      }
    };
  }

  /**
   * Register a context provider for when clauses.
   */
  registerContext(contextKey: string, provider: ContextProvider): Unsubscribe {
    this.contextProviders.set(contextKey, provider);
    return () => {
      this.contextProviders.delete(contextKey);
    };
  }

  /**
   * Get all keybindings.
   */
  getKeybindings(): KeyBinding[] {
    if (this.sessionService) {
      return this.sessionService.getKeybindings();
    }
    return [...this.localBindings];
  }

  /**
   * Add a keybinding.
   */
  addKeybinding(binding: KeyBinding): void {
    if (this.sessionService) {
      this.sessionService.addKeybinding(binding);
    } else {
      this.localBindings.push(binding);
    }
  }

  /**
   * Remove a keybinding.
   */
  removeKeybinding(key: string): void {
    if (this.sessionService) {
      this.sessionService.removeKeybinding(key);
    } else {
      const index = this.localBindings.findIndex((b) => b.key === key);
      if (index !== -1) {
        this.localBindings.splice(index, 1);
      }
    }
  }

  /**
   * Get the binding for a command.
   */
  getBindingForCommand(commandId: string): string | null {
    if (this.sessionService) {
      return this.sessionService.getBindingForCommand(commandId);
    }

    const binding = this.localBindings.find((b) => b.command === commandId);
    return binding?.key ?? null;
  }

  /**
   * Handle a key event and execute the bound command.
   * Returns true if a command was executed.
   */
  handleKeyEvent(event: KeyEvent): boolean {
    const parsedKey = this.eventToParsedKey(event);
    const commandId = this.resolveBinding(parsedKey);

    if (!commandId) return false;

    const handler = this.commandHandlers.get(commandId);
    if (!handler) return false;

    // Find the binding to get args
    const binding = this.getKeybindings().find(
      (b) => this.parseKeyString(b.key) === this.keyToString(parsedKey) && b.command === commandId
    );

    // Execute the handler
    const result = handler(binding?.args);
    if (result instanceof Promise) {
      result.catch((err) => {
        console.error(`Error executing command ${commandId}:`, err);
      });
    }

    return true;
  }

  /**
   * Resolve a key press to a command ID.
   */
  resolveBinding(parsedKey: ParsedKey): string | null {
    if (this.sessionService) {
      return this.sessionService.resolveKeybinding(parsedKey);
    }

    const keyString = this.keyToString(parsedKey);

    for (const binding of this.localBindings) {
      const bindingKeyString = this.parseKeyString(binding.key);
      if (bindingKeyString === keyString) {
        // Check when clause
        if (binding.when && !this.evaluateWhen(binding.when)) {
          continue;
        }
        return binding.command;
      }
    }

    return null;
  }

  /**
   * Convert a KeyEvent to ParsedKey.
   */
  private eventToParsedKey(event: KeyEvent): ParsedKey {
    return {
      key: event.key,
      ctrl: event.ctrl,
      shift: event.shift,
      alt: event.alt,
      meta: event.meta,
    };
  }

  /**
   * Convert a ParsedKey to a normalized string.
   */
  private keyToString(key: ParsedKey): string {
    const modifiers: string[] = [];
    if (key.ctrl) modifiers.push('ctrl');
    if (key.shift) modifiers.push('shift');
    if (key.alt) modifiers.push('alt');
    if (key.meta) modifiers.push('meta');
    // Sort modifiers for consistent comparison with parseKeyString
    modifiers.sort();
    modifiers.push(key.key.toLowerCase());
    return modifiers.join('+');
  }

  /**
   * Parse a key binding string to a normalized string.
   */
  private parseKeyString(keyString: string): string {
    const parts = keyString.toLowerCase().split('+');
    const modifiers: string[] = [];
    let key = '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (['ctrl', 'cmd', 'control'].includes(trimmed)) {
        modifiers.push('ctrl');
      } else if (['shift'].includes(trimmed)) {
        modifiers.push('shift');
      } else if (['alt', 'option'].includes(trimmed)) {
        modifiers.push('alt');
      } else if (['meta', 'win', 'super'].includes(trimmed)) {
        modifiers.push('meta');
      } else {
        key = trimmed;
      }
    }

    // Sort modifiers for consistent comparison
    modifiers.sort();
    modifiers.push(key);
    return modifiers.join('+');
  }

  /**
   * Evaluate a when clause.
   */
  private evaluateWhen(when: string): boolean {
    // Simple when clause evaluation
    // Supports: contextKey, !contextKey, contextKey && contextKey

    const parts = when.split('&&').map((p) => p.trim());

    for (const part of parts) {
      let contextKey = part;
      let expected = true;

      if (contextKey.startsWith('!')) {
        contextKey = contextKey.slice(1);
        expected = false;
      }

      const provider = this.contextProviders.get(contextKey);
      if (provider) {
        const value = provider();
        if (value !== expected) return false;
      } else {
        // Unknown context key - treat as false
        if (expected) return false;
      }
    }

    return true;
  }

  /**
   * Format a key binding for display.
   */
  formatKeyBinding(key: string): string {
    return key
      .split('+')
      .map((part) => {
        const trimmed = part.trim();
        switch (trimmed.toLowerCase()) {
          case 'ctrl':
          case 'control':
          case 'cmd':
            return '⌃';
          case 'shift':
            return '⇧';
          case 'alt':
          case 'option':
            return '⌥';
          case 'meta':
          case 'super':
          case 'win':
            return '⌘';
          case 'enter':
            return '↵';
          case 'escape':
            return 'Esc';
          case 'backspace':
            return '⌫';
          case 'delete':
            return 'Del';
          case 'tab':
            return '⇥';
          case 'arrowup':
            return '↑';
          case 'arrowdown':
            return '↓';
          case 'arrowleft':
            return '←';
          case 'arrowright':
            return '→';
          default:
            return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
        }
      })
      .join('');
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a keybinding adapter.
 */
export function createKeybindingAdapter(): KeybindingAdapter {
  return new KeybindingAdapter();
}
