/**
 * Application Constants
 *
 * Centralized constants for timeouts, cache TTLs, UI dimensions,
 * and other magic numbers used throughout the application.
 *
 * Benefits:
 * - Single source of truth for configuration values
 * - Easy to adjust behavior without hunting through code
 * - Self-documenting with JSDoc comments
 * - Type-safe access via TypeScript const assertions
 */

// ==================== Cache Configuration ====================

/**
 * Cache time-to-live values in milliseconds
 */
export const CACHE = {
  /** Git status cache TTL (5 seconds) */
  GIT_STATUS_TTL: 5000,

  /** Git line changes cache TTL (5 seconds) */
  GIT_LINE_CHANGES_TTL: 5000,

  /** Theme color cache TTL (60 seconds) */
  THEME_TTL: 60000,

  /** Syntax highlight cache TTL (30 seconds) */
  SYNTAX_HIGHLIGHT_TTL: 30000,

  /** File search index cache TTL (60 seconds) */
  FILE_SEARCH_TTL: 60000,
} as const;

// ==================== Timeouts ====================

/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  /** LSP request timeout (30 seconds) */
  LSP_REQUEST: 30000,

  /** LSP initialization timeout (60 seconds) */
  LSP_INIT: 60000,

  /** Default debounce delay for user input (100ms) */
  DEBOUNCE_DEFAULT: 100,

  /** Debounce delay for document changes (150ms) */
  DEBOUNCE_DOCUMENT: 150,

  /** Key chord timeout (500ms) - time to wait for second key */
  CHORD_KEY: 500,

  /** Status bar message auto-hide (5 seconds) */
  STATUS_MESSAGE: 5000,

  /** Git polling interval (5 seconds) */
  GIT_POLL_INTERVAL: 5000,

  /** File watcher debounce (100ms) */
  FILE_WATCH_DEBOUNCE: 100,

  /** Autocomplete popup delay (100ms) */
  AUTOCOMPLETE_DELAY: 100,

  /** Hover tooltip delay (500ms) */
  HOVER_DELAY: 500,

  /** Double-click threshold (300ms) */
  DOUBLE_CLICK: 300,

  /** Triple-click threshold (500ms) */
  TRIPLE_CLICK: 500,
} as const;

// ==================== Rendering ====================

/**
 * Rendering-related constants
 */
export const RENDER = {
  /** Output chunk size for buffered writes (16KB) */
  CHUNK_SIZE: 16384,

  /** Default lines to scroll per wheel event */
  SCROLL_LINES: 3,

  /** Minimap width in characters */
  MINIMAP_WIDTH: 10,

  /** Minimap lines per row (compression ratio) */
  MINIMAP_LINES_PER_ROW: 2,

  /** Maximum lines to render in a single frame */
  MAX_RENDER_LINES: 1000,

  /** Viewport padding (lines above/below cursor to keep visible) */
  VIEWPORT_PADDING: 5,
} as const;

// ==================== UI Dimensions ====================

/**
 * Default UI element dimensions
 */
export const UI = {
  /** Default tab size in spaces */
  DEFAULT_TAB_SIZE: 2,

  /** Minimum gutter width (line numbers) */
  MIN_GUTTER_WIDTH: 4,

  /** Maximum gutter width */
  MAX_GUTTER_WIDTH: 8,

  /** Tab bar height in lines */
  TAB_BAR_HEIGHT: 1,

  /** Status bar height in lines */
  STATUS_BAR_HEIGHT: 1,

  /** Default sidebar width */
  DEFAULT_SIDEBAR_WIDTH: 30,

  /** Minimum sidebar width */
  MIN_SIDEBAR_WIDTH: 20,

  /** Maximum sidebar width */
  MAX_SIDEBAR_WIDTH: 60,

  /** Default terminal height (as percentage of screen) */
  DEFAULT_TERMINAL_HEIGHT_PERCENT: 30,

  /** Minimum terminal height in lines */
  MIN_TERMINAL_HEIGHT: 5,

  /** Dialog padding (internal) */
  DIALOG_PADDING: 2,

  /** Dialog minimum width */
  DIALOG_MIN_WIDTH: 40,

  /** Command palette width */
  COMMAND_PALETTE_WIDTH: 70,

  /** Command palette height */
  COMMAND_PALETTE_HEIGHT: 20,

  /** File picker width */
  FILE_PICKER_WIDTH: 80,

  /** File picker height */
  FILE_PICKER_HEIGHT: 24,

  /** Pane divider width */
  PANE_DIVIDER_WIDTH: 1,
} as const;

// ==================== Editor Defaults ====================

/**
 * Default editor settings
 */
export const EDITOR_DEFAULTS = {
  /** Default font size (not used in terminal, but for config) */
  FONT_SIZE: 14,

  /** Line height multiplier */
  LINE_HEIGHT: 1.5,

  /** Cursor blink rate in ms (0 = no blink) */
  CURSOR_BLINK_RATE: 530,

  /** Max line length before soft wrap (0 = no wrap) */
  WORD_WRAP_COLUMN: 0,

  /** Number of recent files to remember */
  MAX_RECENT_FILES: 20,

  /** Maximum undo stack depth */
  MAX_UNDO_STACK: 1000,

  /** Characters considered word boundaries */
  WORD_SEPARATORS: '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?',

  /** Auto-closing bracket pairs */
  BRACKET_PAIRS: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
    ["'", "'"],
    ['`', '`'],
  ] as const,
} as const;

// ==================== Git Configuration ====================

/**
 * Git-related constants
 */
export const GIT = {
  /** Default context lines for diffs */
  DIFF_CONTEXT_LINES: 3,

  /** Maximum commits to show in log */
  MAX_LOG_COMMITS: 100,

  /** Default remote name */
  DEFAULT_REMOTE: 'origin',
} as const;

// ==================== File System ====================

/**
 * File system related constants
 */
export const FS = {
  /** Maximum file size to open (10MB) */
  MAX_FILE_SIZE: 10 * 1024 * 1024,

  /** Maximum files to index for search */
  MAX_INDEX_FILES: 50000,

  /** File extensions to always ignore */
  ALWAYS_IGNORE: [
    '.git',
    'node_modules',
    '.DS_Store',
    '*.swp',
    '*.swo',
    '.env.local',
    '.env.*.local',
  ] as const,
} as const;

// ==================== LSP Configuration ====================

/**
 * Language Server Protocol constants
 */
export const LSP = {
  /** Maximum completion items to request */
  MAX_COMPLETIONS: 100,

  /** Maximum diagnostics to show per file */
  MAX_DIAGNOSTICS: 100,

  /** Debounce delay for sending document changes */
  CHANGE_DEBOUNCE: 150,
} as const;

// ==================== Key Codes ====================

/**
 * Common key code constants (for reference)
 */
export const KEYS = {
  ESCAPE: 'ESCAPE',
  ENTER: 'ENTER',
  TAB: 'TAB',
  BACKSPACE: 'BACKSPACE',
  DELETE: 'DELETE',
  UP: 'UP',
  DOWN: 'DOWN',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  HOME: 'HOME',
  END: 'END',
  PAGEUP: 'PAGEUP',
  PAGEDOWN: 'PAGEDOWN',
  INSERT: 'INSERT',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
} as const;

// ==================== Export All ====================

/**
 * All constants grouped
 */
export default {
  CACHE,
  TIMEOUTS,
  RENDER,
  UI,
  EDITOR_DEFAULTS,
  GIT,
  FS,
  LSP,
  KEYS,
} as const;
