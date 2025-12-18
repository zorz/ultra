/**
 * Session Manager
 *
 * Manages session state persistence for the Ultra editor.
 * Sessions are tied to workspace paths or can be named for explicit management.
 *
 * Storage locations:
 *   - <configDir>/sessions/paths/<hash>.json - Auto sessions by workspace path
 *   - <configDir>/sessions/named/<name>.json - Named sessions
 *   - <configDir>/sessions/last-session.json - Tracks last opened session
 *
 * Features:
 *   - Auto-save every 30 seconds
 *   - Save on close
 *   - Multiple instance detection via lock files
 *   - Missing file handling
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { debugLog } from '../debug.ts';
import { settings } from '../config/settings.ts';
import { userConfigManager } from '../config/user-config.ts';

/** Version of the session file format */
const SESSION_VERSION = 1;

/** Auto-save interval in milliseconds (30 seconds) */
const AUTO_SAVE_INTERVAL = 30000;

/**
 * State for a single document in a session
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
}

/**
 * Pane layout state
 */
export interface SessionPaneState {
  /** Pane identifier */
  id: string;
  /** Layout type of pane's children (if split) */
  splitType?: 'horizontal' | 'vertical';
  /** Split ratio (0-1) */
  splitRatio?: number;
  /** Active document path in this pane */
  activeDocumentPath: string | null;
}

/**
 * UI state
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
  /** AI panel state (history buffer, etc.) */
  aiPanelState?: Record<string, unknown>;
}

/**
 * Pane layout tree structure
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
 * Complete session state
 */
export interface SessionData {
  /** Session file format version */
  version: number;
  /** When this session was last saved */
  timestamp: string;
  /** Instance ID that owns this session (for multi-instance detection) */
  instanceId: string;
  /** Workspace root path */
  workspaceRoot: string;
  /** Session name (for named sessions) */
  sessionName?: string;
  /** All open documents */
  documents: SessionDocumentState[];
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
 * Last session reference (for opening most recent)
 */
export interface LastSessionRef {
  /** Session type */
  type: 'path' | 'named';
  /** Workspace path (for path sessions) or session name (for named) */
  identifier: string;
  /** Full path to session file */
  sessionPath: string;
  /** When this was opened */
  timestamp: string;
}

/**
 * Session Manager
 */
export class SessionManager {
  private _debugName = 'SessionManager';
  private sessionsDir: string = '';
  private pathsDir: string = '';
  private namedDir: string = '';
  private lastSessionPath: string = '';
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private instanceId: string;
  private currentSessionPath: string | null = null;
  private currentWorkspaceRoot: string | null = null;
  private isDirty: boolean = false;
  private initialized: boolean = false;

  /** Callbacks for session events */
  private onSessionLoadCallback?: (data: SessionData) => Promise<void>;
  private onSessionSaveCallback?: () => SessionData | null;
  private onMultiInstanceWarningCallback?: (existingInstanceId: string) => void;

  constructor() {
    // Generate unique instance ID for this process
    this.instanceId = `${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Initialize paths based on config directory
   * Must be called after userConfigManager is initialized
   */
  private initializePaths(): void {
    if (this.initialized) return;

    const configDir = userConfigManager.getConfigDir();
    this.sessionsDir = path.join(configDir, 'sessions');
    this.pathsDir = path.join(this.sessionsDir, 'paths');
    this.namedDir = path.join(this.sessionsDir, 'named');
    this.lastSessionPath = path.join(this.sessionsDir, 'last-session.json');
    this.initialized = true;
  }

  protected debugLog(msg: string): void {
    debugLog(`[${this._debugName}] ${msg}`);
  }

  /**
   * Initialize session directories
   */
  async init(): Promise<void> {
    // Initialize paths from config directory
    this.initializePaths();

    try {
      await fs.promises.mkdir(this.pathsDir, { recursive: true });
      await fs.promises.mkdir(this.namedDir, { recursive: true });
      this.debugLog(`Session directories initialized at ${this.sessionsDir}`);
    } catch (error) {
      this.debugLog(`Failed to create session directories: ${error}`);
    }
  }

  /**
   * Set callback for loading sessions
   */
  onSessionLoad(callback: (data: SessionData) => Promise<void>): void {
    this.onSessionLoadCallback = callback;
  }

  /**
   * Set callback for saving sessions
   */
  onSessionSave(callback: () => SessionData | null): void {
    this.onSessionSaveCallback = callback;
  }

  /**
   * Set callback for multi-instance warning
   */
  onMultiInstanceWarning(callback: (existingInstanceId: string) => void): void {
    this.onMultiInstanceWarningCallback = callback;
  }

  /**
   * Generate hash for workspace path
   */
  private hashPath(workspacePath: string): string {
    // Normalize path and create SHA-256 hash
    const normalized = path.resolve(workspacePath).toLowerCase();
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  }

  /**
   * Get session file path for a workspace
   */
  getSessionPathForWorkspace(workspacePath: string): string {
    const hash = this.hashPath(workspacePath);
    return path.join(this.pathsDir, `${hash}.json`);
  }

  /**
   * Get session file path for a named session
   */
  getNamedSessionPath(sessionName: string): string {
    // Sanitize name for filesystem
    const safeName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.namedDir, `${safeName}.json`);
  }

  /**
   * Check if a session exists for workspace
   */
  async hasSessionForWorkspace(workspacePath: string): Promise<boolean> {
    const sessionPath = this.getSessionPathForWorkspace(workspacePath);
    return this.fileExists(sessionPath);
  }

  /**
   * Check if a named session exists
   */
  async hasNamedSession(sessionName: string): Promise<boolean> {
    const sessionPath = this.getNamedSessionPath(sessionName);
    return this.fileExists(sessionPath);
  }

  /**
   * Load session for a workspace path
   */
  async loadWorkspaceSession(workspacePath: string): Promise<SessionData | null> {
    const sessionPath = this.getSessionPathForWorkspace(workspacePath);
    return this.loadSessionFromFile(sessionPath, workspacePath);
  }

  /**
   * Load a named session
   */
  async loadNamedSession(sessionName: string): Promise<SessionData | null> {
    const sessionPath = this.getNamedSessionPath(sessionName);
    return this.loadSessionFromFile(sessionPath);
  }

  /**
   * Load session from a specific file
   */
  private async loadSessionFromFile(sessionPath: string, expectedWorkspace?: string): Promise<SessionData | null> {
    try {
      if (!await this.fileExists(sessionPath)) {
        this.debugLog(`No session file at ${sessionPath}`);
        return null;
      }

      const content = await fs.promises.readFile(sessionPath, 'utf-8');
      const data = JSON.parse(content) as SessionData;

      // Version check
      if (data.version !== SESSION_VERSION) {
        this.debugLog(`Session version mismatch: ${data.version} vs ${SESSION_VERSION}`);
        // Could add migration logic here
        return null;
      }

      // Check for multi-instance conflict
      if (data.instanceId && data.instanceId !== this.instanceId) {
        // Check if other instance is still active (session modified recently)
        const sessionStat = await fs.promises.stat(sessionPath);
        const ageMs = Date.now() - sessionStat.mtime.getTime();

        // If session was modified in last 60 seconds, another instance might be active
        if (ageMs < 60000) {
          this.debugLog(`Possible multi-instance conflict, age: ${ageMs}ms`);
          if (this.onMultiInstanceWarningCallback) {
            this.onMultiInstanceWarningCallback(data.instanceId);
          }
          // Continue anyway but warn user - create a new session
          data.instanceId = this.instanceId;
        }
      }

      // Update our instance ownership
      data.instanceId = this.instanceId;

      this.currentSessionPath = sessionPath;
      this.currentWorkspaceRoot = data.workspaceRoot;

      this.debugLog(`Loaded session from ${sessionPath}`);
      return data;

    } catch (error) {
      this.debugLog(`Failed to load session: ${error}`);
      return null;
    }
  }

  /**
   * Load the last opened session
   */
  async loadLastSession(): Promise<SessionData | null> {
    try {
      if (!await this.fileExists(this.lastSessionPath)) {
        return null;
      }

      const content = await fs.promises.readFile(this.lastSessionPath, 'utf-8');
      const ref = JSON.parse(content) as LastSessionRef;

      if (ref.type === 'path') {
        return this.loadSessionFromFile(ref.sessionPath, ref.identifier);
      } else {
        return this.loadSessionFromFile(ref.sessionPath);
      }
    } catch (error) {
      this.debugLog(`Failed to load last session ref: ${error}`);
      return null;
    }
  }

  /**
   * Save current session for workspace
   */
  async saveWorkspaceSession(workspacePath: string): Promise<void> {
    this.debugLog(`saveWorkspaceSession called with path: ${workspacePath}`);
    this.debugLog(`initialized: ${this.initialized}, pathsDir: ${this.pathsDir}`);

    // Ensure paths are initialized
    if (!this.initialized) {
      this.debugLog('WARNING: Paths not initialized, calling initializePaths()');
      this.initializePaths();
    }

    if (!this.onSessionSaveCallback) {
      this.debugLog('No save callback registered');
      return;
    }

    const sessionData = this.onSessionSaveCallback();
    if (!sessionData) {
      this.debugLog('No session data to save');
      return;
    }

    this.debugLog(`Session data has ${sessionData.documents.length} documents`);

    sessionData.workspaceRoot = workspacePath;
    sessionData.instanceId = this.instanceId;
    sessionData.timestamp = new Date().toISOString();

    const sessionPath = this.getSessionPathForWorkspace(workspacePath);
    this.debugLog(`Saving to: ${sessionPath}`);
    await this.saveSessionToFile(sessionPath, sessionData);

    // Update last session reference
    await this.updateLastSession('path', workspacePath, sessionPath);

    this.currentSessionPath = sessionPath;
    this.currentWorkspaceRoot = workspacePath;
    this.isDirty = false;
  }

  /**
   * Save current session with a name
   */
  async saveNamedSession(sessionName: string, workspacePath: string): Promise<void> {
    if (!this.onSessionSaveCallback) {
      this.debugLog('No save callback registered');
      return;
    }

    const sessionData = this.onSessionSaveCallback();
    if (!sessionData) {
      this.debugLog('No session data to save');
      return;
    }

    sessionData.workspaceRoot = workspacePath;
    sessionData.sessionName = sessionName;
    sessionData.instanceId = this.instanceId;
    sessionData.timestamp = new Date().toISOString();

    const sessionPath = this.getNamedSessionPath(sessionName);
    await this.saveSessionToFile(sessionPath, sessionData);

    // Update last session reference
    await this.updateLastSession('named', sessionName, sessionPath);

    this.isDirty = false;
  }

  /**
   * Save session data to file
   */
  private async saveSessionToFile(sessionPath: string, data: SessionData): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(sessionPath);
      this.debugLog(`Ensuring directory exists: ${dir}`);
      await fs.promises.mkdir(dir, { recursive: true });

      const content = JSON.stringify(data, null, 2);
      this.debugLog(`Writing ${content.length} bytes to ${sessionPath}`);
      await fs.promises.writeFile(sessionPath, content, 'utf-8');
      this.debugLog(`Saved session to ${sessionPath}`);
    } catch (error) {
      this.debugLog(`Failed to save session: ${error}`);
      throw error; // Re-throw so caller knows it failed
    }
  }

  /**
   * Update last session reference
   */
  private async updateLastSession(type: 'path' | 'named', identifier: string, sessionPath: string): Promise<void> {
    try {
      const ref: LastSessionRef = {
        type,
        identifier,
        sessionPath,
        timestamp: new Date().toISOString()
      };
      await fs.promises.writeFile(this.lastSessionPath, JSON.stringify(ref, null, 2), 'utf-8');
    } catch (error) {
      this.debugLog(`Failed to update last session ref: ${error}`);
    }
  }

  /**
   * Save current session (to current session file)
   */
  async saveCurrentSession(): Promise<void> {
    if (this.currentWorkspaceRoot) {
      await this.saveWorkspaceSession(this.currentWorkspaceRoot);
    }
  }

  /**
   * Mark session as dirty (needs saving)
   */
  markDirty(): void {
    this.isDirty = true;
  }

  /**
   * Start auto-save timer
   */
  startAutoSave(): void {
    if (this.autoSaveTimer) {
      return;
    }

    // Check if auto-save is enabled in settings
    const enabled = settings.get('session.autoSave' as any) ?? true;
    if (!enabled) {
      this.debugLog('Auto-save disabled in settings');
      return;
    }

    const interval = settings.get('session.autoSaveInterval' as any) ?? AUTO_SAVE_INTERVAL;

    this.autoSaveTimer = setInterval(async () => {
      if (this.isDirty && this.currentWorkspaceRoot) {
        this.debugLog('Auto-saving session...');
        await this.saveCurrentSession();
      }
    }, interval);

    this.debugLog(`Auto-save started with interval ${interval}ms`);
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      this.debugLog('Auto-save stopped');
    }
  }

  /**
   * Get list of named sessions
   */
  async getNamedSessions(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.namedDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Delete a named session
   */
  async deleteNamedSession(sessionName: string): Promise<void> {
    const sessionPath = this.getNamedSessionPath(sessionName);
    try {
      await fs.promises.unlink(sessionPath);
      this.debugLog(`Deleted session: ${sessionName}`);
    } catch (error) {
      this.debugLog(`Failed to delete session: ${error}`);
    }
  }

  /**
   * Delete workspace session
   */
  async deleteWorkspaceSession(workspacePath: string): Promise<void> {
    const sessionPath = this.getSessionPathForWorkspace(workspacePath);
    try {
      await fs.promises.unlink(sessionPath);
      this.debugLog(`Deleted workspace session for: ${workspacePath}`);
    } catch (error) {
      this.debugLog(`Failed to delete workspace session: ${error}`);
    }
  }

  /**
   * Set current workspace root
   */
  setWorkspaceRoot(workspacePath: string): void {
    this.currentWorkspaceRoot = workspacePath;
    this.currentSessionPath = this.getSessionPathForWorkspace(workspacePath);
  }

  /**
   * Get current workspace root
   */
  getWorkspaceRoot(): string | null {
    return this.currentWorkspaceRoot;
  }

  /**
   * Get instance ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopAutoSave();
  }
}

/**
 * Singleton instance
 */
export const sessionManager = new SessionManager();
export default sessionManager;
