/**
 * Settings Schema
 *
 * Defines the schema for all settings with types, defaults, and validation rules.
 */

import type { SettingsSchema, SettingsSchemaProperty, ValidationResult } from './types.ts';
import type { EditorSettings } from '../../config/settings.ts';

/**
 * Complete settings schema with validation rules.
 */
export const settingsSchema: SettingsSchema = {
  properties: {
    // ─────────────────────────────────────────────────────────────────────────
    // Editor Settings
    // ─────────────────────────────────────────────────────────────────────────
    'editor.fontSize': {
      type: 'number',
      default: 14,
      minimum: 8,
      maximum: 72,
      description: 'Font size in pixels',
    },
    'editor.tabSize': {
      type: 'number',
      default: 2,
      minimum: 1,
      maximum: 16,
      description: 'Number of spaces per tab',
    },
    'editor.insertSpaces': {
      type: 'boolean',
      default: true,
      description: 'Insert spaces when pressing Tab',
    },
    'editor.autoIndent': {
      type: 'string',
      default: 'full',
      enum: ['none', 'keep', 'full'],
      description: 'Auto-indentation mode',
    },
    'editor.autoClosingBrackets': {
      type: 'string',
      default: 'always',
      enum: ['always', 'languageDefined', 'beforeWhitespace', 'never'],
      description: 'Auto-closing brackets behavior',
    },
    'editor.wordWrap': {
      type: 'string',
      default: 'off',
      enum: ['off', 'on', 'wordWrapColumn', 'bounded'],
      description: 'Word wrap mode',
    },
    'editor.lineNumbers': {
      type: 'string',
      default: 'on',
      enum: ['on', 'off', 'relative'],
      description: 'Line number display mode',
    },
    'editor.folding': {
      type: 'boolean',
      default: true,
      description: 'Enable code folding',
    },
    'editor.minimap.enabled': {
      type: 'boolean',
      default: true,
      description: 'Enable minimap',
    },
    'editor.minimap.width': {
      type: 'number',
      default: 10,
      minimum: 5,
      maximum: 50,
      description: 'Minimap width in characters',
    },
    'editor.minimap.showSlider': {
      type: 'string',
      default: 'always',
      enum: ['always', 'mouseover'],
      description: 'When to show the minimap slider',
    },
    'editor.minimap.maxColumn': {
      type: 'number',
      default: 120,
      minimum: 40,
      maximum: 300,
      description: 'Maximum column rendered in the minimap',
    },
    'editor.minimap.side': {
      type: 'string',
      default: 'right',
      enum: ['left', 'right'],
      description: 'Side where minimap is rendered',
    },
    'editor.renderWhitespace': {
      type: 'string',
      default: 'selection',
      enum: ['none', 'boundary', 'selection', 'trailing', 'all'],
      description: 'Whitespace rendering mode',
    },
    'editor.mouseWheelScrollSensitivity': {
      type: 'number',
      default: 3,
      minimum: 1,
      maximum: 10,
      description: 'Mouse wheel scroll sensitivity multiplier',
    },
    'editor.cursorBlinkRate': {
      type: 'number',
      default: 500,
      minimum: 100,
      maximum: 2000,
      description: 'Cursor blink rate in milliseconds',
    },
    'editor.scrollBeyondLastLine': {
      type: 'boolean',
      default: true,
      description: 'Allow scrolling past the last line',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Files Settings
    // ─────────────────────────────────────────────────────────────────────────
    'files.autoSave': {
      type: 'string',
      default: 'off',
      enum: ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'],
      description: 'Auto-save mode',
    },
    'files.exclude': {
      type: 'object',
      default: {
        '**/node_modules': true,
        '**/.git': true,
        '**/.DS_Store': true,
      },
      description: 'Glob patterns for files to exclude',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Workbench Settings
    // ─────────────────────────────────────────────────────────────────────────
    'workbench.colorTheme': {
      type: 'string',
      default: 'One Dark',
      description: 'Color theme to use',
    },
    'workbench.sideBar.visible': {
      type: 'boolean',
      default: true,
      description: 'Whether the sidebar is visible',
    },
    'workbench.sideBar.location': {
      type: 'string',
      default: 'left',
      enum: ['left', 'right'],
      description: 'Sidebar location',
    },
    'workbench.sideBar.focusedBackground': {
      type: 'string',
      default: '#2d3139',
      description: 'Background color when sidebar is focused',
    },
    'workbench.startupEditor': {
      type: 'string',
      default: '~/.ultra/BOOT.md',
      description: 'File to open on startup',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Ultra-specific Settings
    // ─────────────────────────────────────────────────────────────────────────
    'ultra.sidebar.width': {
      type: 'number',
      default: 30,
      minimum: 15,
      maximum: 80,
      description: 'Sidebar width in characters',
    },
    'ultra.ai.model': {
      type: 'string',
      default: 'claude-sonnet-4-20250514',
      description: 'AI model to use',
    },
    'ultra.ai.apiKey': {
      type: 'string',
      default: '${env:ANTHROPIC_API_KEY}',
      description: 'API key for AI service (supports ${env:VAR} syntax)',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Terminal Settings
    // ─────────────────────────────────────────────────────────────────────────
    'terminal.integrated.shell': {
      type: 'string',
      default: '/bin/zsh',
      description: 'Shell to use for the integrated terminal',
    },
    'terminal.integrated.position': {
      type: 'string',
      default: 'bottom',
      enum: ['bottom', 'top', 'left', 'right'],
      description: 'Terminal panel position',
    },
    'terminal.integrated.defaultHeight': {
      type: 'number',
      default: 12,
      minimum: 4,
      maximum: 50,
      description: 'Default terminal height in lines',
    },
    'terminal.integrated.defaultWidth': {
      type: 'number',
      default: 40,
      minimum: 20,
      maximum: 200,
      description: 'Default terminal width in columns',
    },
    'terminal.integrated.openOnStartup': {
      type: 'boolean',
      default: true,
      description: 'Open terminal on startup',
    },
    'terminal.integrated.spawnOnStartup': {
      type: 'boolean',
      default: true,
      description: 'Spawn shell process on startup',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Git Settings
    // ─────────────────────────────────────────────────────────────────────────
    'git.statusInterval': {
      type: 'number',
      default: 100,
      minimum: 50,
      maximum: 5000,
      description: 'Git status polling interval in milliseconds',
    },
    'git.panel.location': {
      type: 'string',
      default: 'sidebar-bottom',
      enum: ['sidebar-bottom', 'sidebar-top', 'panel'],
      description: 'Git panel location',
    },
    'git.panel.openOnStartup': {
      type: 'boolean',
      default: true,
      description: 'Open git panel on startup',
    },
    'git.diffContextLines': {
      type: 'number',
      default: 3,
      minimum: 0,
      maximum: 20,
      description: 'Number of context lines in diffs',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // AI Panel Settings
    // ─────────────────────────────────────────────────────────────────────────
    'ai.panel.defaultWidth': {
      type: 'number',
      default: 80,
      minimum: 40,
      maximum: 200,
      description: 'Default AI panel width in characters',
    },
    'ai.panel.maxWidthPercent': {
      type: 'number',
      default: 50,
      minimum: 20,
      maximum: 80,
      description: 'Maximum AI panel width as percentage of screen',
    },
    'ai.panel.openOnStartup': {
      type: 'boolean',
      default: true,
      description: 'Open AI panel on startup',
    },
    'ai.panel.initialPrompt': {
      type: 'string',
      default: 'You are a helpful software engineer working with another software engineer on a coding project using the Ultra IDE',
      description: 'Initial system prompt for AI',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Session Settings
    // ─────────────────────────────────────────────────────────────────────────
    'session.restoreOnStartup': {
      type: 'boolean',
      default: true,
      description: 'Restore previous session on startup',
    },
    'session.autoSave': {
      type: 'boolean',
      default: true,
      description: 'Auto-save session state',
    },
    'session.autoSaveInterval': {
      type: 'number',
      default: 30000,
      minimum: 5000,
      maximum: 300000,
      description: 'Auto-save interval in milliseconds',
    },
    'session.save.openFiles': {
      type: 'boolean',
      default: true,
      description: 'Save open files in session',
    },
    'session.save.cursorPositions': {
      type: 'boolean',
      default: true,
      description: 'Save cursor positions in session',
    },
    'session.save.scrollPositions': {
      type: 'boolean',
      default: true,
      description: 'Save scroll positions in session',
    },
    'session.save.foldState': {
      type: 'boolean',
      default: true,
      description: 'Save fold state in session',
    },
    'session.save.uiLayout': {
      type: 'boolean',
      default: true,
      description: 'Save UI layout in session',
    },
    'session.save.unsavedContent': {
      type: 'boolean',
      default: true,
      description: 'Save unsaved content in session',
    },
  },
};

/**
 * Get the default value for a setting.
 */
export function getDefaultValue<K extends keyof EditorSettings>(key: K): EditorSettings[K] {
  const prop = settingsSchema.properties[key];
  return prop?.default as EditorSettings[K];
}

/**
 * Get all default settings.
 */
export function getAllDefaults(): EditorSettings {
  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(settingsSchema.properties)) {
    defaults[key] = prop.default;
  }
  return defaults as unknown as EditorSettings;
}

/**
 * Validate a setting value.
 */
export function validateSetting(key: string, value: unknown): ValidationResult {
  const schema = settingsSchema.properties[key];

  // Unknown setting
  if (!schema) {
    return { valid: false, error: `Unknown setting: ${key}` };
  }

  // Type checking
  const valueType = Array.isArray(value) ? 'array' : typeof value;
  if (schema.type === 'object') {
    if (valueType !== 'object' || value === null || Array.isArray(value)) {
      return { valid: false, error: `Expected object, got ${valueType}` };
    }
  } else if (valueType !== schema.type) {
    return { valid: false, error: `Expected ${schema.type}, got ${valueType}` };
  }

  // Enum checking
  if (schema.enum && !schema.enum.includes(value)) {
    return { valid: false, error: `Must be one of: ${schema.enum.join(', ')}` };
  }

  // Range checking for numbers
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return { valid: false, error: `Minimum value is ${schema.minimum}` };
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return { valid: false, error: `Maximum value is ${schema.maximum}` };
    }
  }

  return { valid: true };
}

/**
 * Check if a setting key is valid.
 */
export function isValidSettingKey(key: string): key is keyof EditorSettings {
  return key in settingsSchema.properties;
}
