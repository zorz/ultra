/**
 * Session Service Types
 *
 * Type definitions for settings, sessions, keybindings, and themes.
 */

/**
 * Re-export EditorSettings from config for convenience.
 */
export type { EditorSettings } from '../../config/settings.ts';

/**
 * Session state for a terminal in a pane.
 */
export interface SessionTerminalState {
  /** Element ID */
  elementId: string;
  /** Pane ID where terminal is open */
  paneId: string;
  /** Tab order within pane (0-indexed) */
  tabOrder: number;
  /** Whether this tab is active in its pane */
  isActiveInPane: boolean;
  /** Working directory for the terminal */
  cwd: string;
  /** Terminal title */
  title: string;
}

/**
 * AI provider type for AI chat sessions.
 */
export type AIProvider = 'claude-code' | 'codex' | 'gemini' | 'custom';

/**
 * Session state for an AI chat in a pane.
 */
export interface SessionAIChatState {
  /** Element ID */
  elementId: string;
  /** Pane ID where AI chat is open */
  paneId: string;
  /** Tab order within pane (0-indexed) */
  tabOrder: number;
  /** Whether this tab is active in its pane */
  isActiveInPane: boolean;
  /** AI provider (claude-code, codex, etc.) */
  provider: AIProvider;
  /** Session ID for resume (Claude --resume support) */
  sessionId: string | null;
  /** Working directory for the AI chat */
  cwd: string;
  /** Chat title */
  title: string;
}

/**
 * Re-export SerializedUndoState from core undo module for session persistence.
 */
import type { SerializedUndoState } from '../../core/undo.ts';
export type { SerializedUndoState } from '../../core/undo.ts';

/**
 * Session state for a single document.
 */
export interface SessionDocumentState {
  /** Absolute file path */
  filePath: string;
  /** Scroll position (line number) */
  scrollTop: number;
  /** Horizontal scroll position */
  scrollLeft: number;
  /** Primary cursor line */
  cursorLine: number;
  /** Primary cursor column */
  cursorColumn: number;
  /** Selection anchor (if any) */
  selectionAnchorLine?: number;
  selectionAnchorColumn?: number;
  /** Folded line numbers */
  foldedRegions: number[];
  /** Pane ID where document is open */
  paneId: string;
  /** Tab order within pane (0-indexed) */
  tabOrder: number;
  /** Whether this tab is active in its pane */
  isActiveInPane: boolean;
  /** Unsaved content (if file was modified) */
  unsavedContent?: string;
  /** Undo/redo history for session persistence */
  undoHistory?: SerializedUndoState;
}

/**
 * UI state for session persistence.
 */
export interface SessionUIState {
  /** Whether sidebar is visible */
  sidebarVisible: boolean;
  /** Sidebar width in characters */
  sidebarWidth: number;
  /** Whether terminal is visible */
  terminalVisible: boolean;
  /** Terminal height in lines */
  terminalHeight: number;
  /** Whether git panel is visible */
  gitPanelVisible: boolean;
  /** Git panel width */
  gitPanelWidth: number;
  /** Active sidebar panel */
  activeSidebarPanel: 'files' | 'git' | 'search';
  /** Whether minimap is enabled */
  minimapEnabled: boolean;
  /** Whether AI panel is visible */
  aiPanelVisible?: boolean;
  /** AI panel width */
  aiPanelWidth?: number;
}

/**
 * Layout tree node for pane arrangement.
 */
export interface SessionLayoutNode {
  /** Node type */
  type: 'leaf' | 'horizontal' | 'vertical';
  /** Pane ID (for leaf nodes) */
  paneId?: string;
  /** Child nodes (for split nodes) */
  children?: SessionLayoutNode[];
  /** Split ratios for children */
  ratios?: number[];
}

/**
 * Complete session state.
 */
export interface SessionState {
  /** Session file format version */
  version: number;
  /** When this session was last saved */
  timestamp: string;
  /** Instance ID that owns this session */
  instanceId: string;
  /** Workspace root path */
  workspaceRoot: string;
  /** Session name (for named sessions) */
  sessionName?: string;
  /** All open documents */
  documents: SessionDocumentState[];
  /** All open terminals in panes */
  terminals?: SessionTerminalState[];
  /** All open AI chats in panes */
  aiChats?: SessionAIChatState[];
  /** Active document path */
  activeDocumentPath: string | null;
  /** Active pane ID */
  activePaneId: string;
  /** Pane layout tree */
  layout: SessionLayoutNode;
  /** UI visibility states */
  ui: SessionUIState;
}

/**
 * Session info for listing.
 */
export interface SessionInfo {
  /** Session identifier */
  id: string;
  /** Display name */
  name: string;
  /** Type of session */
  type: 'workspace' | 'named';
  /** Workspace root path */
  workspaceRoot: string;
  /** When the session was last modified */
  lastModified: string;
  /** Number of open documents */
  documentCount: number;
}

/**
 * Keybinding definition.
 */
export interface KeyBinding {
  /** Key combination (e.g., "ctrl+s", "cmd+k cmd+j") */
  key: string;
  /** Command ID to execute */
  command: string;
  /** Context condition (when clause) */
  when?: string;
  /** Command arguments */
  args?: unknown;
}

/**
 * Parsed key event.
 */
export interface ParsedKey {
  /** Key name (e.g., "s", "Enter", "ArrowUp") */
  key: string;
  /** Ctrl/Cmd modifier */
  ctrl: boolean;
  /** Shift modifier */
  shift: boolean;
  /** Alt/Option modifier */
  alt: boolean;
  /** Meta modifier (Cmd on Mac, Win on Windows) */
  meta: boolean;
}

/**
 * Theme info for listing.
 */
export interface ThemeInfo {
  /** Theme identifier */
  id: string;
  /** Display name */
  name: string;
  /** Theme type */
  type: 'dark' | 'light' | 'high-contrast';
  /** Whether this is a built-in theme */
  builtin: boolean;
}

/**
 * Theme color palette.
 */
export interface ThemeColors {
  /** Editor background */
  'editor.background': string;
  /** Editor foreground */
  'editor.foreground': string;
  /** Line highlight background */
  'editor.lineHighlightBackground': string;
  /** Selection background */
  'editor.selectionBackground': string;
  /** Find match background */
  'editor.findMatchBackground': string;
  /** Find match highlight background */
  'editor.findMatchHighlightBackground': string;
  /** Cursor color */
  'editorCursor.foreground': string;
  /** Line number color */
  'editorLineNumber.foreground': string;
  /** Active line number color */
  'editorLineNumber.activeForeground': string;
  /** Sidebar background */
  'sideBar.background': string;
  /** Sidebar foreground */
  'sideBar.foreground': string;
  /** Status bar background */
  'statusBar.background': string;
  /** Status bar foreground */
  'statusBar.foreground': string;
  /** Terminal background */
  'terminal.background': string;
  /** Terminal foreground */
  'terminal.foreground': string;
  /** Plus other theme colors... */
  [key: string]: string;
}

/**
 * Complete theme definition.
 */
export interface Theme {
  /** Theme identifier */
  id: string;
  /** Display name */
  name: string;
  /** Theme type */
  type: 'dark' | 'light' | 'high-contrast';
  /** Color palette */
  colors: ThemeColors;
  /** Token colors for syntax highlighting */
  tokenColors?: TokenColor[];
}

/**
 * Token color for syntax highlighting.
 */
export interface TokenColor {
  /** Token scope */
  scope: string | string[];
  /** Color settings */
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

/**
 * Settings schema property definition.
 */
export interface SettingsSchemaProperty {
  /** Property type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** Default value */
  default: unknown;
  /** Allowed values (for enums) */
  enum?: unknown[];
  /** Human-readable description */
  description?: string;
  /** Minimum value (for numbers) */
  minimum?: number;
  /** Maximum value (for numbers) */
  maximum?: number;
  /** Item type (for arrays) */
  items?: SettingsSchemaProperty;
}

/**
 * Settings schema for validation and discovery.
 */
export interface SettingsSchema {
  /** Schema properties */
  properties: Record<string, SettingsSchemaProperty>;
}

/**
 * Settings validation result.
 */
export interface ValidationResult {
  /** Whether the value is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}

/**
 * Setting change event.
 */
export interface SettingChangeEvent {
  /** Setting key */
  key: string;
  /** New value */
  value: unknown;
  /** Old value */
  oldValue: unknown;
}

/**
 * Session change event.
 */
export interface SessionChangeEvent {
  /** Session ID */
  sessionId: string;
  /** Change type */
  type: 'saved' | 'loaded' | 'deleted';
}

/**
 * Callback for setting changes.
 */
export type SettingChangeCallback = (event: SettingChangeEvent) => void;

/**
 * Callback for session changes.
 */
export type SessionChangeCallback = (event: SessionChangeEvent) => void;

/**
 * Unsubscribe function.
 */
export type Unsubscribe = () => void;
