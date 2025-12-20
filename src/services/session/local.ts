/**
 * Local Session Service Implementation
 *
 * Implements SessionService using local storage and the existing
 * Settings and SessionManager classes.
 */

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

  // Event callbacks
  private settingChangeCallbacks = new Set<SettingChangeCallback>();
  private sessionChangeCallbacks = new Set<SessionChangeCallback>();
  private settingKeyCallbacks = new Map<string, Set<(value: unknown) => void>>();

  constructor() {
    this.settings = new Settings();
    this.loadBuiltinThemes();
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

    // In a full implementation, this would persist to disk
    // For now, we just store in memory and emit the event
    this.currentSession = state;

    // Get the consistent sessionId that loadSession will use to find this session
    const sessionId = this.getSessionId(state);

    this.emitSessionChange(sessionId, 'saved');
    this.debugLog(`Session saved: ${sessionId}`);

    return sessionId;
  }

  async loadSession(sessionId: string): Promise<SessionState> {
    // In a full implementation, this would load from disk
    // For now, we return the current session if it matches
    if (this.currentSession && this.getSessionId(this.currentSession) === sessionId) {
      this.emitSessionChange(sessionId, 'loaded');
      return this.currentSession;
    }

    throw SessionError.sessionNotFound(sessionId);
  }

  async listSessions(): Promise<SessionInfo[]> {
    // In a full implementation, this would scan the sessions directory
    const sessions: SessionInfo[] = [];

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

    return sessions;
  }

  async deleteSession(sessionId: string): Promise<void> {
    // In a full implementation, this would delete from disk
    if (this.currentSession && this.getSessionId(this.currentSession) === sessionId) {
      this.currentSession = null;
      this.emitSessionChange(sessionId, 'deleted');
      this.debugLog(`Session deleted: ${sessionId}`);
      return;
    }

    throw SessionError.sessionNotFound(sessionId);
  }

  getCurrentSession(): SessionState | null {
    return this.currentSession;
  }

  setCurrentSession(state: SessionState): void {
    this.currentSession = state;
  }

  markSessionDirty(): void {
    // In a full implementation, this would trigger auto-save
    this.debugLog('Session marked dirty');
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
    // Simple hash for workspace path
    let hash = 0;
    for (let i = 0; i < workspacePath.length; i++) {
      const char = workspacePath.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `workspace-${Math.abs(hash).toString(16)}`;
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
    this.currentSession = this.createEmptySession();
    this.initialized = true;
    this.debugLog(`Initialized with workspace: ${workspaceRoot}`);
  }

  async shutdown(): Promise<void> {
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
