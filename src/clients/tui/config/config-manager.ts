/**
 * TUI Config Manager
 *
 * Manages configuration for the TUI client.
 * Config is stored in ~/.ultra/ with user settings/keybindings and sessions.
 * Default configs are embedded at build time from config/default-*.jsonc files.
 */

import { mkdir, cp, rm } from 'fs/promises';
import * as fs from 'fs';
import { debugLog } from '../../../debug.ts';
import type { EditorSettings } from '../../../config/settings.ts';
import type { KeyBinding } from '../../../services/session/types.ts';

// Import embedded defaults (generated at build time from JSONC files)
// Source of truth: config/default-settings.jsonc and config/default-keybindings.jsonc
import { defaultKeybindings, defaultSettings } from '../../../config/defaults.ts';

// ============================================
// Hot-Reload Types
// ============================================

/**
 * Type of config that was reloaded.
 */
export type ConfigReloadType = 'settings' | 'keybindings' | 'theme';

/**
 * Callback for when config is reloaded.
 */
export type ConfigReloadCallback = (type: ConfigReloadType) => void;

// ============================================
// Configuration
// ============================================

/**
 * Legacy subdirectory name - kept for migration purposes.
 * Config files were previously stored in ~/.ultra/new-tui/
 */
export const LEGACY_CONFIG_SUBDIR = 'new-tui';

// ============================================
// Types
// ============================================

/**
 * File watching mode for external changes.
 * - 'onFocus': Check for changes when document receives focus (default, low overhead)
 * - 'always': Watch all open files continuously (higher overhead, instant updates)
 * - 'off': Never check for external changes
 */
export type FileWatchMode = 'onFocus' | 'always' | 'off';

/**
 * TUI-specific settings (extends EditorSettings).
 * All settings available in the TUI client are defined here.
 */
export interface TUISettings extends Partial<EditorSettings> {
  // ─────────────────────────────────────────────────────────────────────────
  // TUI Layout
  // ─────────────────────────────────────────────────────────────────────────

  /** Width of the sidebar in characters */
  'tui.sidebar.width'?: number;
  /** Whether the sidebar is visible */
  'tui.sidebar.visible'?: boolean;
  /** Sidebar location (left or right) */
  'tui.sidebar.location'?: 'left' | 'right';
  /** Sidebar focused background color */
  'tui.sidebar.focusedBackground'?: string;
  /** Height of the terminal panel in rows */
  'tui.terminal.height'?: number;

  // ─────────────────────────────────────────────────────────────────────────
  // File Watching
  // ─────────────────────────────────────────────────────────────────────────

  /** When to check for external file changes: 'onFocus', 'always', or 'off' */
  'files.watchFiles'?: FileWatchMode;

  // ─────────────────────────────────────────────────────────────────────────
  // Editor Extensions
  // ─────────────────────────────────────────────────────────────────────────

  /** Use curly/squiggly underlines for diagnostics (requires Kitty, WezTerm, iTerm2, etc.) */
  'editor.diagnostics.curlyUnderline'?: boolean;
  /** Maximum number of undo actions to keep per document */
  'editor.undoHistoryLimit'?: number;

  // ─────────────────────────────────────────────────────────────────────────
  // Terminal
  // ─────────────────────────────────────────────────────────────────────────

  /** Number of lines to keep in terminal scrollback buffer */
  'tui.terminal.scrollback'?: number;

  // ─────────────────────────────────────────────────────────────────────────
  // Git
  // ─────────────────────────────────────────────────────────────────────────

  /** Maximum height of inline diff expander in lines */
  'git.inlineDiff.maxHeight'?: number;
  /** Number of context lines to show in inline diffs */
  'git.inlineDiff.contextLines'?: number;

  // ─────────────────────────────────────────────────────────────────────────
  // AI
  // ─────────────────────────────────────────────────────────────────────────

  /** Default AI provider: 'claude-code', 'codex', or 'gemini' */
  'ai.defaultProvider'?: 'claude-code' | 'codex' | 'gemini';

  // ─────────────────────────────────────────────────────────────────────────
  // TUI Tab Bar
  // ─────────────────────────────────────────────────────────────────────────

  /** Number of tabs to scroll when using scroll buttons */
  'tui.tabBar.scrollAmount'?: number;

  // ─────────────────────────────────────────────────────────────────────────
  // TUI Diff Viewer
  // ─────────────────────────────────────────────────────────────────────────

  /** Auto-refresh diff when file changes */
  'tui.diffViewer.autoRefresh'?: boolean;
  /** Show diagnostics in diff viewer */
  'tui.diffViewer.showDiagnostics'?: boolean;
  /** Edit save mode: 'stage-modified', 'save-only', 'auto-stage' */
  'tui.diffViewer.editMode'?: 'stage-modified' | 'save-only' | 'auto-stage';

  // ─────────────────────────────────────────────────────────────────────────
  // TUI Outline Panel
  // ─────────────────────────────────────────────────────────────────────────

  /** Collapse outline panel on startup */
  'tui.outline.collapsedOnStartup'?: boolean;
  /** Auto-follow cursor position in outline */
  'tui.outline.autoFollow'?: boolean;

  // ─────────────────────────────────────────────────────────────────────────
  // TUI Timeline Panel
  // ─────────────────────────────────────────────────────────────────────────

  /** Timeline mode: 'file' (current file) or 'repo' (all commits) */
  'tui.timeline.mode'?: 'file' | 'repo';
  /** Number of commits to show in timeline */
  'tui.timeline.commitCount'?: number;
  /** Whether to collapse timeline panel on startup */
  'tui.timeline.collapsedOnStartup'?: boolean;
}

/**
 * Config paths for different locations.
 */
export interface ConfigPaths {
  /** Base ultra directory (~/.ultra/) */
  baseDir: string;
  /** User config directory (~/.ultra/) */
  userDir: string;
  /** User settings file (~/.ultra/settings.jsonc) - supports comments */
  userSettings: string;
  /** User keybindings file (~/.ultra/keybindings.jsonc) - supports comments */
  userKeybindings: string;
  /** Workspace settings directory (<project>/.ultra/) - created on demand */
  workspaceDir: string | null;
  /** Workspace settings file (<project>/.ultra/settings.jsonc) - supports comments */
  workspaceSettings: string | null;
  /** Sessions directory (~/.ultra/sessions/) */
  sessionsDir: string;
  /** Workspace sessions directory (~/.ultra/sessions/workspaces/) */
  workspaceSessionsDir: string;
  /** Named sessions directory (~/.ultra/sessions/named/) */
  namedSessionsDir: string;
  /** Last session reference file (~/.ultra/sessions/last-session.json) */
  lastSessionFile: string;
  /** Legacy config directory (~/.ultra/new-tui/) - for migration */
  legacyDir: string;
}

// ============================================
// Config Manager
// ============================================

export class TUIConfigManager {
  /** Current settings */
  private settings: TUISettings = {};

  /** Current keybindings */
  private keybindings: KeyBinding[] = [];

  /** Config paths */
  private paths: ConfigPaths;

  /** Settings change listeners */
  private listeners: Map<string, Set<(value: unknown) => void>> = new Map();

  /** Whether config has been loaded */
  private loaded = false;

  /** File watchers for hot-reload */
  private watchers: Map<string, fs.FSWatcher> = new Map();

  /** Debounce timers for file change events */
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Reload callbacks for hot-reload notifications */
  private reloadCallbacks: Set<ConfigReloadCallback> = new Set();

  /** Debounce delay in ms */
  private static readonly DEBOUNCE_DELAY = 100;

  constructor(workingDirectory?: string) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const baseDir = `${home}/.ultra`;
    const userDir = baseDir;
    const sessionsDir = `${userDir}/sessions`;

    this.paths = {
      baseDir,
      userDir,
      userSettings: `${userDir}/settings.jsonc`,
      userKeybindings: `${userDir}/keybindings.jsonc`,
      workspaceDir: workingDirectory ? `${workingDirectory}/.ultra` : null,
      workspaceSettings: workingDirectory ? `${workingDirectory}/.ultra/settings.jsonc` : null,
      sessionsDir,
      workspaceSessionsDir: `${sessionsDir}/workspaces`,
      namedSessionsDir: `${sessionsDir}/named`,
      lastSessionFile: `${sessionsDir}/last-session.json`,
      legacyDir: `${baseDir}/${LEGACY_CONFIG_SUBDIR}`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Loading
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load all configuration.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    await this.ensureConfigDirs();
    await this.loadSettings();
    await this.loadKeybindings();

    this.loaded = true;
    debugLog('[TUIConfigManager] Configuration loaded');
  }

  /**
   * Ensure user config directory and default files exist.
   * Workspace config is only created when explicitly saving.
   */
  private async ensureConfigDirs(): Promise<void> {
    try {
      await mkdir(this.paths.userDir, { recursive: true });

      // Create default settings file if it doesn't exist
      await this.ensureDefaultFile(
        this.paths.userSettings,
        this.getDefaultSettings(),
        'Default TUI settings - edit this file to customize your editor'
      );

      // Create default keybindings file if it doesn't exist
      await this.ensureDefaultFile(
        this.paths.userKeybindings,
        this.getDefaultKeybindings(),
        'Default TUI keybindings - edit this file to customize your shortcuts'
      );
    } catch (error) {
      debugLog(`[TUIConfigManager] Error creating config dirs: ${error}`);
    }
  }

  /**
   * Create a default config file if it doesn't exist.
   */
  private async ensureDefaultFile(path: string, defaults: unknown, comment: string): Promise<void> {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        return;
      }

      // Create file with header comment and pretty-printed JSON
      const header = `// ${comment}\n// Generated by Ultra TUI on ${new Date().toISOString()}\n`;
      const content = header + JSON.stringify(defaults, null, 2);
      await Bun.write(path, content);
      debugLog(`[TUIConfigManager] Created default config: ${path}`);
    } catch (error) {
      debugLog(`[TUIConfigManager] Error creating default file ${path}: ${error}`);
    }
  }

  /**
   * Load settings from files.
   */
  private async loadSettings(): Promise<void> {
    // Start with defaults
    this.settings = this.getDefaultSettings();
    debugLog(`[TUIConfigManager] Loaded ${Object.keys(this.settings).length} default settings`);

    // Load user settings
    const userSettings = await this.loadJsonFile<TUISettings>(this.paths.userSettings);
    if (userSettings) {
      const userKeys = Object.keys(userSettings);
      debugLog(`[TUIConfigManager] Loaded ${userKeys.length} user settings from ${this.paths.userSettings}`);
      this.settings = { ...this.settings, ...userSettings };
    } else {
      debugLog(`[TUIConfigManager] No user settings found at ${this.paths.userSettings}`);
    }

    // Load workspace settings (override user)
    if (this.paths.workspaceSettings) {
      const workspaceSettings = await this.loadJsonFile<TUISettings>(this.paths.workspaceSettings);
      if (workspaceSettings) {
        const wsKeys = Object.keys(workspaceSettings);
        debugLog(`[TUIConfigManager] Loaded ${wsKeys.length} workspace settings from ${this.paths.workspaceSettings}`);
        this.settings = { ...this.settings, ...workspaceSettings };
      }
    }

    // Log final settings count and key settings
    debugLog(`[TUIConfigManager] Final settings: ${Object.keys(this.settings).length} keys`);
    debugLog(`[TUIConfigManager] tui.terminal.height = ${this.settings['tui.terminal.height']}`);
    debugLog(`[TUIConfigManager] tui.sidebar.width = ${this.settings['tui.sidebar.width']}`);
  }

  /**
   * Load keybindings from files.
   */
  private async loadKeybindings(): Promise<void> {
    // Start with defaults
    this.keybindings = this.getDefaultKeybindings();

    // Load user keybindings
    const userKeybindings = await this.loadJsonFile<KeyBinding[]>(this.paths.userKeybindings);
    if (userKeybindings && Array.isArray(userKeybindings)) {
      // Merge: user bindings override defaults for same command
      const commandMap = new Map<string, KeyBinding>();

      for (const binding of this.keybindings) {
        commandMap.set(binding.command, binding);
      }

      for (const binding of userKeybindings) {
        commandMap.set(binding.command, binding);
      }

      this.keybindings = Array.from(commandMap.values());
    }
  }

  /**
   * Load a JSON file with comment support.
   */
  private async loadJsonFile<T>(path: string): Promise<T | null> {
    try {
      const file = Bun.file(path);
      const exists = await file.exists();
      if (!exists) {
        debugLog(`[TUIConfigManager] File does not exist: ${path}`);
        return null;
      }

      const content = await file.text();
      debugLog(`[TUIConfigManager] Read ${content.length} bytes from ${path}`);

      // Remove comments (JSON with comments support)
      const cleanContent = content
        .replace(/\/\/.*$/gm, '') // Single line comments
        .replace(/\/\*[\s\S]*?\*\//g, ''); // Multi-line comments

      const parsed = JSON.parse(cleanContent) as T;
      debugLog(`[TUIConfigManager] Successfully parsed ${path}`);
      return parsed;
    } catch (error) {
      debugLog(`[TUIConfigManager] Error loading ${path}: ${error}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Settings Access
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a setting value.
   */
  get<K extends keyof TUISettings>(key: K): TUISettings[K] {
    return this.settings[key];
  }

  /**
   * Get a setting with a default fallback.
   */
  getWithDefault<K extends keyof TUISettings>(key: K, defaultValue: NonNullable<TUISettings[K]>): NonNullable<TUISettings[K]> {
    return (this.settings[key] ?? defaultValue) as NonNullable<TUISettings[K]>;
  }

  /**
   * Set a setting value.
   */
  set<K extends keyof TUISettings>(key: K, value: TUISettings[K]): void {
    const oldValue = this.settings[key];
    this.settings[key] = value;

    if (oldValue !== value) {
      this.notifyListeners(key, value);
    }
  }

  /**
   * Get all settings.
   */
  getAllSettings(): TUISettings {
    return { ...this.settings };
  }

  /**
   * Listen for setting changes.
   */
  onChange(key: string, callback: (value: unknown) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);

    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  private notifyListeners(key: string, value: unknown): void {
    const keyListeners = this.listeners.get(key);
    if (keyListeners) {
      for (const listener of keyListeners) {
        listener(value);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keybindings Access
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all keybindings.
   */
  getKeybindings(): KeyBinding[] {
    return [...this.keybindings];
  }

  /**
   * Get keybinding for a command.
   */
  getKeybindingForCommand(command: string): KeyBinding | undefined {
    return this.keybindings.find((b) => b.command === command);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Saving
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Save user settings to file.
   */
  async saveSettings(): Promise<void> {
    try {
      const content = JSON.stringify(this.settings, null, 2);
      await Bun.write(this.paths.userSettings, content);
      debugLog('[TUIConfigManager] Settings saved');
    } catch (error) {
      debugLog(`[TUIConfigManager] Error saving settings: ${error}`);
    }
  }

  /**
   * Save user keybindings to file.
   */
  async saveKeybindings(): Promise<void> {
    try {
      const content = JSON.stringify(this.keybindings, null, 2);
      await Bun.write(this.paths.userKeybindings, content);
      debugLog('[TUIConfigManager] Keybindings saved');
    } catch (error) {
      debugLog(`[TUIConfigManager] Error saving keybindings: ${error}`);
    }
  }

  /**
   * Save workspace settings to file.
   * Creates the workspace config directory if it doesn't exist.
   */
  async saveWorkspaceSettings(settings: Partial<TUISettings>): Promise<void> {
    if (!this.paths.workspaceDir || !this.paths.workspaceSettings) {
      debugLog('[TUIConfigManager] No workspace directory configured');
      return;
    }

    try {
      // Create workspace config directory on demand
      await mkdir(this.paths.workspaceDir, { recursive: true });

      const content = JSON.stringify(settings, null, 2);
      await Bun.write(this.paths.workspaceSettings, content);
      debugLog('[TUIConfigManager] Workspace settings saved');
    } catch (error) {
      debugLog(`[TUIConfigManager] Error saving workspace settings: ${error}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Defaults
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get default settings.
   * Embedded at build time from config/default-settings.jsonc
   */
  private getDefaultSettings(): TUISettings {
    // Apply runtime overrides for environment-specific values
    const defaults = { ...defaultSettings } as TUISettings;

    // Override shell with environment variable if not set
    if (!defaults['terminal.integrated.shell']) {
      defaults['terminal.integrated.shell'] = process.env.SHELL || '/bin/zsh';
    }

    return defaults;
  }

  /**
   * Get default keybindings.
   * Embedded at build time from config/default-keybindings.jsonc
   */
  private getDefaultKeybindings(): KeyBinding[] {
    return defaultKeybindings as KeyBinding[];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Paths
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get config paths.
   */
  getPaths(): ConfigPaths {
    return { ...this.paths };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Migration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if legacy config directory exists and has content.
   */
  async hasLegacyConfig(): Promise<boolean> {
    try {
      const legacyDir = Bun.file(this.paths.legacyDir);
      const stat = await legacyDir.stat();
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Migrate config from legacy ~/.ultra/new-tui/ to ~/.ultra/
   * - Copies sessions from legacy/sessions/ to ~/.ultra/sessions/
   * - Copies settings.json and keybindings.json (overwrites existing - legacy takes precedence)
   * - Archives legacy folder to ~/.ultra/archived/new-tui-backup-<timestamp>
   *
   * @returns Migration result with details
   */
  async migrateFromLegacy(): Promise<{
    success: boolean;
    message: string;
    details: string[];
  }> {
    const details: string[] = [];

    try {
      // Check if legacy directory exists
      if (!await this.hasLegacyConfig()) {
        return {
          success: true,
          message: 'No legacy config found',
          details: ['Legacy directory ~/.ultra/new-tui/ does not exist'],
        };
      }

      const legacyDir = this.paths.legacyDir;
      const legacySessionsDir = `${legacyDir}/sessions`;
      const legacySettings = `${legacyDir}/settings.json`;
      const legacyKeybindings = `${legacyDir}/keybindings.json`;

      // 1. Migrate sessions (copy to new location, overwriting if needed)
      try {
        const legacySessionsStat = await Bun.file(legacySessionsDir).stat();
        if (legacySessionsStat.isDirectory()) {
          // Ensure sessions directory exists
          await mkdir(this.paths.sessionsDir, { recursive: true });

          // Copy sessions recursively
          await cp(legacySessionsDir, this.paths.sessionsDir, { recursive: true, force: true });
          details.push(`Migrated sessions from ${legacySessionsDir}`);
        }
      } catch {
        details.push('No legacy sessions to migrate');
      }

      // 2. Copy settings from legacy (overwrites existing - legacy takes precedence)
      // Legacy uses .json, new format uses .jsonc (with comment support)
      try {
        const legacySettingsFile = Bun.file(legacySettings);

        if (await legacySettingsFile.exists()) {
          const content = await legacySettingsFile.text();
          await Bun.write(this.paths.userSettings, content);
          details.push(`Migrated settings.json -> settings.jsonc`);
        }
      } catch (e) {
        details.push(`Error migrating settings: ${e}`);
      }

      // 3. Copy keybindings from legacy (overwrites existing - legacy takes precedence)
      // Legacy uses .json, new format uses .jsonc (with comment support)
      try {
        const legacyKeybindingsFile = Bun.file(legacyKeybindings);

        if (await legacyKeybindingsFile.exists()) {
          const content = await legacyKeybindingsFile.text();
          await Bun.write(this.paths.userKeybindings, content);
          details.push(`Migrated keybindings.json -> keybindings.jsonc`);
        }
      } catch (e) {
        details.push(`Error migrating keybindings: ${e}`);
      }

      // 4. Archive the legacy folder
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveDir = `${this.paths.baseDir}/archived`;
      const archivePath = `${archiveDir}/new-tui-backup-${timestamp}`;

      try {
        await mkdir(archiveDir, { recursive: true });
        await cp(legacyDir, archivePath, { recursive: true });
        details.push(`Archived legacy config to ${archivePath}`);

        // Remove the legacy directory
        await rm(legacyDir, { recursive: true, force: true });
        details.push(`Removed legacy directory ${legacyDir}`);
      } catch (e) {
        details.push(`Error archiving legacy config: ${e}`);
      }

      // Reload config after migration
      this.loaded = false;
      await this.load();
      details.push('Reloaded configuration');

      return {
        success: true,
        message: 'Migration completed successfully',
        details,
      };
    } catch (error) {
      return {
        success: false,
        message: `Migration failed: ${error}`,
        details,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hot-Reload
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start watching config files for changes.
   * Automatically reloads settings and keybindings when files change.
   */
  startWatching(): void {
    this.watchFile(this.paths.userSettings, 'settings');
    this.watchFile(this.paths.userKeybindings, 'keybindings');
    debugLog('[TUIConfigManager] Started watching config files');
  }

  /**
   * Stop watching config files.
   */
  stopWatching(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    debugLog('[TUIConfigManager] Stopped watching config files');
  }

  /**
   * Watch a single file for changes.
   * Uses directory watching as a fallback for atomic saves.
   */
  private watchFile(filePath: string, type: ConfigReloadType): void {
    try {
      // Watch the parent directory to catch atomic saves (file replacements)
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
      const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);

      const watcher = fs.watch(dirPath, { persistent: true }, (eventType, changedFile) => {
        // Only react to changes to our specific file
        if (changedFile === fileName) {
          debugLog(`[TUIConfigManager] File change detected: ${type} (event: ${eventType})`);
          this.handleFileChange(filePath, type);
        }
      });

      // Handle watcher errors (e.g., directory removed)
      watcher.on('error', (error) => {
        debugLog(`[TUIConfigManager] Watcher error for ${type}: ${error}`);
      });

      this.watchers.set(type, watcher);
      debugLog(`[TUIConfigManager] Watching ${type}: ${filePath} (via directory: ${dirPath})`);
    } catch (error) {
      debugLog(`[TUIConfigManager] Failed to watch ${filePath}: ${error}`);
    }
  }

  /**
   * Handle a file change event with debouncing.
   */
  private handleFileChange(filePath: string, type: ConfigReloadType): void {
    // Clear existing timer for this type
    const existingTimer = this.debounceTimers.get(type);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(type);

      // Check if file still exists before reloading
      try {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          debugLog(`[TUIConfigManager] Reloading ${type}...`);
          await this.reloadConfig(type);
        } else {
          debugLog(`[TUIConfigManager] File no longer exists: ${filePath}`);
        }
      } catch (error) {
        debugLog(`[TUIConfigManager] Error handling file change: ${error}`);
      }
    }, TUIConfigManager.DEBOUNCE_DELAY);

    this.debounceTimers.set(type, timer);
  }

  /**
   * Reload a specific config type.
   */
  private async reloadConfig(type: ConfigReloadType): Promise<void> {
    try {
      if (type === 'settings') {
        await this.loadSettings();
        debugLog('[TUIConfigManager] Settings reloaded');
      } else if (type === 'keybindings') {
        await this.loadKeybindings();
        debugLog('[TUIConfigManager] Keybindings reloaded');
      }

      // Notify listeners
      this.notifyReload(type);
    } catch (error) {
      debugLog(`[TUIConfigManager] Failed to reload ${type}: ${error}`);
    }
  }

  /**
   * Register a callback for config reload events.
   * @returns Unsubscribe function
   */
  onReload(callback: ConfigReloadCallback): () => void {
    this.reloadCallbacks.add(callback);
    return () => {
      this.reloadCallbacks.delete(callback);
    };
  }

  /**
   * Notify all reload listeners.
   */
  private notifyReload(type: ConfigReloadType): void {
    for (const callback of this.reloadCallbacks) {
      try {
        callback(type);
      } catch (error) {
        debugLog(`[TUIConfigManager] Reload callback error: ${error}`);
      }
    }
  }

  /**
   * Cleanup all resources.
   */
  destroy(): void {
    this.stopWatching();
    this.listeners.clear();
    this.reloadCallbacks.clear();
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new TUI config manager.
 */
export function createTUIConfigManager(workingDirectory?: string): TUIConfigManager {
  return new TUIConfigManager(workingDirectory);
}
