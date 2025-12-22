/**
 * Keybindings Loader
 * 
 * Loads and parses VS Code compatible keybindings.json files.
 */

import type { KeyBinding } from './keymap.ts';

export interface RawKeybinding {
  key: string;
  command: string;
  when?: string;
  args?: any;
}

export class KeybindingsLoader {
  /**
   * Load keybindings from a file path
   */
  async loadFromFile(filePath: string): Promise<KeyBinding[]> {
    try {
      const file = Bun.file(filePath);
      const content = await file.text();
      return this.parse(content);
    } catch (error) {
      // Silently fail for $bunfs paths (expected in compiled binaries)
      if (!filePath.includes('$bunfs')) {
        console.error(`Failed to load keybindings from ${filePath}:`, error);
      }
      return [];
    }
  }

  /**
   * Parse keybindings JSON content
   */
  parse(content: string): KeyBinding[] {
    try {
      // Remove comments (simple JSON with comments support)
      const cleanContent = content
        .replace(/\/\/.*$/gm, '')  // Single line comments
        .replace(/\/\*[\s\S]*?\*\//g, '');  // Multi-line comments

      const raw: RawKeybinding[] = JSON.parse(cleanContent);
      
      return raw.map(binding => this.normalizeBinding(binding));
    } catch (error) {
      console.error('Failed to parse keybindings:', error);
      return [];
    }
  }

  /**
   * Normalize a raw keybinding
   */
  private normalizeBinding(raw: RawKeybinding): KeyBinding {
    return {
      key: this.normalizeKey(raw.key),
      command: raw.command,
      when: raw.when,
      args: raw.args
    };
  }

  /**
   * Normalize a key string to our internal format
   */
  private normalizeKey(key: string): string {
    return key
      .toLowerCase()
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace('command', 'cmd')
      .replace('control', 'ctrl')
      .replace('option', 'alt')
      .replace('meta', 'cmd');  // meta -> cmd on macOS
  }

  /**
   * Merge multiple keybinding sources with later ones overriding earlier
   */
  merge(...sources: KeyBinding[][]): KeyBinding[] {
    const bindingMap = new Map<string, KeyBinding>();
    
    for (const source of sources) {
      for (const binding of source) {
        // Later bindings override earlier ones
        bindingMap.set(binding.key, binding);
      }
    }
    
    return Array.from(bindingMap.values());
  }
}

export const keybindingsLoader = new KeybindingsLoader();

export default keybindingsLoader;
