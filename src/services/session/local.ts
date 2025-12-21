/**
 * Local Session Service Implementation
 *
 * Implements SessionService using local storage and the existing
 * Settings and SessionManager classes.
 */

import { mkdir, readdir, unlink } from 'fs/promises';
import { createHash } from 'crypto';
import { debugLog } from '../../debug.ts';
import { Settings, type EditorSettings } from '../../config/settings.ts';
import { SessionError, SessionErrorCode } from './errors.ts';
import { settingsSchema, validateSetting, getDefaultValue, isValidSettingKey } from './schema.ts';
import type { SessionService } from './interface.ts';
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
  SessionUIState,
  SessionLayoutNode,
} from './types.ts';

/**
 * Session paths configuration.
 */
export interface SessionPathsConfig {
  /** Sessions directory */
  sessionsDir: string;
  /** Workspace sessions directory */
  workspaceSessionsDir: string;
  /** Named sessions directory */
  namedSessionsDir: string;
  /** Last session reference file */
  lastSessionFile: string;
}

/**
 * Default UI state for new sessions.
 */
const DEFAULT_UI_STATE: SessionUIState = {
  sidebarVisible: true,
  sidebarWidth: 30,
  terminalVisible: false,
  terminalHeight: 12,
  gitPanelVisible: false,
  gitPanelWidth: 40,
  activeSidebarPanel: 'files',
  minimapEnabled: true,
  aiPanelVisible: false,
  aiPanelWidth: 80,
};

/**
 * Default layout for new sessions.
 */
const DEFAULT_LAYOUT: SessionLayoutNode = {
  type: 'leaf',
  paneId: 'main',
};

/**
 * Local Session Service.
 *
 * Provides settings, session, keybinding, and theme management
 * using local file storage.
 */
export class LocalSessionService implements SessionService {
  private _debugName = 'LocalSessionService';
  private settings: Settings;
  private workspaceRoot: string | null = null;
  private currentSession: SessionState | null = null;
  private keybindings: KeyBinding[] = [];
  private themes: Map<string, Theme> = new Map();
  private currentThemeId: string = 'One Dark';
  private initialized = false;

  // Session paths configuration
  private sessionPaths: SessionPathsConfig | null = null;

  // Auto-save support
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private isDirty = false;
  private autoSaveInterval = 30000; // 30 seconds default

  // Event callbacks
  private settingChangeCallbacks = new Set<SettingChangeCallback>();
  private sessionChangeCallbacks = new Set<SessionChangeCallback>();
  private settingKeyCallbacks = new Map<string, Set<(value: unknown) => void>>();

  constructor() {
    this.settings = new Settings();
    this.loadBuiltinThemes();
  }

  /**
   * Configure session storage paths.
   * Must be called before saving/loading sessions.
   */
  setSessionPaths(paths: SessionPathsConfig): void {
    this.sessionPaths = paths;
    this.debugLog(`Session paths configured: ${paths.sessionsDir}`);
  }

  /**
   * Get session paths configuration.
   */
  getSessionPaths(): SessionPathsConfig | null {
    return this.sessionPaths;
  }

  protected debugLog(msg: string): void {
    debugLog(`[${this._debugName}] ${msg}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Settings
  // ─────────────────────────────────────────────────────────────────────────

  getSetting<K extends keyof EditorSettings>(key: K): EditorSettings[K] {
    return this.settings.get(key);
  }

  setSetting<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void {
    // Validate the value
    const result = validateSetting(key, value);
    if (!result.valid) {
      throw SessionError.invalidValue(key, value, result.error!);
    }

    const oldValue = this.settings.get(key);
    this.settings.set(key, value);

    // Notify listeners
    this.emitSettingChange(key, value, oldValue);
  }

  getAllSettings(): EditorSettings {
    return this.settings.getAll();
  }

  updateSettings(partial: Partial<EditorSettings>): void {
    // Validate all values first
    for (const [key, value] of Object.entries(partial)) {
      if (value === undefined) continue;
      const result = validateSetting(key, value);
      if (!result.valid) {
        throw SessionError.invalidValue(key, value, result.error!);
      }
    }

    // Apply all values
    for (const [key, value] of Object.entries(partial)) {
      if (value === undefined) continue;
      const oldValue = this.settings.get(key as keyof EditorSettings);
      // @ts-expect-error - dynamic key assignment
      this.settings.set(key, value);
      this.emitSettingChange(key, value, oldValue);
    }
  }

  resetSettings(key?: keyof EditorSettings): void {
    if (key) {
      const defaultValue = getDefaultValue(key);
      const oldValue = this.settings.get(key);
      this.settings.set(key, defaultValue);
      this.emitSettingChange(key, defaultValue, oldValue);
    } else {
      this.settings.reset();
      // Emit changes for all settings
      for (const key of Object.keys(settingsSchema.properties) as (keyof EditorSettings)[]) {
        const value = this.settings.get(key);
        this.emitSettingChange(key, value, undefined);
      }
    }
  }

  getSettingsSchema(): SettingsSchema {
    return settingsSchema;
  }

  onSettingChange(callback: SettingChangeCallback): Unsubscribe {
    this.settingChangeCallbacks.add(callback);
    return () => {
      this.settingChangeCallbacks.delete(callback);
    };
  }

  onSettingChangeFor<K extends keyof EditorSettings>(
    key: K,
    callback: (value: EditorSettings[K]) => void
  ): Unsubscribe {
    if (!this.settingKeyCallbacks.has(key)) {
      this.settingKeyCallbacks.set(key, new Set());
    }
    this.settingKeyCallbacks.get(key)!.add(callback as (value: unknown) => void);
    return () => {
      this.settingKeyCallbacks.get(key)?.delete(callback as (value: unknown) => void);
    };
  }

  private emitSettingChange(key: string, value: unknown, oldValue: unknown): void {
    const event = { key, value, oldValue };

    // Global listeners
    for (const callback of this.settingChangeCallbacks) {
      try {
        callback(event);
      } catch (error) {
        this.debugLog(`Setting change callback error: ${error}`);
      }
    }

    // Key-specific listeners
    const keyCallbacks = this.settingKeyCallbacks.get(key);
    if (keyCallbacks) {
      for (const callback of keyCallbacks) {
        try {
          callback(value);
        } catch (error) {
          this.debugLog(`Setting key callback error: ${error}`);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Sessions
  // ─────────────────────────────────────────────────────────────────────────

  async saveSession(name?: string): Promise<string> {
    if (!this.workspaceRoot) {
      throw SessionError.notInitialized();
    }

    const state = this.currentSession || this.createEmptySession();

    state.timestamp = new Date().toISOString();
    state.workspaceRoot = this.workspaceRoot;
    if (name) {
      state.sessionName = name;
    }

    // Update in-memory state
    this.currentSession = state;

    // Get the consistent sessionId
    const sessionId = this.getSessionId(state);

    // Persist to disk if paths are configured
    if (this.sessionPaths) {
      try {
        await this.persistSession(state, sessionId);
        await this.updateLastSession(sessionId);
        this.isDirty = false;
      } catch (error) {
        this.debugLog(`Failed to persist session: ${error}`);
        throw error;
      }
    }

    this.emitSessionChange(sessionId, 'saved');
    this.debugLog(`Session saved: ${sessionId}`);

    return sessionId;
  }

  /**
   * Persist session to disk.
   */
  private async persistSession(state: SessionState, sessionId: string): Promise<void> {
    if (!this.sessionPaths) return;

    // Determine target directory based on session type
    const isNamed = !!state.sessionName;
    const targetDir = isNamed
      ? this.sessionPaths.namedSessionsDir
      : this.sessionPaths.workspaceSessionsDir;

    // Ensure directory exists
    await mkdir(targetDir, { recursive: true });

    // Determine filename
    const filename = isNamed
      ? `${this.sanitizeFilename(state.sessionName!)}.json`
      : `${this.getWorkspaceHash(state.workspaceRoot)}.json`;

    const filePath = `${targetDir}/${filename}`;

    // Write session file
    const content = JSON.stringify(state, null, 2);
    await Bun.write(filePath, content);
    this.debugLog(`Persisted session to: ${filePath}`);
  }

  /**
   * Update the last-session.json reference file.
   */
  private async updateLastSession(sessionId: string): Promise<void> {
    if (!this.sessionPaths) return;

    // Ensure parent directory exists
    await mkdir(this.sessionPaths.sessionsDir, { recursive: true });

    const lastSessionData = {
      sessionId,
      workspaceRoot: this.workspaceRoot,
      timestamp: new Date().toISOString(),
    };

    await Bun.write(
      this.sessionPaths.lastSessionFile,
      JSON.stringify(lastSessionData, null, 2)
    );
  }

  /**
   * Get a SHA256 hash of the workspace path (first 16 chars).
   */
  private getWorkspaceHash(workspacePath: string): string {
    return createHash('sha256')
      .update(workspacePath)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Sanitize a name for use as a filename.
   */
  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
  }

  async loadSession(sessionId: string): Promise<SessionState> {
    // First check in-memory cache
    if (this.currentSession && this.getSessionId(this.currentSession) === sessionId) {
      this.emitSessionChange(sessionId, 'loaded');
      return this.currentSession;
    }

    // Try to load from disk
    if (this.sessionPaths) {
      const state = await this.loadSessionFromDisk(sessionId);
      if (state) {
        this.currentSession = state;
        this.emitSessionChange(sessionId, 'loaded');
        this.debugLog(`Session loaded: ${sessionId}`);
        return state;
      }
    }

    throw SessionError.sessionNotFound(sessionId);
  }

  /**
   * Load a session from disk by ID.
   */
  private async loadSessionFromDisk(sessionId: string): Promise<SessionState | null> {
    this.debugLog(`loadSessionFromDisk: ${sessionId}`);

    if (!this.sessionPaths) {
      this.debugLog('loadSessionFromDisk: No session paths configured');
      return null;
    }

    // Determine if it's a named or workspace session
    const isNamed = sessionId.startsWith('named-');

    if (isNamed) {
      // Named session: extract name from ID
      const name = sessionId.slice(6); // Remove 'named-' prefix
      const sanitizedName = this.sanitizeFilename(name);
      const filePath = `${this.sessionPaths.namedSessionsDir}/${sanitizedName}.json`;
      this.debugLog(`loadSessionFromDisk: Loading named session from ${filePath}`);
      return this.loadSessionFile(filePath);
    } else {
      // Workspace session: extract hash or try to find by workspace
      const hash = sessionId.startsWith('workspace-')
        ? sessionId.slice(10) // Remove 'workspace-' prefix
        : sessionId;

      // Try direct hash lookup first
      const directPath = `${this.sessionPaths.workspaceSessionsDir}/${hash}.json`;
      this.debugLog(`loadSessionFromDisk: Trying direct path ${directPath}`);
      const directResult = await this.loadSessionFile(directPath);
      if (directResult) {
        this.debugLog('loadSessionFromDisk: Found session at direct path');
        return directResult;
      }

      // If workspace root is set, try hash of current workspace
      if (this.workspaceRoot) {
        const workspaceHash = this.getWorkspaceHash(this.workspaceRoot);
        const workspacePath = `${this.sessionPaths.workspaceSessionsDir}/${workspaceHash}.json`;
        this.debugLog(`loadSessionFromDisk: Trying workspace path ${workspacePath}`);
        return this.loadSessionFile(workspacePath);
      }
    }

    this.debugLog('loadSessionFromDisk: Session not found');
    return null;
  }

  /**
   * Load and parse a session file.
   */
  private async loadSessionFile(filePath: string): Promise<SessionState | null> {
    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();
      this.debugLog(`loadSessionFile: ${filePath} (exists: ${exists})`);

      if (!exists) {
        return null;
      }

      const content = await file.text();
      const state = JSON.parse(content) as SessionState;

      // Validate version
      if (!state.version || state.version < 1) {
        this.debugLog(`Invalid session version in ${filePath}`);
        return null;
      }

      this.debugLog(`loadSessionFile: Loaded session with ${state.documents?.length ?? 0} documents`);
      return state;
    } catch (error) {
      this.debugLog(`Failed to load session file ${filePath}: ${error}`);
      return null;
    }
  }

  /**
   * Try to load the last session for the current workspace.
   */
  async tryLoadLastSession(): Promise<SessionState | null> {
    this.debugLog(`tryLoadLastSession called for workspace: ${this.workspaceRoot}`);

    if (!this.sessionPaths) {
      this.debugLog('No session paths configured');
      return null;
    }
    if (!this.workspaceRoot) {
      this.debugLog('No workspace root set');
      return null;
    }

    try {
      // Read last-session.json
      const file = Bun.file(this.sessionPaths.lastSessionFile);
      this.debugLog(`Checking last session file: ${this.sessionPaths.lastSessionFile}`);

      if (!(await file.exists())) {
        this.debugLog('Last session file does not exist');
        return null;
      }

      const content = await file.text();
      const lastSession = JSON.parse(content) as {
        sessionId: string;
        workspaceRoot: string;
        timestamp: string;
      };

      this.debugLog(`Last session found: id=${lastSession.sessionId}, workspace=${lastSession.workspaceRoot}`);

      // Only load if it matches the current workspace
      if (lastSession.workspaceRoot !== this.workspaceRoot) {
        this.debugLog(`Last session workspace mismatch: expected ${this.workspaceRoot}, got ${lastSession.workspaceRoot}`);
        return null;
      }

      // Load the session
      this.debugLog(`Loading session: ${lastSession.sessionId}`);
      const session = await this.loadSession(lastSession.sessionId);
      this.debugLog(`Session loaded: ${session?.documents?.length ?? 0} documents`);
      return session;
    } catch (error) {
      this.debugLog(`Failed to load last session: ${error}`);
      return null;
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];

    // Include current session if exists
    if (this.currentSession) {
      sessions.push({
        id: this.getSessionId(this.currentSession),
        name: this.currentSession.sessionName || 'Current Session',
        type: this.currentSession.sessionName ? 'named' : 'workspace',
        workspaceRoot: this.currentSession.workspaceRoot,
        lastModified: this.currentSession.timestamp,
        documentCount: this.currentSession.documents.length,
      });
    }

    // Scan disk if paths configured
    if (this.sessionPaths) {
      const diskSessions = await this.scanSessionsFromDisk();

      // Merge, avoiding duplicates
      for (const session of diskSessions) {
        if (!sessions.find((s) => s.id === session.id)) {
          sessions.push(session);
        }
      }
    }

    // Sort by last modified (newest first)
    sessions.sort((a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    );

    return sessions;
  }

  /**
   * Scan session files from disk.
   */
  private async scanSessionsFromDisk(): Promise<SessionInfo[]> {
    if (!this.sessionPaths) return [];

    const sessions: SessionInfo[] = [];

    // Scan workspace sessions
    try {
      const workspaceDir = this.sessionPaths.workspaceSessionsDir;
      const workspaceFiles = await this.safeReadDir(workspaceDir);

      for (const file of workspaceFiles) {
        if (!file.endsWith('.json')) continue;

        const filePath = `${workspaceDir}/${file}`;
        const state = await this.loadSessionFile(filePath);
        if (state) {
          sessions.push({
            id: this.getSessionId(state),
            name: `Workspace: ${this.getWorkspaceName(state.workspaceRoot)}`,
            type: 'workspace',
            workspaceRoot: state.workspaceRoot,
            lastModified: state.timestamp,
            documentCount: state.documents.length,
          });
        }
      }
    } catch (error) {
      this.debugLog(`Failed to scan workspace sessions: ${error}`);
    }

    // Scan named sessions
    try {
      const namedDir = this.sessionPaths.namedSessionsDir;
      const namedFiles = await this.safeReadDir(namedDir);

      for (const file of namedFiles) {
        if (!file.endsWith('.json')) continue;

        const filePath = `${namedDir}/${file}`;
        const state = await this.loadSessionFile(filePath);
        if (state) {
          sessions.push({
            id: this.getSessionId(state),
            name: state.sessionName || file.replace('.json', ''),
            type: 'named',
            workspaceRoot: state.workspaceRoot,
            lastModified: state.timestamp,
            documentCount: state.documents.length,
          });
        }
      }
    } catch (error) {
      this.debugLog(`Failed to scan named sessions: ${error}`);
    }

    return sessions;
  }

  /**
   * Safely read a directory, returning empty array if it doesn't exist.
   */
  private async safeReadDir(path: string): Promise<string[]> {
    try {
      return await readdir(path);
    } catch {
      return [];
    }
  }

  /**
   * Extract a readable workspace name from path.
   */
  private getWorkspaceName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  }

  async deleteSession(sessionId: string): Promise<void> {
    // Clear from memory if it's the current session
    if (this.currentSession && this.getSessionId(this.currentSession) === sessionId) {
      this.currentSession = null;
    }

    // Delete from disk
    if (this.sessionPaths) {
      const deleted = await this.deleteSessionFromDisk(sessionId);
      if (deleted) {
        this.emitSessionChange(sessionId, 'deleted');
        this.debugLog(`Session deleted: ${sessionId}`);
        return;
      }
    }

    throw SessionError.sessionNotFound(sessionId);
  }

  /**
   * Delete a session file from disk.
   */
  private async deleteSessionFromDisk(sessionId: string): Promise<boolean> {
    if (!this.sessionPaths) return false;

    const isNamed = sessionId.startsWith('named-');

    if (isNamed) {
      const name = sessionId.slice(6);
      const sanitizedName = this.sanitizeFilename(name);
      const filePath = `${this.sessionPaths.namedSessionsDir}/${sanitizedName}.json`;

      try {
        await unlink(filePath);
        return true;
      } catch {
        return false;
      }
    } else {
      // Workspace session - need to find the file
      const hash = sessionId.startsWith('workspace-')
        ? sessionId.slice(10)
        : sessionId;

      const filePath = `${this.sessionPaths.workspaceSessionsDir}/${hash}.json`;

      try {
        await unlink(filePath);
        return true;
      } catch {
        // Try finding by scanning
        const files = await this.safeReadDir(this.sessionPaths.workspaceSessionsDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const fullPath = `${this.sessionPaths.workspaceSessionsDir}/${file}`;
          const state = await this.loadSessionFile(fullPath);
          if (state && this.getSessionId(state) === sessionId) {
            await unlink(fullPath);
            return true;
          }
        }
        return false;
      }
    }
  }

  getCurrentSession(): SessionState | null {
    return this.currentSession;
  }

  setCurrentSession(state: SessionState): void {
    this.currentSession = state;
  }

  markSessionDirty(): void {
    this.isDirty = true;
    this.debugLog('Session marked dirty');
  }

  /**
   * Check if the session has unsaved changes.
   */
  isSessionDirty(): boolean {
    return this.isDirty;
  }

  /**
   * Start the auto-save timer.
   */
  startAutoSave(interval?: number): void {
    // Stop any existing timer
    this.stopAutoSave();

    // Use provided interval or default
    const saveInterval = interval ?? this.autoSaveInterval;
    this.autoSaveInterval = saveInterval;

    this.autoSaveTimer = setInterval(async () => {
      if (this.isDirty && this.sessionPaths) {
        try {
          await this.saveSession();
          this.debugLog('Auto-saved session');
        } catch (error) {
          this.debugLog(`Auto-save failed: ${error}`);
        }
      }
    }, saveInterval);

    this.debugLog(`Auto-save started (${saveInterval}ms interval)`);
  }

  /**
   * Stop the auto-save timer.
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      this.debugLog('Auto-save stopped');
    }
  }

  /**
   * Set the auto-save interval.
   */
  setAutoSaveInterval(interval: number): void {
    this.autoSaveInterval = interval;
    // Restart timer if running
    if (this.autoSaveTimer) {
      this.startAutoSave(interval);
    }
  }

  onSessionChange(callback: SessionChangeCallback): Unsubscribe {
    this.sessionChangeCallbacks.add(callback);
    return () => {
      this.sessionChangeCallbacks.delete(callback);
    };
  }

  private emitSessionChange(sessionId: string, type: 'saved' | 'loaded' | 'deleted'): void {
    const event = { sessionId, type };
    for (const callback of this.sessionChangeCallbacks) {
      try {
        callback(event);
      } catch (error) {
        this.debugLog(`Session change callback error: ${error}`);
      }
    }
  }

  private generateSessionId(workspacePath: string): string {
    // Use the same hash as getWorkspaceHash for consistency
    return `workspace-${this.getWorkspaceHash(workspacePath)}`;
  }

  private getSessionId(session: SessionState): string {
    if (session.sessionName) {
      return `named-${session.sessionName}`;
    }
    return this.generateSessionId(session.workspaceRoot);
  }

  private createEmptySession(): SessionState {
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      instanceId: `${Date.now()}-${process.pid}`,
      workspaceRoot: this.workspaceRoot || '',
      documents: [],
      activeDocumentPath: null,
      activePaneId: 'main',
      layout: DEFAULT_LAYOUT,
      ui: { ...DEFAULT_UI_STATE },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keybindings
  // ─────────────────────────────────────────────────────────────────────────

  getKeybindings(): KeyBinding[] {
    return [...this.keybindings];
  }

  setKeybindings(bindings: KeyBinding[]): void {
    this.keybindings = [...bindings];
    this.debugLog(`Set ${bindings.length} keybindings`);
  }

  addKeybinding(binding: KeyBinding): void {
    // Remove existing binding for same key
    this.keybindings = this.keybindings.filter(b => b.key !== binding.key);
    this.keybindings.push(binding);
    this.debugLog(`Added keybinding: ${binding.key} -> ${binding.command}`);
  }

  removeKeybinding(key: string): void {
    const before = this.keybindings.length;
    this.keybindings = this.keybindings.filter(b => b.key !== key);
    if (this.keybindings.length < before) {
      this.debugLog(`Removed keybinding: ${key}`);
    }
  }

  resolveKeybinding(key: ParsedKey): string | null {
    const keyString = this.formatKey(key);

    for (const binding of this.keybindings) {
      if (binding.key === keyString) {
        // TODO: Evaluate when clause if present
        return binding.command;
      }
    }

    return null;
  }

  getBindingForCommand(commandId: string): string | null {
    const binding = this.keybindings.find(b => b.command === commandId);
    return binding?.key ?? null;
  }

  private formatKey(key: ParsedKey): string {
    const parts: string[] = [];
    if (key.ctrl) parts.push('ctrl');
    if (key.alt) parts.push('alt');
    if (key.shift) parts.push('shift');
    if (key.meta) parts.push('meta');
    parts.push(key.key.toLowerCase());
    return parts.join('+');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Themes
  // ─────────────────────────────────────────────────────────────────────────

  listThemes(): ThemeInfo[] {
    const themes: ThemeInfo[] = [];
    for (const [id, theme] of this.themes) {
      themes.push({
        id,
        name: theme.name,
        type: theme.type,
        builtin: true,
      });
    }
    return themes;
  }

  getTheme(themeId: string): Theme | null {
    return this.themes.get(themeId) ?? null;
  }

  setTheme(themeId: string): void {
    if (!this.themes.has(themeId)) {
      throw SessionError.themeNotFound(themeId);
    }

    this.currentThemeId = themeId;
    this.setSetting('workbench.colorTheme', themeId);
    this.debugLog(`Theme set to: ${themeId}`);
  }

  getCurrentTheme(): Theme {
    return this.themes.get(this.currentThemeId) || this.getDefaultTheme();
  }

  private loadBuiltinThemes(): void {
    // Add a simple default theme
    const defaultTheme: Theme = {
      id: 'One Dark',
      name: 'One Dark',
      type: 'dark',
      colors: {
        'editor.background': '#282c34',
        'editor.foreground': '#abb2bf',
        'editor.lineHighlightBackground': '#2c313c',
        'editor.selectionBackground': '#3e4451',
        'editor.findMatchBackground': '#42557b',
        'editor.findMatchHighlightBackground': '#314365',
        'editorCursor.foreground': '#528bff',
        'editorLineNumber.foreground': '#636d83',
        'editorLineNumber.activeForeground': '#abb2bf',
        'sideBar.background': '#21252b',
        'sideBar.foreground': '#abb2bf',
        'statusBar.background': '#21252b',
        'statusBar.foreground': '#9da5b4',
        'terminal.background': '#21252b',
        'terminal.foreground': '#abb2bf',
      },
    };

    this.themes.set('One Dark', defaultTheme);

    // Add a light theme
    const lightTheme: Theme = {
      id: 'One Light',
      name: 'One Light',
      type: 'light',
      colors: {
        'editor.background': '#fafafa',
        'editor.foreground': '#383a42',
        'editor.lineHighlightBackground': '#f0f0f0',
        'editor.selectionBackground': '#e5e5e6',
        'editor.findMatchBackground': '#d9ead3',
        'editor.findMatchHighlightBackground': '#e4e4e4',
        'editorCursor.foreground': '#526fff',
        'editorLineNumber.foreground': '#9d9d9f',
        'editorLineNumber.activeForeground': '#383a42',
        'sideBar.background': '#eaeaeb',
        'sideBar.foreground': '#383a42',
        'statusBar.background': '#eaeaeb',
        'statusBar.foreground': '#383a42',
        'terminal.background': '#fafafa',
        'terminal.foreground': '#383a42',
      },
    };

    this.themes.set('One Light', lightTheme);
  }

  private getDefaultTheme(): Theme {
    return this.themes.get('One Dark')!;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async init(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    this.currentThemeId = this.getSetting('workbench.colorTheme');
    // Don't create an empty session here - let tryLoadLastSession() load from disk first
    // If no session is found, setCurrentSession() will be called later
    this.currentSession = null;
    this.initialized = true;
    this.debugLog(`Initialized with workspace: ${workspaceRoot}`);
  }

  async shutdown(): Promise<void> {
    // Stop auto-save timer
    this.stopAutoSave();

    // Save current session if we have one
    if (this.currentSession && this.workspaceRoot) {
      try {
        await this.saveSession();
      } catch (error) {
        this.debugLog(`Failed to save session on shutdown: ${error}`);
      }
    }

    this.initialized = false;
    this.debugLog('Shutdown complete');
  }

  getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

  setWorkspaceRoot(path: string): void {
    this.workspaceRoot = path;
    if (this.currentSession) {
      this.currentSession.workspaceRoot = path;
    }
  }
}

export const localSessionService = new LocalSessionService();
export default localSessionService;
