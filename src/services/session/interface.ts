/**
 * Session Service Interface
 *
 * Defines the contract for settings, sessions, keybindings, and themes.
 */

import type { EditorSettings } from '../../config/settings.ts';
import type {
  SessionState,
  SessionInfo,
  KeyBinding,
  ParsedKey,
  ThemeInfo,
  Theme,
  SettingsSchema,
  SettingChangeCallback,
  SessionChangeCallback,
  Unsubscribe,
} from './types.ts';

/**
 * Session Service interface.
 *
 * Provides access to:
 * - Settings management with validation
 * - Session persistence (open files, UI layout)
 * - Keybinding configuration
 * - Theme management
 */
export interface SessionService {
  // ─────────────────────────────────────────────────────────────────────────
  // Settings
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a setting value.
   */
  getSetting<K extends keyof EditorSettings>(key: K): EditorSettings[K];

  /**
   * Set a setting value.
   * Validates the value against the schema.
   * @throws SessionError if value is invalid
   */
  setSetting<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void;

  /**
   * Get all settings.
   */
  getAllSettings(): EditorSettings;

  /**
   * Update multiple settings at once.
   * Validates all values before applying.
   * @throws SessionError if any value is invalid
   */
  updateSettings(partial: Partial<EditorSettings>): void;

  /**
   * Reset a setting to its default value.
   * If no key is provided, resets all settings.
   */
  resetSettings(key?: keyof EditorSettings): void;

  /**
   * Get the settings schema for validation and discovery.
   */
  getSettingsSchema(): SettingsSchema;

  /**
   * Subscribe to setting changes.
   */
  onSettingChange(callback: SettingChangeCallback): Unsubscribe;

  /**
   * Subscribe to changes for a specific setting.
   */
  onSettingChangeFor<K extends keyof EditorSettings>(
    key: K,
    callback: (value: EditorSettings[K]) => void
  ): Unsubscribe;

  // ─────────────────────────────────────────────────────────────────────────
  // Sessions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Save the current session.
   * If name is provided, creates a named session.
   * Otherwise, saves to the workspace path.
   * @returns Session ID
   */
  saveSession(name?: string): Promise<string>;

  /**
   * Load a session by ID.
   */
  loadSession(sessionId: string): Promise<SessionState>;

  /**
   * List all available sessions.
   */
  listSessions(): Promise<SessionInfo[]>;

  /**
   * Delete a session.
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Get the current session state.
   */
  getCurrentSession(): SessionState | null;

  /**
   * Set the current session state.
   * Used when restoring a session.
   */
  setCurrentSession(state: SessionState): void;

  /**
   * Mark the session as dirty (needs saving).
   */
  markSessionDirty(): void;

  /**
   * Subscribe to session changes.
   */
  onSessionChange(callback: SessionChangeCallback): Unsubscribe;

  // ─────────────────────────────────────────────────────────────────────────
  // Keybindings
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all keybindings.
   */
  getKeybindings(): KeyBinding[];

  /**
   * Set all keybindings (replaces existing).
   */
  setKeybindings(bindings: KeyBinding[]): void;

  /**
   * Add a keybinding.
   */
  addKeybinding(binding: KeyBinding): void;

  /**
   * Remove a keybinding by key.
   */
  removeKeybinding(key: string): void;

  /**
   * Resolve a key press to a command.
   * Returns null if no binding matches.
   */
  resolveKeybinding(key: ParsedKey): string | null;

  /**
   * Get the key binding for a command.
   * Returns null if no binding exists.
   */
  getBindingForCommand(commandId: string): string | null;

  // ─────────────────────────────────────────────────────────────────────────
  // Themes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List available themes.
   */
  listThemes(): ThemeInfo[];

  /**
   * Get a theme by ID.
   */
  getTheme(themeId: string): Theme | null;

  /**
   * Set the current theme.
   */
  setTheme(themeId: string): void;

  /**
   * Get the current theme.
   */
  getCurrentTheme(): Theme;

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the service.
   * Loads settings, keybindings, and themes from disk.
   */
  init(workspaceRoot: string): Promise<void>;

  /**
   * Shutdown the service.
   * Saves settings and session state.
   */
  shutdown(): Promise<void>;

  /**
   * Get the workspace root.
   */
  getWorkspaceRoot(): string | null;

  /**
   * Set the workspace root.
   */
  setWorkspaceRoot(path: string): void;
}
