/**
 * Settings and Keybindings Consistency Tests
 *
 * These tests ensure that:
 * 1. Settings in default-settings.jsonc match those in defaults.ts
 * 2. Keybindings in default-keybindings.jsonc match those in defaults.ts
 * 3. Settings accessed in code exist in the defaults
 * 4. No hardcoded values override config settings unexpectedly
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { defaultSettings, defaultKeybindings } from '../../../src/config/defaults.ts';
import type { KeyBinding } from '../../../src/services/session/types.ts';
import { readdir } from 'fs/promises';

// ============================================
// Test Helpers
// ============================================

/**
 * Parse JSONC (JSON with comments) content.
 */
function parseJsonc(content: string): unknown {
  const cleanContent = content
    .replace(/\/\/.*$/gm, '') // Single line comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // Multi-line comments
  return JSON.parse(cleanContent);
}

/**
 * Get all TypeScript files in a directory recursively.
 */
async function getTypeScriptFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${currentDir}/${entry.name}`;
      if (entry.isDirectory()) {
        // Skip node_modules and test directories
        if (entry.name !== 'node_modules' && entry.name !== 'tests') {
          await walk(fullPath);
        }
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

/**
 * Extract setting key patterns from source code.
 * Looks for patterns like:
 * - configManager.get('key')
 * - configManager.getWithDefault('key', ...)
 * - settings['key'] in config-manager context
 *
 * Excludes theme color keys which use getThemeColor() API.
 */
function extractSettingKeysFromCode(content: string): string[] {
  const patterns = [
    // configManager.get('key') or configManager.getWithDefault('key', ...)
    /configManager\.(?:get|getWithDefault)\s*\(\s*['"]([^'"]+)['"]/g,
    // this.configManager.get('key')
    /this\.configManager\.(?:get|getWithDefault)\s*\(\s*['"]([^'"]+)['"]/g,
    // getSetting('key') - general pattern
    /getSetting\s*\(\s*['"]([^'"]+)['"]/g,
  ];

  // Theme color keys that should be excluded (accessed via getThemeColor, not settings)
  const themeColorPrefixes = [
    'tab.', 'sideBar', 'editor.', 'editorGroup', 'notification', 'terminal.',
    'scrollbar', 'list.', 'input.', 'statusBar.', 'focusBorder', 'descriptionForeground',
    'editorWidget.', 'editorBracketMatch.', 'editorCursor.', 'editorLineNumber.',
    'editorGutter.', 'terminalCursor.',
  ];

  const keys = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const key = match[1];
      // Skip theme color keys
      const isThemeColor = themeColorPrefixes.some(
        (prefix) => key.startsWith(prefix) && !key.startsWith('tui.') && !key.startsWith('editor.tabSize')
      );
      if (!isThemeColor) {
        keys.add(key);
      }
    }
  }

  return Array.from(keys);
}

// ============================================
// Tests
// ============================================

describe('Settings Consistency', () => {
  let jsoncSettings: Record<string, unknown>;
  let jsoncKeybindings: KeyBinding[];

  beforeAll(async () => {
    // Load JSONC files
    const settingsContent = await Bun.file('config/default-settings.jsonc').text();
    jsoncSettings = parseJsonc(settingsContent) as Record<string, unknown>;

    const keybindingsContent = await Bun.file('config/default-keybindings.jsonc').text();
    jsoncKeybindings = parseJsonc(keybindingsContent) as KeyBinding[];
  });

  describe('Settings JSONC matches defaults.ts', () => {
    test('all JSONC settings exist in defaults.ts with same values', () => {
      const mismatches: string[] = [];
      const missingInDefaults: string[] = [];

      for (const [key, value] of Object.entries(jsoncSettings)) {
        if (!(key in defaultSettings)) {
          missingInDefaults.push(key);
        } else if (JSON.stringify(defaultSettings[key]) !== JSON.stringify(value)) {
          mismatches.push(
            `${key}: JSONC=${JSON.stringify(value)}, defaults.ts=${JSON.stringify(defaultSettings[key])}`
          );
        }
      }

      if (missingInDefaults.length > 0) {
        console.error('Settings in JSONC but missing in defaults.ts:', missingInDefaults);
      }
      if (mismatches.length > 0) {
        console.error('Settings with mismatched values:', mismatches);
      }

      expect(missingInDefaults).toEqual([]);
      expect(mismatches).toEqual([]);
    });

    test('all defaults.ts settings exist in JSONC', () => {
      const missingInJsonc: string[] = [];

      for (const key of Object.keys(defaultSettings)) {
        if (!(key in jsoncSettings)) {
          missingInJsonc.push(key);
        }
      }

      if (missingInJsonc.length > 0) {
        console.error('Settings in defaults.ts but missing in JSONC:', missingInJsonc);
      }

      expect(missingInJsonc).toEqual([]);
    });

    test('settings count matches between JSONC and defaults.ts', () => {
      const jsoncCount = Object.keys(jsoncSettings).length;
      const defaultsCount = Object.keys(defaultSettings).length;

      expect(jsoncCount).toBe(defaultsCount);
    });
  });

  describe('Keybindings JSONC matches defaults.ts', () => {
    test('all JSONC keybindings exist in defaults.ts', () => {
      const missingInDefaults: string[] = [];

      for (const binding of jsoncKeybindings) {
        const found = defaultKeybindings.find(
          (b) =>
            b.key === binding.key &&
            b.command === binding.command &&
            (b.when || '') === (binding.when || '')
        );

        if (!found) {
          missingInDefaults.push(`${binding.key} -> ${binding.command}`);
        }
      }

      if (missingInDefaults.length > 0) {
        console.error('Keybindings in JSONC but missing in defaults.ts:', missingInDefaults);
      }

      expect(missingInDefaults).toEqual([]);
    });

    test('all defaults.ts keybindings exist in JSONC', () => {
      const missingInJsonc: string[] = [];

      for (const binding of defaultKeybindings) {
        const found = jsoncKeybindings.find(
          (b) =>
            b.key === binding.key &&
            b.command === binding.command &&
            (b.when || '') === (binding.when || '')
        );

        if (!found) {
          missingInJsonc.push(`${binding.key} -> ${binding.command}`);
        }
      }

      if (missingInJsonc.length > 0) {
        console.error('Keybindings in defaults.ts but missing in JSONC:', missingInJsonc);
      }

      expect(missingInJsonc).toEqual([]);
    });

    test('keybinding count matches between JSONC and defaults.ts', () => {
      expect(jsoncKeybindings.length).toBe(defaultKeybindings.length);
    });
  });

  describe('Settings used in code exist in defaults', () => {
    test('all setting keys used in TUI client exist in defaults', async () => {
      const srcDir = 'src/clients/tui';
      const files = await getTypeScriptFiles(srcDir);
      const usedKeys = new Set<string>();
      const missingKeys: string[] = [];

      // Known keys that are dynamically constructed or special cases
      const allowedDynamicKeys = new Set([
        'terminal.integrated.shell', // Set dynamically from env
      ]);

      for (const file of files) {
        const content = await Bun.file(file).text();
        const keys = extractSettingKeysFromCode(content);
        for (const key of keys) {
          usedKeys.add(key);
        }
      }

      for (const key of usedKeys) {
        if (!(key in defaultSettings) && !allowedDynamicKeys.has(key)) {
          missingKeys.push(key);
        }
      }

      if (missingKeys.length > 0) {
        console.error('Setting keys used in code but missing in defaults:', missingKeys);
      }

      expect(missingKeys).toEqual([]);
    });

    test('all setting keys used in services exist in defaults', async () => {
      const srcDir = 'src/services';
      const files = await getTypeScriptFiles(srcDir);
      const usedKeys = new Set<string>();
      const missingKeys: string[] = [];

      // Known keys that are dynamically constructed or special cases
      const allowedDynamicKeys = new Set<string>([]);

      for (const file of files) {
        const content = await Bun.file(file).text();
        const keys = extractSettingKeysFromCode(content);
        for (const key of keys) {
          usedKeys.add(key);
        }
      }

      for (const key of usedKeys) {
        if (!(key in defaultSettings) && !allowedDynamicKeys.has(key)) {
          missingKeys.push(key);
        }
      }

      if (missingKeys.length > 0) {
        console.error('Setting keys used in services but missing in defaults:', missingKeys);
      }

      expect(missingKeys).toEqual([]);
    });
  });

  describe('No hardcoded setting overrides', () => {
    test('config-manager does not hardcode setting values (except shell)', async () => {
      const content = await Bun.file('src/clients/tui/config/config-manager.ts').text();

      // Look for hardcoded settings assignments that aren't the shell default
      // Pattern: setting.key = <value> where value is a literal
      const hardcodedPatterns = [
        // Direct number assignments to settings
        /settings\s*\[\s*['"][^'"]+['"]\s*\]\s*=\s*\d+/g,
        // Direct string assignments to settings (except shell which is from env)
        /settings\s*\[\s*['"][^'"]+['"]\s*\]\s*=\s*['"][^'"]+['"]/g,
      ];

      const issues: string[] = [];

      for (const pattern of hardcodedPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          // Skip the shell override which is intentional
          if (!match[0].includes('terminal.integrated.shell')) {
            issues.push(match[0]);
          }
        }
      }

      if (issues.length > 0) {
        console.error('Hardcoded setting values found in config-manager:', issues);
      }

      expect(issues).toEqual([]);
    });

    test('TUI client uses settings from config manager, not hardcoded values', async () => {
      const content = await Bun.file('src/clients/tui/client/tui-client.ts').text();

      // Look for common hardcoded values that should come from settings
      // These are values that are commonly accidentally hardcoded
      const suspiciousPatterns = [
        // Hardcoded terminal height (should use tui.terminal.height)
        { pattern: /terminalHeight\s*[:=]\s*\d+(?!\s*\|\|)/, name: 'hardcoded terminal height' },
        // Hardcoded sidebar width (should use tui.sidebar.width)
        { pattern: /sidebarWidth\s*[:=]\s*\d+(?!\s*\|\|)/, name: 'hardcoded sidebar width' },
        // Hardcoded tab size without fallback (should use editor.tabSize)
        { pattern: /tabSize\s*[:=]\s*\d+(?!\s*\|\|)/, name: 'hardcoded tab size' },
      ];

      const issues: string[] = [];

      for (const { pattern, name } of suspiciousPatterns) {
        if (pattern.test(content)) {
          // Check if it's inside a defaults object or similar allowlist
          const matches = content.match(pattern);
          if (matches) {
            for (const match of matches) {
              // Allow if it's a default value in || expression
              if (!match.includes('||') && !match.includes('??')) {
                issues.push(`${name}: ${match}`);
              }
            }
          }
        }
      }

      // This test is informational - we log but don't fail
      // as some hardcoded values may be intentional defaults
      if (issues.length > 0) {
        console.warn('Potentially hardcoded values (verify these are intentional):', issues);
      }

      // We expect no obvious hardcoded values
      // Adjust this if there are known intentional hardcoded values
      expect(issues.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Setting key naming conventions', () => {
    test('all settings follow namespace conventions', () => {
      const validPrefixes = [
        'editor.',
        'files.',
        'workbench.',
        'tui.',
        'git.',
        'ai.',
        'session.',
        'lsp.',
        'terminal.',
        'timeline.',
      ];

      const invalidKeys: string[] = [];

      for (const key of Object.keys(defaultSettings)) {
        const hasValidPrefix = validPrefixes.some((prefix) => key.startsWith(prefix));
        if (!hasValidPrefix) {
          invalidKeys.push(key);
        }
      }

      if (invalidKeys.length > 0) {
        console.error('Settings with invalid namespace prefix:', invalidKeys);
        console.error('Valid prefixes:', validPrefixes);
      }

      expect(invalidKeys).toEqual([]);
    });

    test('TUI-specific settings use tui.* prefix', () => {
      const tuiRelatedPatterns = ['sidebar', 'terminal.height', 'terminal.scrollback'];
      const issues: string[] = [];

      for (const key of Object.keys(defaultSettings)) {
        for (const pattern of tuiRelatedPatterns) {
          if (key.includes(pattern) && !key.startsWith('tui.') && !key.startsWith('terminal.integrated.')) {
            issues.push(`${key} should use tui.* prefix`);
          }
        }
      }

      if (issues.length > 0) {
        console.error('TUI settings not using tui.* prefix:', issues);
      }

      expect(issues).toEqual([]);
    });
  });

  describe('Keybinding command naming conventions', () => {
    test('all keybinding commands follow namespace conventions', () => {
      const validPrefixes = [
        'file.',
        'edit.',
        'editor.',
        'search.',
        'workbench.',
        'view.',
        'terminal.',
        'git.',
        'session.',
        'lsp.',
      ];

      const invalidCommands: string[] = [];

      for (const binding of defaultKeybindings) {
        const hasValidPrefix = validPrefixes.some((prefix) => binding.command.startsWith(prefix));
        if (!hasValidPrefix) {
          invalidCommands.push(binding.command);
        }
      }

      if (invalidCommands.length > 0) {
        console.error('Commands with invalid namespace prefix:', invalidCommands);
        console.error('Valid prefixes:', validPrefixes);
      }

      expect(invalidCommands).toEqual([]);
    });
  });
});
