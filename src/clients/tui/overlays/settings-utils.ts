/**
 * Settings Utilities
 *
 * Helper functions for type inference and enum options for settings.
 */

import type { SettingItem } from './settings-dialog.ts';

// ============================================
// Type Definitions
// ============================================

export type SettingType = 'string' | 'number' | 'boolean' | 'enum' | 'object';

/**
 * Known enum settings with their valid options.
 * These are extracted from the EditorSettings interface in settings.ts.
 */
export const ENUM_OPTIONS: Record<string, string[]> = {
  // Editor enums
  'editor.autoIndent': ['none', 'keep', 'full'],
  'editor.autoClosingBrackets': ['always', 'languageDefined', 'beforeWhitespace', 'never'],
  'editor.wordWrap': ['off', 'on', 'wordWrapColumn', 'bounded'],
  'editor.lineNumbers': ['on', 'off', 'relative'],
  'editor.minimap.showSlider': ['always', 'mouseover'],
  'editor.minimap.side': ['left', 'right'],
  'editor.renderWhitespace': ['none', 'boundary', 'selection', 'trailing', 'all'],

  // Files enums
  'files.autoSave': ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'],
  'files.watchFiles': ['onFocus', 'always', 'off'],

  // Workbench enums
  'tui.sidebar.location': ['left', 'right'],

  // Terminal enums
  'terminal.integrated.position': ['bottom', 'top', 'left', 'right'],

  // Git enums
  'git.panel.location': ['sidebar-bottom', 'sidebar-top', 'panel'],

  // AI enums
  'ai.defaultProvider': ['claude-code', 'codex', 'gemini'],

  // LSP enums
  'lsp.signatureHelp.display': ['popup', 'inline', 'statusBar'],

  // TUI enums
  'tui.diffViewer.editMode': ['stage-modified', 'save-only', 'auto-stage'],
  'tui.timeline.mode': ['file', 'repo'],
};

/**
 * Settings that should use multiline text input.
 */
export const MULTILINE_SETTINGS: Set<string> = new Set([
  'ai.panel.initialPrompt',
]);

/**
 * Settings descriptions extracted from JSONC comments.
 * These provide context for each setting.
 */
export const SETTING_DESCRIPTIONS: Record<string, string> = {
  // Editor
  'editor.fontSize': 'Font size in pixels',
  'editor.tabSize': 'Number of spaces per tab',
  'editor.insertSpaces': 'Use spaces instead of tabs',
  'editor.autoIndent': 'Auto-indent mode',
  'editor.autoClosingBrackets': 'Auto-close brackets mode',
  'editor.wordWrap': 'Word wrap mode',
  'editor.lineNumbers': 'Line numbers mode',
  'editor.folding': 'Enable code folding',
  'editor.renderWhitespace': 'Show whitespace mode',
  'editor.mouseWheelScrollSensitivity': 'Scroll speed multiplier (1-10)',
  'editor.cursorBlinkRate': 'Cursor blink interval in milliseconds',
  'editor.scrollBeyondLastLine': 'Allow scrolling past the last line',
  'editor.diagnostics.curlyUnderline': 'Use squiggly underlines for errors',
  'editor.undoHistoryLimit': 'Maximum undo actions per document',

  // Minimap
  'editor.minimap.enabled': 'Show the minimap',
  'editor.minimap.width': 'Minimap width in characters',
  'editor.minimap.showSlider': 'Slider visibility mode',
  'editor.minimap.maxColumn': 'Maximum column to render',
  'editor.minimap.side': 'Minimap position',

  // Files
  'files.autoSave': 'Auto-save mode',
  'files.watchFiles': 'Watch for external changes',
  'files.exclude': 'Patterns to exclude from file tree',

  // Workbench
  'workbench.colorTheme': 'Color theme name',
  'workbench.startupEditor': 'File to open on startup (empty for none)',

  // TUI Sidebar
  'tui.sidebar.width': 'Sidebar width in characters',
  'tui.sidebar.visible': 'Sidebar visibility',
  'tui.sidebar.location': 'Sidebar position (left or right)',
  'tui.sidebar.focusedBackground': 'Sidebar focused item background color',
  'tui.terminal.height': 'Terminal panel height in rows',
  'tui.terminal.scrollback': 'Terminal scrollback buffer size in lines',
  'tui.tabBar.scrollAmount': 'Number of tabs to scroll when using scroll buttons',

  // TUI Diff Viewer
  'tui.diffViewer.autoRefresh': 'Auto-refresh diff when file changes',
  'tui.diffViewer.showDiagnostics': 'Show diagnostics in diff viewer',
  'tui.diffViewer.editMode': 'Edit save mode',

  // TUI Outline
  'tui.outline.collapsedOnStartup': 'Collapse outline panel on startup',
  'tui.outline.autoFollow': 'Auto-follow cursor position in outline',

  // TUI Timeline
  'tui.timeline.collapsedOnStartup': 'Collapse timeline panel on startup',
  'tui.timeline.mode': 'Timeline mode: file (current file) or repo (all commits)',
  'tui.timeline.commitCount': 'Number of commits to show in timeline',

  // Git
  'git.statusInterval': 'Git status refresh interval in milliseconds',
  'git.panel.location': 'Git panel location',
  'git.panel.openOnStartup': 'Show git panel on startup',
  'git.diffContextLines': 'Context lines in diffs',
  'git.inlineDiff.maxHeight': 'Max height of inline diff expander in lines',
  'git.inlineDiff.contextLines': 'Context lines in inline diffs',

  // AI
  'ai.defaultProvider': 'Default AI provider',
  'ai.panel.defaultWidth': 'AI panel width in characters',
  'ai.panel.maxWidthPercent': 'Maximum AI panel width as percentage of screen',
  'ai.panel.openOnStartup': 'Open AI panel on startup',
  'ai.panel.initialPrompt': 'System prompt for AI',

  // Session
  'session.restoreOnStartup': 'Restore previous session on startup',
  'session.autoSave': 'Auto-save session state',
  'session.autoSaveInterval': 'Auto-save interval in milliseconds',
  'session.save.openFiles': 'Save open files in session',
  'session.save.cursorPositions': 'Save cursor positions in session',
  'session.save.scrollPositions': 'Save scroll positions in session',
  'session.save.foldState': 'Save fold state in session',
  'session.save.uiLayout': 'Save UI layout in session',
  'session.save.unsavedContent': 'Save unsaved content in session',

  // LSP
  'lsp.enabled': 'Enable language server features',
  'lsp.completionDebounceMs': 'Delay before triggering completion (ms)',
  'lsp.triggerCharacters': 'Characters that trigger completion',
  'lsp.hover.enabled': 'Show hover information',
  'lsp.signatureHelp.enabled': 'Show function signature help',
  'lsp.signatureHelp.display': 'Signature display mode',
  'lsp.diagnostics.enabled': 'Show diagnostics (errors, warnings)',
  'lsp.diagnostics.showInGutter': 'Show diagnostic icons in gutter',
  'lsp.diagnostics.underlineErrors': 'Underline errors in editor',
  'lsp.diagnostics.delay': 'Delay before showing diagnostics (ms)',
};

// ============================================
// Type Inference Functions
// ============================================

/**
 * Infer the setting type from the key and value.
 */
export function inferSettingType(key: string, value: unknown): SettingType {
  // Check if it's a known enum
  if (key in ENUM_OPTIONS) {
    return 'enum';
  }

  // Infer from value type
  if (typeof value === 'boolean') {
    return 'boolean';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'object' && value !== null) {
    return 'object';
  }

  return 'string';
}

/**
 * Get enum options for a setting key.
 */
export function getEnumOptions(key: string): string[] | null {
  return ENUM_OPTIONS[key] ?? null;
}

/**
 * Get description for a setting key.
 */
export function getSettingDescription(key: string): string | undefined {
  return SETTING_DESCRIPTIONS[key];
}

/**
 * Check if a setting should use multiline input.
 */
export function isMultilineSetting(key: string): boolean {
  return MULTILINE_SETTINGS.has(key);
}

/**
 * Get the category from a setting key.
 */
export function getSettingCategory(key: string): string {
  const parts = key.split('.');
  return parts[0] ?? 'other';
}

/**
 * Build a SettingItem from key/value with full type information.
 */
export function buildSettingItem(
  key: string,
  value: unknown,
  defaultValue: unknown
): SettingItem {
  const type = inferSettingType(key, value);
  return {
    key,
    value,
    defaultValue,
    type,
    description: getSettingDescription(key),
    enumOptions: type === 'enum' ? getEnumOptions(key) ?? undefined : undefined,
    category: getSettingCategory(key),
  };
}

/**
 * Parse a string value to the appropriate type.
 */
export function parseSettingValue(key: string, stringValue: string, currentType: SettingType): unknown {
  switch (currentType) {
    case 'boolean':
      return stringValue.toLowerCase() === 'true';
    case 'number': {
      const num = parseFloat(stringValue);
      return isNaN(num) ? 0 : num;
    }
    case 'object':
      try {
        return JSON.parse(stringValue);
      } catch {
        return {};
      }
    case 'enum':
    case 'string':
    default:
      return stringValue;
  }
}

/**
 * Validate a number setting is within reasonable bounds.
 */
export function validateNumberSetting(key: string, value: number): { valid: boolean; message?: string } {
  // Define bounds for specific settings
  const bounds: Record<string, { min?: number; max?: number }> = {
    'editor.fontSize': { min: 6, max: 72 },
    'editor.tabSize': { min: 1, max: 16 },
    'editor.mouseWheelScrollSensitivity': { min: 1, max: 10 },
    'editor.cursorBlinkRate': { min: 100, max: 2000 },
    'editor.undoHistoryLimit': { min: 10, max: 10000 },
    'editor.minimap.width': { min: 5, max: 30 },
    'editor.minimap.maxColumn': { min: 40, max: 300 },
    'tui.sidebar.width': { min: 15, max: 100 },
    'tui.terminal.height': { min: 5, max: 50 },
    'tui.terminal.scrollback': { min: 100, max: 100000 },
    'tui.tabBar.scrollAmount': { min: 1, max: 10 },
    'tui.timeline.commitCount': { min: 10, max: 500 },
    'git.statusInterval': { min: 100, max: 60000 },
    'git.diffContextLines': { min: 0, max: 20 },
    'git.inlineDiff.maxHeight': { min: 3, max: 50 },
    'git.inlineDiff.contextLines': { min: 0, max: 10 },
    'ai.panel.defaultWidth': { min: 30, max: 200 },
    'ai.panel.maxWidthPercent': { min: 10, max: 90 },
    'session.autoSaveInterval': { min: 5000, max: 300000 },
    'lsp.completionDebounceMs': { min: 0, max: 1000 },
    'lsp.diagnostics.delay': { min: 0, max: 5000 },
  };

  const bound = bounds[key];
  if (!bound) {
    return { valid: true };
  }

  if (bound.min !== undefined && value < bound.min) {
    return { valid: false, message: `Value must be at least ${bound.min}` };
  }

  if (bound.max !== undefined && value > bound.max) {
    return { valid: false, message: `Value must be at most ${bound.max}` };
  }

  return { valid: true };
}
