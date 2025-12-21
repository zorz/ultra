/**
 * TUI Client
 *
 * Main orchestrator for the Terminal User Interface.
 * Connects the TUI components to the ECP services.
 */

import type { Size, SplitDirection } from '../types.ts';
import { Window, createWindow, type WindowConfig } from '../window.ts';
import { Renderer, createRenderer } from '../rendering/renderer.ts';
import { TUIInputHandler, createInputHandler } from '../input/input-handler.ts';
import {
  BaseElement,
  DocumentEditor,
  FileTree,
  GitPanel,
  TerminalSession,
  TerminalPanel,
  createTerminalPanel,
  createTestContext,
  registerBuiltinElements,
  type FileNode,
  type DocumentEditorCallbacks,
  type FileTreeCallbacks,
  type GitPanelCallbacks,
  type TerminalSessionCallbacks,
} from '../elements/index.ts';
import type { Pane } from '../layout/pane.ts';

// Dialog system
import {
  DialogManager,
  createDialogManager,
  type Command,
  type FileEntry,
  type StagedFile,
} from '../overlays/index.ts';

// Debug utilities
import { debugLog, isDebugEnabled } from '../../../debug.ts';

// Config
import { TUIConfigManager, createTUIConfigManager } from '../config/index.ts';
import { defaultThemes } from '../../../config/defaults.ts';

// Services
import { localDocumentService, type DocumentService } from '../../../services/document/index.ts';
import { fileService, type FileService } from '../../../services/file/index.ts';
import { gitCliService } from '../../../services/git/index.ts';
import { localSyntaxService, type SyntaxService, type HighlightToken } from '../../../services/syntax/index.ts';
import {
  localSessionService,
  type SessionState,
  type SessionDocumentState,
  type SessionLayoutNode,
  type SessionUIState,
} from '../../../services/session/index.ts';

// ============================================
// Types
// ============================================

export interface TUIClientOptions {
  /** Working directory */
  workingDirectory?: string;
  /** Initial file to open */
  initialFile?: string;
  /** Theme colors (will be integrated with theme system) */
  theme?: Record<string, string>;
  /** Enable debug mode */
  debug?: boolean;
  /** Called when the client exits */
  onExit?: () => void;
}

export interface OpenFileOptions {
  /** Focus the editor after opening */
  focus?: boolean;
  /** Pane to open in (default: focused pane) */
  pane?: Pane;
}

// ============================================
// TUI Client
// ============================================

export class TUIClient {
  /** The main window */
  private window: Window;

  /** Terminal renderer */
  private renderer: Renderer;

  /** Input handler */
  private inputHandler: TUIInputHandler;

  /** Working directory */
  private workingDirectory: string;

  /** Theme colors */
  private theme: Record<string, string>;

  /** Document service */
  private documentService: DocumentService;

  /** File service */
  private fileService: FileService;

  /** Syntax service */
  private syntaxService: SyntaxService;

  /** Open documents by URI -> editor mapping */
  private openDocuments = new Map<string, { documentId: string; editorId: string; syntaxSessionId?: string }>();

  /** Whether client is running */
  private running = false;

  /** Render scheduled flag */
  private renderScheduled = false;

  /** Debug mode */
  private debug: boolean;

  /** Exit callback */
  private onExitCallback?: () => void;

  /** Config manager */
  private configManager: TUIConfigManager;

  /** Last focused editor pane ID (for opening files from sidebar) */
  private lastFocusedEditorPaneId: string | null = null;

  /** Dialog manager */
  private dialogManager: DialogManager | null = null;

  /** Command handlers */
  private commandHandlers: Map<string, () => boolean | Promise<boolean>> = new Map();

  /** Editor pane ID */
  private editorPaneId: string | null = null;

  /** Sidebar pane ID */
  private sidebarPaneId: string | null = null;

  /** Git status polling interval */
  private gitStatusInterval: ReturnType<typeof setInterval> | null = null;

  /** Git status polling rate in ms */
  private static readonly GIT_STATUS_POLL_INTERVAL = 1000;

  /** Terminal panel */
  private terminalPanel: TerminalPanel | null = null;

  /** Terminal panel visible */
  private terminalPanelVisible = false;

  /** Terminal panel height (in rows) - loaded from config in start() */
  private terminalPanelHeight = 10;

  /** Whether terminal panel has focus */
  private terminalFocused = false;

  constructor(options: TUIClientOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.debug = options.debug ?? false;
    this.theme = options.theme ?? this.getDefaultTheme();
    this.onExitCallback = options.onExit;

    // Create config manager
    this.configManager = createTUIConfigManager(this.workingDirectory);

    // Register element types with factory
    registerBuiltinElements();

    // Register command handlers
    this.registerCommands();

    // Initialize services
    this.documentService = localDocumentService;
    this.fileService = fileService;
    this.syntaxService = localSyntaxService;

    // Get terminal size
    const size = this.getTerminalSize();

    // Create renderer
    this.renderer = createRenderer(size, {
      alternateScreen: true,
      mouseTracking: true,
      bracketedPaste: true,
    });

    // Create window
    const windowConfig: WindowConfig = {
      size,
      getThemeColor: (key, fallback) => this.getThemeColor(key, fallback),
      onDirty: () => this.scheduleRender(),
      onElementClose: (elementId, element) => this.handleElementClose(elementId, element),
      onFocusChange: (_prevElemId, _nextElemId, _prevPaneId, nextPaneId) => {
        // Track last focused editor pane (for opening files from sidebar)
        if (nextPaneId) {
          const pane = this.window.getPaneContainer().getPane(nextPaneId);
          if (pane && pane.getMode() === 'tabs') {
            this.lastFocusedEditorPaneId = nextPaneId;
          }
        }

        // Look up the focused element and update status bar
        const focusedElement = this.window.getFocusedElement();
        this.handleFocusChange(focusedElement);
      },
    };
    this.window = createWindow(windowConfig);

    // Create dialog manager
    this.dialogManager = createDialogManager(this.window.getOverlayManager(), {
      onDirty: () => this.scheduleRender(),
      getThemeColor: (key, fallback) => this.getThemeColor(key, fallback),
      getScreenSize: () => this.getTerminalSize(),
    });

    // Create input handler
    this.inputHandler = createInputHandler();

    // Setup input routing
    this.setupInputHandling();

    // Handle terminal resize
    this.setupResizeHandler();

    // Note: keybindings are set up in start() after config is loaded
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the TUI client.
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;

    // Load configuration
    await this.configManager.load();
    this.log('Configuration loaded');

    // Apply terminal panel height from config
    this.terminalPanelHeight = this.configManager.getWithDefault('tui.terminal.height', 10);
    this.log(`Terminal panel height: ${this.terminalPanelHeight}`);

    // Apply theme from config
    const themeName = this.configManager.get('workbench.colorTheme') ?? 'catppuccin-frappe';
    this.theme = this.loadThemeColors(themeName);
    this.log(`Theme: ${themeName}`);

    // Initialize session service (before layout setup)
    await this.initSessionService();

    // Initialize syntax service
    await this.syntaxService.waitForReady();
    this.syntaxService.setTheme(themeName);
    this.log('Syntax service ready');

    // Initialize renderer
    this.renderer.initialize();

    // Start window
    this.window.start();

    // Start input handler
    this.inputHandler.start();

    // Setup keybindings from config
    this.setupKeybindings();

    // Setup initial layout
    await this.setupInitialLayout();

    // Try to restore the last session
    const restored = await this.tryRestoreSession();
    if (restored) {
      this.log('Restored previous session');
    }

    // Start git status polling
    this.startGitStatusPolling();

    // Initial render
    this.render();

    this.log('TUI Client started');
  }

  /**
   * Stop the TUI client.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Stop git status polling
    this.stopGitStatusPolling();

    // Save session before shutdown (serialize current state first)
    try {
      const state = this.serializeSession();
      localSessionService.setCurrentSession(state);
      await localSessionService.shutdown();
      this.log('Session saved');
    } catch (error) {
      this.log(`Failed to save session: ${error}`);
    }

    // Stop input handler
    this.inputHandler.stop();

    // Stop window
    this.window.stop();

    // Cleanup renderer
    this.renderer.cleanup();

    // Close all documents and dispose syntax sessions
    for (const [, { documentId, syntaxSessionId }] of this.openDocuments) {
      await this.documentService.close(documentId);
      if (syntaxSessionId) {
        this.syntaxService.disposeSession(syntaxSessionId);
      }
    }
    this.openDocuments.clear();

    this.log('TUI Client stopped');

    // Call exit callback
    this.onExitCallback?.();
  }

  /**
   * Check if client is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout Setup
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Setup the initial layout with file tree and editor.
   */
  private async setupInitialLayout(): Promise<void> {
    const container = this.window.getPaneContainer();

    // Create root pane for file tree (sidebar)
    const sidePane = container.ensureRoot();
    sidePane.setMode('accordion');
    this.sidebarPaneId = sidePane.id;

    // Add file tree using factory pattern
    const fileTreeId = sidePane.addElement('FileTree', 'Explorer');
    const fileTree = sidePane.getElement(fileTreeId) as FileTree | null;
    if (fileTree) {
      this.configureFileTree(fileTree);
    }

    // Add git panel
    const gitPanelId = sidePane.addElement('GitPanel', 'Source Control');
    const gitPanel = sidePane.getElement(gitPanelId) as GitPanel | null;
    if (gitPanel) {
      this.configureGitPanel(gitPanel);
    }

    // Split for main editor area (vertical = side by side)
    const editorPaneId = container.split('vertical', sidePane.id);
    this.editorPaneId = editorPaneId;

    // Get the editor pane and set it to tabs mode
    const editorPane = container.getPane(editorPaneId);
    if (editorPane) {
      editorPane.setMode('tabs');
    }

    // Adjust split ratio: sidebar ~24 columns, rest for editor
    // The split ID is 'split-1' since it's the first split created
    const sidebarWidth = this.configManager.getWithDefault('tui.sidebar.width', 24);
    const totalWidth = this.window.getSize().width;
    const sidebarRatio = Math.min(0.3, sidebarWidth / totalWidth); // Cap at 30%
    container.adjustRatios('split-1', [sidebarRatio, 1 - sidebarRatio]);

    // Load file tree
    if (fileTree) {
      await this.loadFileTree(fileTree);
    }

    // Load git status
    if (gitPanel) {
      await this.loadGitStatus(gitPanel);
    }

    // Set initial focus to the file tree in sidebar
    if (fileTree) {
      this.window.focusElement(fileTree);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Element Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Configure file tree callbacks.
   */
  private configureFileTree(fileTree: FileTree): void {
    const callbacks: FileTreeCallbacks = {
      onFileOpen: async (path) => {
        await this.openFile(`file://${path}`);
      },
      onExpand: async (_path, _expanded) => {
        // Expansion state is tracked in file tree
      },
      onLoadChildren: async (path) => {
        try {
          const entries = await this.fileService.readDir(`file://${path}`);
          return entries.map((entry) => ({
            name: entry.name,
            path: entry.uri.replace(/^file:\/\//, ''),
            isDirectory: entry.type === 'directory',
          }));
        } catch (error) {
          this.log(`Failed to load directory: ${error}`);
          return [];
        }
      },
    };
    fileTree.setCallbacks(callbacks);
  }

  /**
   * Configure git panel callbacks.
   */
  private configureGitPanel(gitPanel: GitPanel): void {
    const callbacks: GitPanelCallbacks = {
      onStage: async (path) => {
        try {
          await gitCliService.stage(this.workingDirectory, [path]);
          await this.refreshGitStatus();
        } catch (error) {
          this.window.showNotification(`Failed to stage: ${error}`, 'error');
        }
      },
      onStageAll: async () => {
        try {
          await gitCliService.stageAll(this.workingDirectory);
          await this.refreshGitStatus();
        } catch (error) {
          this.window.showNotification(`Failed to stage all: ${error}`, 'error');
        }
      },
      onUnstage: async (path) => {
        try {
          await gitCliService.unstage(this.workingDirectory, [path]);
          await this.refreshGitStatus();
        } catch (error) {
          this.window.showNotification(`Failed to unstage: ${error}`, 'error');
        }
      },
      onDiscard: async (path) => {
        try {
          await gitCliService.discard(this.workingDirectory, [path]);
          await this.refreshGitStatus();
        } catch (error) {
          this.window.showNotification(`Failed to discard: ${error}`, 'error');
        }
      },
      onCommit: () => {
        this.showCommitDialog();
      },
      onRefresh: () => {
        this.refreshGitStatus();
      },
      onOpenFile: async (path) => {
        await this.openFile(`file://${this.workingDirectory}/${path}`);
      },
    };
    gitPanel.setCallbacks(callbacks);
  }

  /**
   * Configure document editor callbacks.
   */
  private configureDocumentEditor(editor: DocumentEditor, uri: string): void {
    // Debounce timer for syntax highlighting updates
    let syntaxUpdateTimer: ReturnType<typeof setTimeout> | null = null;

    const callbacks: DocumentEditorCallbacks = {
      onContentChange: () => {
        // Update status bar (dirty indicator may change)
        this.updateStatusBarFile(editor);

        // Debounce syntax highlighting updates (200ms delay)
        if (syntaxUpdateTimer) {
          clearTimeout(syntaxUpdateTimer);
        }
        syntaxUpdateTimer = setTimeout(() => {
          this.updateSyntaxHighlighting(uri, editor);
        }, 200);
      },
      onCursorChange: () => {
        // Update cursor position in status bar
        this.updateStatusBarFile(editor);
      },
      onSave: () => {
        this.saveCurrentDocument();
      },
    };
    editor.setCallbacks(callbacks);
    editor.setUri(uri);

    // Apply minimap setting
    const minimapEnabled = this.configManager.getWithDefault('editor.minimap.enabled', false);
    editor.setMinimapEnabled(minimapEnabled);

    // Apply word wrap setting (default to 'on' for better terminal experience)
    const wordWrap = this.configManager.getWithDefault('editor.wordWrap', 'on');
    editor.setWordWrapEnabled(wordWrap === 'on');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Open a file in the editor.
   */
  async openFile(uri: string, options: OpenFileOptions = {}): Promise<DocumentEditor | null> {
    // Check if already open
    const existing = this.openDocuments.get(uri);
    if (existing) {
      // Find the editor across all panes
      const editor = this.findEditorById(existing.editorId);
      if (editor) {
        // Editor still exists, just focus it
        if (options.focus !== false) {
          this.window.focusElement(editor);
        }
        return editor;
      }
      // Editor was removed (e.g., tab closed) - clean up stale entry
      this.openDocuments.delete(uri);
      try {
        await this.documentService.close(existing.documentId);
      } catch {
        // Ignore close errors for stale documents
      }
    }

    try {
      // Read file content
      const fileContent = await this.fileService.read(uri);

      // Open document in service
      const result = await this.documentService.open({
        uri,
        content: fileContent.content,
        languageId: this.detectLanguage(uri),
      });

      // Determine which pane to use:
      // 1. Explicit pane from options
      // 2. Focused pane if it's in 'tabs' mode
      // 3. Fall back to default editor pane
      const pane = this.getTargetEditorPane(options.pane);
      if (!pane) {
        this.window.showNotification('No editor pane available', 'error');
        return null;
      }

      // Add editor element via factory
      const filename = uri.split('/').pop() ?? 'untitled';
      const editorId = pane.addElement('DocumentEditor', filename);
      const editor = pane.getElement(editorId) as DocumentEditor | null;

      if (!editor) {
        this.window.showNotification('Failed to create editor', 'error');
        return null;
      }

      // Configure the editor
      this.configureDocumentEditor(editor, uri);
      editor.setContent(fileContent.content);

      // Create syntax session and apply highlighting
      const languageId = this.detectLanguage(uri);
      let syntaxSessionId: string | undefined;
      try {
        const syntaxSession = await this.syntaxService.createSession(
          result.documentId,
          languageId,
          fileContent.content
        );
        syntaxSessionId = syntaxSession.sessionId;
        this.applySyntaxTokens(editor, syntaxSessionId);
      } catch (error) {
        this.log(`Failed to create syntax session: ${error}`);
      }

      // Track open document
      this.openDocuments.set(uri, { documentId: result.documentId, editorId, syntaxSessionId });

      // Focus if requested
      if (options.focus !== false) {
        this.window.focusElement(editor);
      }

      // Update status bar with file info
      this.updateStatusBarFile(editor);

      // Mark session dirty
      this.markSessionDirty();

      this.log(`Opened file: ${uri}`);
      return editor;
    } catch (error) {
      this.window.showNotification(`Failed to open file: ${error}`, 'error');
      return null;
    }
  }

  /**
   * Save the current document.
   */
  async saveCurrentDocument(): Promise<boolean> {
    const editor = this.window.getFocusedElement();
    if (!(editor instanceof DocumentEditor)) {
      this.window.showNotification('No document to save', 'warning');
      return false;
    }

    const uri = editor.getUri();
    if (!uri) {
      this.window.showNotification('Document has no file path', 'warning');
      return false;
    }

    try {
      const content = editor.getContent();
      await this.fileService.write(uri, content);
      this.window.showNotification('File saved', 'success');
      return true;
    } catch (error) {
      this.window.showNotification(`Failed to save: ${error}`, 'error');
      return false;
    }
  }

  /**
   * Close the current document.
   */
  async closeCurrentDocument(): Promise<boolean> {
    const editor = this.window.getFocusedElement();
    if (!(editor instanceof DocumentEditor)) {
      return false;
    }

    const uri = editor.getUri();
    if (uri) {
      const doc = this.openDocuments.get(uri);
      if (doc) {
        await this.documentService.close(doc.documentId);
        this.openDocuments.delete(uri);
      }
    }

    // Remove from pane
    const pane = this.window.getFocusedPane();
    if (pane) {
      pane.removeElement(editor.id);
    }

    // Mark session dirty
    this.markSessionDirty();

    return true;
  }

  /**
   * Handle element close from tab X click.
   * Called before the element is removed from the pane.
   */
  private handleElementClose(_elementId: string, element: BaseElement): void {
    if (element instanceof DocumentEditor) {
      const uri = element.getUri();
      if (uri) {
        const doc = this.openDocuments.get(uri);
        if (doc) {
          // Close document service
          this.documentService.close(doc.documentId).catch((err) => {
            this.log(`Failed to close document: ${err}`);
          });

          // Dispose syntax session
          if (doc.syntaxSessionId) {
            this.syntaxService.disposeSession(doc.syntaxSessionId);
          }

          this.openDocuments.delete(uri);

          // Mark session dirty
          this.markSessionDirty();
        }
      }
    }
  }

  /**
   * Find an editor by ID across all panes.
   */
  private findEditorById(editorId: string): DocumentEditor | null {
    const container = this.window.getPaneContainer();
    for (const pane of container.getPanes()) {
      const element = pane.getElement(editorId);
      if (element instanceof DocumentEditor) {
        return element;
      }
    }
    return null;
  }

  /**
   * Get the target pane for opening a new editor.
   * Priority: explicit pane > focused tabs-mode pane > last focused editor pane > default editor pane
   */
  private getTargetEditorPane(explicitPane?: Pane): Pane | null {
    // 1. Use explicit pane if provided
    if (explicitPane) {
      return explicitPane;
    }

    // 2. Use focused pane if it's in tabs mode
    const focusedPane = this.window.getFocusedPane();
    if (focusedPane && focusedPane.getMode() === 'tabs') {
      return focusedPane;
    }

    // 3. Use last focused editor pane (when focus moved to sidebar)
    if (this.lastFocusedEditorPaneId) {
      const lastPane = this.window.getPaneContainer().getPane(this.lastFocusedEditorPaneId);
      if (lastPane && lastPane.getMode() === 'tabs') {
        return lastPane;
      }
    }

    // 4. Fall back to default editor pane
    return this.getEditorPane();
  }

  /**
   * Get the default editor pane.
   */
  private getEditorPane(): Pane | null {
    if (this.editorPaneId) {
      return this.window.getPaneContainer().getPane(this.editorPaneId);
    }

    // Fallback: find any pane in tabs mode
    const container = this.window.getPaneContainer();
    for (const pane of container.getPanes()) {
      if (pane.getMode() === 'tabs') {
        this.editorPaneId = pane.id;
        return pane;
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File Tree
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load the file tree from the working directory.
   */
  private async loadFileTree(fileTree: FileTree): Promise<void> {
    try {
      const entries = await this.fileService.readDir(`file://${this.workingDirectory}`);

      const nodes: FileNode[] = entries.map((entry) => ({
        name: entry.name,
        path: `${this.workingDirectory}/${entry.name}`,
        isDirectory: entry.type === 'directory',
        children: entry.type === 'directory' ? undefined : undefined,
      }));

      fileTree.setRoots(nodes);
    } catch (error) {
      this.log(`Failed to load file tree: ${error}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Git Status
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load git status into the git panel.
   */
  private async loadGitStatus(gitPanel: GitPanel): Promise<void> {
    try {
      this.log(`Loading git status for: ${this.workingDirectory}`);
      const status = await gitCliService.status(this.workingDirectory, true); // Force refresh
      this.log(`Git status: branch=${status.branch}, staged=${status.staged.length}, unstaged=${status.unstaged.length}, untracked=${status.untracked.length}`);

      // Map service GitStatus to GitPanel's GitState
      // Update status bar with branch and sync info
      this.updateStatusBarBranch(status.branch);
      this.updateStatusBarSync(status.ahead, status.behind);

      gitPanel.setGitState({
        branch: status.branch,
        // upstream not provided by service
        ahead: status.ahead,
        behind: status.behind,
        // Map staged files: status code becomes indexStatus, workingStatus is clean
        staged: status.staged.map((f) => ({
          path: f.path,
          originalPath: f.oldPath,
          indexStatus: f.status,
          workingStatus: ' ' as const,
        })),
        // Map unstaged files: indexStatus is clean, status code becomes workingStatus
        unstaged: status.unstaged.map((f) => ({
          path: f.path,
          indexStatus: ' ' as const,
          workingStatus: f.status,
        })),
        // Map untracked files: both statuses are '?'
        untracked: status.untracked.map((path) => ({
          path,
          indexStatus: '?' as const,
          workingStatus: '?' as const,
        })),
        // merging/rebasing not provided by service - default to false
        merging: false,
        rebasing: false,
      });
    } catch (error) {
      this.log(`Failed to load git status: ${error}`);
    }
  }

  /**
   * Refresh git status.
   */
  private async refreshGitStatus(): Promise<void> {
    // Find git panel and reload
    if (this.sidebarPaneId) {
      const pane = this.window.getPaneContainer().getPane(this.sidebarPaneId);
      if (pane) {
        for (const element of pane.getElements()) {
          if (element instanceof GitPanel) {
            await this.loadGitStatus(element);
            return;
          }
        }
      }
    }
  }

  /**
   * Start polling for git status changes.
   */
  private startGitStatusPolling(): void {
    // Clear any existing interval
    this.stopGitStatusPolling();

    // Poll at regular intervals
    this.gitStatusInterval = setInterval(() => {
      // Don't poll if not running
      if (!this.running) return;

      // Refresh git status (fire and forget, don't await)
      this.refreshGitStatus().catch((err) => {
        this.log(`Git status poll error: ${err}`);
      });
    }, TUIClient.GIT_STATUS_POLL_INTERVAL);

    this.log(`Git status polling started (${TUIClient.GIT_STATUS_POLL_INTERVAL}ms)`);
  }

  /**
   * Stop polling for git status changes.
   */
  private stopGitStatusPolling(): void {
    if (this.gitStatusInterval) {
      clearInterval(this.gitStatusInterval);
      this.gitStatusInterval = null;
      this.log('Git status polling stopped');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Setup input handling from terminal.
   */
  private setupInputHandling(): void {
    // Route key events to window
    this.inputHandler.onKey((event) => {
      // Show shortcut in status bar (only for modifier keys or special keys, not regular typing)
      const shortcutDisplay = this.formatKeyEvent(event);
      if (shortcutDisplay) {
        this.window.showStatusCommand(shortcutDisplay);
      }

      // Check if terminal panel should handle the input first
      if (this.terminalPanelVisible && this.terminalPanel && this.terminalFocused) {
        debugLog(`[TUIClient] Routing key to terminal: ${event.key}`);
        if (this.terminalPanel.handleKey(event)) {
          return;
        }
      }

      this.window.handleInput(event);
    });

    // Route mouse events to window
    this.inputHandler.onMouse((event) => {
      // Check if mouse is in terminal panel area
      if (this.terminalPanelVisible && this.terminalPanel) {
        const bounds = this.terminalPanel.getBounds();
        const inTerminal = event.y >= bounds.y && event.y < bounds.y + bounds.height;

        if (event.type === 'press') {
          if (inTerminal) {
            // Click in terminal - focus it
            debugLog('[TUIClient] Mouse click in terminal, focusing terminal');
            this.setTerminalFocus(true);
            this.terminalPanel.handleMouse(event);
            this.scheduleRender();
            return;
          } else {
            // Click outside terminal - unfocus it
            if (this.terminalFocused) {
              debugLog('[TUIClient] Mouse click outside terminal, unfocusing terminal');
              this.setTerminalFocus(false);
              this.scheduleRender();
            }
          }
        } else if (inTerminal) {
          // Other mouse events in terminal (scroll, etc.)
          if (this.terminalPanel.handleMouse(event)) {
            return;
          }
        }
      }

      this.window.handleInput(event);
    });

    // Handle resize - callback receives width and height separately
    this.inputHandler.onResize((width, height) => {
      this.handleResize({ width, height });
    });
  }

  /**
   * Format a key event for display in the status bar.
   * Returns null for regular typing (single chars without modifiers).
   */
  private formatKeyEvent(event: import('../types.ts').KeyEvent): string | null {
    const parts: string[] = [];

    // Add modifiers
    if (event.ctrl) parts.push('ctrl');
    if (event.alt) parts.push('alt');
    if (event.shift) parts.push('shift');
    if (event.meta) parts.push('meta');

    // Special keys that should always be shown
    const specialKeys = [
      'Escape', 'Enter', 'Tab', 'Backspace', 'Delete',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Home', 'End', 'PageUp', 'PageDown',
      'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    ];

    const isSpecialKey = specialKeys.includes(event.key);
    const hasModifiers = event.ctrl || event.alt || event.meta;

    // Only show if there are modifiers or it's a special key
    if (!hasModifiers && !isSpecialKey) {
      return null;
    }

    // Format the key name
    let keyName = event.key;
    if (keyName.startsWith('Arrow')) {
      keyName = keyName.replace('Arrow', '').toLowerCase();
    } else if (keyName.length === 1) {
      keyName = keyName.toLowerCase();
    }

    parts.push(keyName);
    return parts.join('+');
  }

  /**
   * Register command handlers.
   */
  private registerCommands(): void {
    // File commands
    this.commandHandlers.set('file.save', () => {
      this.saveCurrentDocument();
      return true;
    });

    this.commandHandlers.set('file.close', () => {
      this.closeCurrentDocument();
      return true;
    });

    this.commandHandlers.set('file.open', () => {
      this.window.showNotification('File open dialog not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('file.new', () => {
      this.window.showNotification('New file not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('file.saveAs', () => {
      this.window.showNotification('Save as not yet implemented', 'info');
      return true;
    });

    // Edit commands
    this.commandHandlers.set('edit.undo', () => {
      this.window.showNotification('Undo not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('edit.redo', () => {
      this.window.showNotification('Redo not yet implemented', 'info');
      return true;
    });

    // Search commands
    this.commandHandlers.set('search.find', () => {
      this.window.showNotification('Find not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('search.replace', () => {
      this.window.showNotification('Replace not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('search.findInFiles', () => {
      this.window.showNotification('Find in files not yet implemented', 'info');
      return true;
    });

    // Navigation commands
    this.commandHandlers.set('workbench.quickOpen', async () => {
      await this.showFilePicker();
      return true;
    });

    this.commandHandlers.set('workbench.commandPalette', async () => {
      await this.showCommandPalette();
      return true;
    });

    this.commandHandlers.set('editor.gotoLine', async () => {
      await this.showGotoLine();
      return true;
    });

    this.commandHandlers.set('editor.gotoSymbol', () => {
      this.window.showNotification('Go to symbol not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('workbench.focusNextPane', () => {
      this.window.focusNextPane();
      return true;
    });

    this.commandHandlers.set('workbench.focusPreviousPane', () => {
      this.window.focusPreviousPane();
      return true;
    });

    // View commands
    this.commandHandlers.set('workbench.toggleSidebar', () => {
      this.toggleSidebar();
      return true;
    });

    this.commandHandlers.set('workbench.toggleTerminal', () => {
      this.toggleTerminalPanel();
      return true;
    });

    this.commandHandlers.set('workbench.openSettings', async () => {
      const paths = this.configManager.getPaths();
      await this.openFile(`file://${paths.userSettings}`);
      return true;
    });

    this.commandHandlers.set('workbench.openKeybindings', async () => {
      const paths = this.configManager.getPaths();
      await this.openFile(`file://${paths.userKeybindings}`);
      return true;
    });

    // Terminal commands
    this.commandHandlers.set('terminal.new', async () => {
      await this.createNewTerminal();
      return true;
    });

    this.commandHandlers.set('terminal.close', () => {
      this.closeActiveTerminal();
      return true;
    });

    this.commandHandlers.set('terminal.focus', () => {
      this.focusTerminalPanel();
      return true;
    });

    this.commandHandlers.set('terminal.nextTab', () => {
      if (this.terminalPanel) {
        this.terminalPanel.nextTerminal();
      }
      return true;
    });

    this.commandHandlers.set('terminal.previousTab', () => {
      if (this.terminalPanel) {
        this.terminalPanel.previousTerminal();
      }
      return true;
    });

    // Git commands
    this.commandHandlers.set('git.commit', async () => {
      await this.showCommitDialog();
      return true;
    });

    this.commandHandlers.set('git.push', async () => {
      await this.gitPush();
      return true;
    });

    // Ultra namespace commands for keybindings
    this.commandHandlers.set('ultra.splitVertical', () => {
      this.splitEditorPane('vertical');
      return true;
    });

    this.commandHandlers.set('ultra.splitHorizontal', () => {
      this.splitEditorPane('horizontal');
      return true;
    });

    this.commandHandlers.set('ultra.focusNextPane', () => {
      this.window.focusNextPane();
      return true;
    });

    this.commandHandlers.set('ultra.focusPreviousPane', () => {
      this.window.focusPreviousPane();
      return true;
    });

    this.commandHandlers.set('ultra.closePane', () => {
      this.closeCurrentPane();
      return true;
    });

    this.commandHandlers.set('ultra.toggleTerminal', () => {
      this.toggleTerminalPanel();
      return true;
    });

    this.commandHandlers.set('ultra.newTerminal', async () => {
      await this.createNewTerminal();
      return true;
    });

    this.commandHandlers.set('git.focusPanel', () => {
      this.focusGitPanel();
      return true;
    });

    // Session commands
    this.commandHandlers.set('session.save', async () => {
      await this.saveSession();
      return true;
    });

    this.commandHandlers.set('session.saveAs', async () => {
      await this.showSaveSessionDialog();
      return true;
    });

    this.commandHandlers.set('session.open', async () => {
      await this.showSessionPicker();
      return true;
    });

    // App commands
    this.commandHandlers.set('workbench.quit', () => {
      this.stop();
      return true;
    });

    // Folding commands
    this.commandHandlers.set('editor.fold', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.foldAtCursor();
      }
      return true;
    });

    this.commandHandlers.set('editor.unfold', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.unfoldAtCursor();
      }
      return true;
    });

    this.commandHandlers.set('editor.foldAll', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.foldAll();
      }
      return true;
    });

    this.commandHandlers.set('editor.unfoldAll', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.unfoldAll();
      }
      return true;
    });

    // Selection commands
    this.commandHandlers.set('edit.selectAll', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.selectAll();
      }
      return true;
    });

    // Multi-cursor commands
    this.commandHandlers.set('edit.selectNextMatch', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.selectNextOccurrence();
      }
      return true;
    });

    this.commandHandlers.set('edit.selectAllOccurrences', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.selectAllOccurrences();
      }
      return true;
    });

    this.commandHandlers.set('editor.addCursorAbove', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.addCursorAbove();
      }
      return true;
    });

    this.commandHandlers.set('editor.addCursorBelow', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.addCursorBelow();
      }
      return true;
    });

    this.commandHandlers.set('editor.clearCursors', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.clearSecondaryCursors();
      }
      return true;
    });
  }

  /**
   * Setup keybindings from config.
   */
  private setupKeybindings(): void {
    const keybindings = this.configManager.getKeybindings();

    for (const binding of keybindings) {
      this.window.addKeybinding({
        key: binding.key,
        handler: () => {
          const command = this.commandHandlers.get(binding.command);
          if (command) {
            // Show command in status bar
            const displayCmd = binding.command.replace(/\./g, ': ').replace(/-/g, ' ');
            this.window.showStatusCommand(`${binding.key} → ${displayCmd}`);

            const result = command();
            // Handle async commands
            if (result instanceof Promise) {
              result.catch((error) => {
                this.log(`Command ${binding.command} failed: ${error}`);
              });
              return true;
            }
            return result;
          }
          this.log(`Unknown command: ${binding.command}`);
          return false;
        },
        when: binding.when ? () => this.evaluateWhenClause(binding.when!) : undefined,
      });
    }

    this.log(`Loaded ${keybindings.length} keybindings`);
  }

  /**
   * Evaluate a when clause for conditional keybindings.
   */
  private evaluateWhenClause(when: string): boolean {
    // TODO: Implement proper when clause evaluation
    // For now, always return true
    return true;
  }

  /**
   * Toggle sidebar visibility.
   */
  private toggleSidebar(): void {
    if (!this.sidebarPaneId) return;

    const container = this.window.getPaneContainer();
    const pane = container.getPane(this.sidebarPaneId);
    if (pane) {
      // Toggle visibility via pane API if available
      // For now, just show a notification
      this.window.showNotification('Sidebar toggle not yet implemented', 'info');
    }
  }

  /**
   * Focus the git panel.
   */
  private focusGitPanel(): void {
    if (!this.sidebarPaneId) return;

    const container = this.window.getPaneContainer();
    const pane = container.getPane(this.sidebarPaneId);
    if (pane) {
      for (const element of pane.getElements()) {
        if (element instanceof GitPanel) {
          this.window.focusElement(element);
          return;
        }
      }
    }
    this.window.showNotification('Git panel not found', 'warning');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Terminal Panel
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Toggle terminal panel visibility.
   */
  private toggleTerminalPanel(): void {
    debugLog(`[TUIClient] Toggle terminal panel, current visible: ${this.terminalPanelVisible}`);
    if (this.terminalPanelVisible) {
      this.hideTerminalPanel();
    } else {
      this.showTerminalPanel();
    }
  }

  /**
   * Show the terminal panel.
   */
  private async showTerminalPanel(): Promise<void> {
    if (this.terminalPanelVisible) return;

    debugLog('[TUIClient] Showing terminal panel');

    // Create terminal panel if it doesn't exist
    if (!this.terminalPanel) {
      // Create element context for terminal panel
      const ctx = createTestContext({
        markDirty: () => this.scheduleRender(),
        requestFocus: () => {
          if (this.terminalPanel) {
            const session = this.terminalPanel.getActiveSession();
            if (session) {
              this.window.focusElement(session);
            }
          }
        },
        getThemeColor: (key: string, fallback = '#ffffff') =>
          this.theme[key] ?? fallback,
        isPaneFocused: () => this.terminalPanelVisible,
      });

      this.terminalPanel = createTerminalPanel(ctx);

      // Create first terminal if panel is empty
      await this.terminalPanel.createTerminal(this.workingDirectory);
    }

    this.terminalPanelVisible = true;
    this.layoutTerminalPanel();
    this.setTerminalFocus(true);
    this.scheduleRender();
  }

  /**
   * Hide the terminal panel.
   */
  private hideTerminalPanel(): void {
    if (!this.terminalPanelVisible) return;

    debugLog('[TUIClient] Hiding terminal panel');

    this.terminalPanelVisible = false;
    this.setTerminalFocus(false);

    // Re-layout without terminal panel
    this.layoutTerminalPanel();
    this.scheduleRender();
  }

  /**
   * Layout terminal panel at the bottom of the screen.
   */
  private layoutTerminalPanel(): void {
    if (!this.terminalPanel) return;

    const size = this.getTerminalSize();
    const panelHeight = this.terminalPanelVisible ? this.terminalPanelHeight : 0;

    debugLog(`[TUIClient] Layout terminal panel: visible=${this.terminalPanelVisible}, size=${size.width}x${size.height}, panelHeight=${panelHeight}`);

    if (this.terminalPanelVisible) {
      // Position terminal panel at bottom
      const bounds = {
        x: 0,
        y: size.height - panelHeight - 1, // -1 for status bar
        width: size.width,
        height: panelHeight,
      };
      debugLog(`[TUIClient] Setting terminal panel bounds: ${JSON.stringify(bounds)}`);
      this.terminalPanel.setBounds(bounds);
    }
  }

  /**
   * Create a new terminal in the panel.
   */
  private async createNewTerminal(): Promise<void> {
    // Show panel if not visible
    if (!this.terminalPanelVisible) {
      await this.showTerminalPanel();
    }

    // Create new terminal
    if (this.terminalPanel) {
      await this.terminalPanel.createTerminal(this.workingDirectory);
      this.focusTerminalPanel();
    }
  }

  /**
   * Close the active terminal.
   */
  private closeActiveTerminal(): void {
    if (this.terminalPanel) {
      this.terminalPanel.closeActiveTerminal();

      // Hide panel if no more terminals
      if (!this.terminalPanel.hasTerminals()) {
        this.hideTerminalPanel();
      }
    }
  }

  /**
   * Focus the terminal panel.
   */
  private focusTerminalPanel(): void {
    if (this.terminalPanel && this.terminalPanelVisible) {
      this.setTerminalFocus(true);
      this.scheduleRender();
    }
  }

  /**
   * Set terminal focus state.
   */
  private setTerminalFocus(focused: boolean): void {
    if (this.terminalFocused === focused) return;

    this.terminalFocused = focused;
    debugLog(`[TUIClient] Terminal focus: ${focused}`);

    if (this.terminalPanel) {
      if (focused) {
        // Focus the terminal panel
        this.terminalPanel.onFocus();
      } else {
        // Blur the terminal panel
        this.terminalPanel.onBlur();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Resize Handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Setup terminal resize handler.
   */
  private setupResizeHandler(): void {
    process.stdout.on('resize', () => {
      const size = this.getTerminalSize();
      this.handleResize(size);
    });
  }

  /**
   * Handle terminal resize.
   */
  private handleResize(size: Size): void {
    this.renderer.resize(size);
    this.window.resize(size);
    this.render();
  }

  /**
   * Get terminal size.
   */
  private getTerminalSize(): Size {
    return {
      width: process.stdout.columns ?? 80,
      height: process.stdout.rows ?? 24,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Schedule a render on next tick.
   */
  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;

    setImmediate(() => {
      this.renderScheduled = false;
      if (this.running) {
        this.render();
      }
    });
  }

  /**
   * Render the UI.
   */
  private render(): void {
    // Render window to its buffer
    const windowBuffer = this.window.render();

    // Render terminal panel on top if visible
    if (this.terminalPanelVisible && this.terminalPanel) {
      this.terminalPanel.render(windowBuffer);
    }

    // Copy to renderer buffer
    const rendererBuffer = this.renderer.getBuffer();
    const size = windowBuffer.getSize();

    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const cell = windowBuffer.get(x, y);
        if (cell) {
          rendererBuffer.set(x, y, cell);
        }
      }
    }

    // Flush to terminal
    this.renderer.flush();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Theme
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a theme color.
   */
  private getThemeColor(key: string, fallback = '#ffffff'): string {
    return this.theme[key] ?? fallback;
  }

  /**
   * Get theme colors from the theme definitions.
   */
  private getDefaultTheme(): Record<string, string> {
    return this.loadThemeColors('catppuccin-frappe');
  }

  /**
   * Load theme colors by name from defaults.
   */
  private loadThemeColors(themeName: string): Record<string, string> {
    const theme = defaultThemes[themeName];
    if (!theme) {
      this.log(`Theme '${themeName}' not found, using fallback`);
      return this.getFallbackTheme();
    }

    // Return the theme colors directly
    return { ...theme.colors };
  }

  /**
   * Minimal fallback theme if the requested theme isn't found.
   */
  private getFallbackTheme(): Record<string, string> {
    return {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'panel.background': '#1e1e1e',
      'panel.foreground': '#cccccc',
      'statusBar.background': '#007acc',
      'statusBar.foreground': '#ffffff',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Detect language from file extension.
   */
  private detectLanguage(uri: string): string {
    const ext = uri.split('.').pop()?.toLowerCase() ?? '';
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      jsx: 'javascriptreact',
      json: 'json',
      md: 'markdown',
      html: 'html',
      css: 'css',
      py: 'python',
      rs: 'rust',
      go: 'go',
      rb: 'ruby',
      sh: 'shellscript',
      bash: 'shellscript',
      yml: 'yaml',
      yaml: 'yaml',
    };
    return languageMap[ext] ?? 'plaintext';
  }

  /**
   * Log debug message.
   */
  private log(message: string): void {
    if (this.debug && isDebugEnabled()) {
      debugLog(`[TUIClient] ${message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Status Bar Updates
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update status bar with git branch info.
   */
  private updateStatusBarBranch(branch: string): void {
    // Use nerd font git branch icon
    const icon = '\ue0a0'; // Powerline branch icon
    this.window.setStatusItem('branch', `${icon} ${branch}`);
  }

  /**
   * Update status bar with git sync status (ahead/behind).
   */
  private updateStatusBarSync(ahead: number, behind: number): void {
    const parts: string[] = [];

    if (ahead > 0) {
      parts.push(`↑${ahead}`);
    }
    if (behind > 0) {
      parts.push(`↓${behind}`);
    }

    if (parts.length > 0) {
      this.window.setStatusItem('sync', parts.join(' '));
    } else {
      // Clear sync status when up to date
      this.window.setStatusItem('sync', '');
    }
  }

  /**
   * Update status bar with current file info.
   */
  private updateStatusBarFile(editor: DocumentEditor): void {
    const uri = editor.getUri();
    if (!uri) return;

    const filename = uri.split('/').pop() ?? 'untitled';
    const isDirty = editor.isModified();
    const dirtyIndicator = isDirty ? '● ' : '';

    // File name with dirty indicator
    this.window.setStatusItem('file', `${dirtyIndicator}${filename}`);

    // Language
    const langId = this.detectLanguage(uri);
    this.window.setStatusItem('language', this.formatLanguageName(langId));

    // Position (1-indexed for display)
    const cursor = editor.getCursor();
    this.window.setStatusItem('position', `Ln ${cursor.line + 1}, Col ${cursor.column + 1}`);

    // Encoding and line ending (defaults for now)
    this.window.setStatusItem('encoding', 'UTF-8');
    this.window.setStatusItem('eol', 'LF');

    // Indentation
    this.window.setStatusItem('indent', 'Spaces: 2');
  }

  /**
   * Format language ID to display name.
   */
  private formatLanguageName(langId: string): string {
    const displayNames: Record<string, string> = {
      typescript: 'TypeScript',
      typescriptreact: 'TypeScript React',
      javascript: 'JavaScript',
      javascriptreact: 'JavaScript React',
      json: 'JSON',
      markdown: 'Markdown',
      html: 'HTML',
      css: 'CSS',
      python: 'Python',
      rust: 'Rust',
      go: 'Go',
      ruby: 'Ruby',
      shellscript: 'Shell',
      yaml: 'YAML',
      plaintext: 'Plain Text',
    };
    return displayNames[langId] ?? langId;
  }

  /**
   * Clear file-related status bar items.
   */
  private clearStatusBarFile(): void {
    this.window.setStatusItem('file', '');
    this.window.setStatusItem('position', '');
    this.window.setStatusItem('language', '');
    this.window.setStatusItem('selection', '');
    this.window.setStatusItem('lsp', '');
    this.window.setStatusItem('indent', '');
    this.window.setStatusItem('encoding', '');
    this.window.setStatusItem('eol', '');
  }

  /**
   * Handle focus change to update status bar.
   */
  private handleFocusChange(element: BaseElement | null): void {
    if (element instanceof DocumentEditor) {
      this.updateStatusBarFile(element);
    } else {
      // Not a document editor - clear file-related items
      this.clearStatusBarFile();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Syntax Highlighting
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Apply syntax tokens from a session to the editor.
   */
  private applySyntaxTokens(editor: DocumentEditor, sessionId: string): void {
    const allTokens = this.syntaxService.getSessionAllTokens(sessionId);

    for (let lineNum = 0; lineNum < allTokens.length; lineNum++) {
      const lineTokens = allTokens[lineNum];
      if (lineTokens && lineTokens.length > 0) {
        // Map HighlightToken to SyntaxToken
        const syntaxTokens = lineTokens.map((token) => ({
          start: token.start,
          end: token.end,
          type: token.scope,
          color: token.color,
        }));
        editor.setLineTokens(lineNum, syntaxTokens);
      }
    }
  }

  /**
   * Update syntax highlighting for a document.
   */
  private async updateSyntaxHighlighting(uri: string, editor: DocumentEditor): Promise<void> {
    const doc = this.openDocuments.get(uri);
    if (!doc?.syntaxSessionId) return;

    try {
      const content = editor.getContent();
      await this.syntaxService.updateSession(doc.syntaxSessionId, content);
      this.applySyntaxTokens(editor, doc.syntaxSessionId);
    } catch (error) {
      this.log(`Failed to update syntax highlighting: ${error}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dialogs
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the command palette.
   */
  private async showCommandPalette(): Promise<void> {
    if (!this.dialogManager) return;

    // Force immediate render so dialog appears
    this.render();

    // Build command list from handlers
    const commands: Command[] = [];
    const keybindings = this.configManager.getKeybindings();

    for (const [commandId, _handler] of this.commandHandlers) {
      const keybinding = keybindings.find((kb) => kb.command === commandId);
      const parts = commandId.split('.');
      const category = parts[0] ?? '';
      const nameParts = parts.slice(1);
      const label = nameParts.join('.').replace(/([A-Z])/g, ' $1').trim();

      commands.push({
        id: commandId,
        label: label.charAt(0).toUpperCase() + label.slice(1),
        category: category.charAt(0).toUpperCase() + category.slice(1),
        keybinding: keybinding?.key,
      });
    }

    const result = await this.dialogManager.showCommandPalette({
      commands,
      placeholder: 'Type a command...',
    });

    if (result.confirmed && result.value) {
      const handler = this.commandHandlers.get(result.value.id);
      if (handler) {
        handler();
      }
    }
  }

  /**
   * Show the file picker (quick open).
   */
  private async showFilePicker(): Promise<void> {
    if (!this.dialogManager) return;

    // Build file list from file service using glob
    try {
      const baseUri = `file://${this.workingDirectory}`;
      const fileUris = await this.fileService.glob('**/*', {
        baseUri,
        excludePatterns: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      });

      // glob returns full URIs, convert to relative paths for display
      const fileEntries: FileEntry[] = fileUris.map((fileUri) => {
        // Strip the base URI to get relative path
        const relativePath = fileUri.replace(baseUri + '/', '');
        const name = relativePath.split('/').pop() ?? relativePath;
        const directory = relativePath.includes('/')
          ? relativePath.slice(0, relativePath.lastIndexOf('/'))
          : '';
        return {
          path: relativePath,
          name,
          directory,
          extension: name.includes('.') ? name.slice(name.lastIndexOf('.')) : undefined,
        };
      });

      // Get current file path for highlighting
      const focusedElement = this.window.getFocusedElement();
      let currentPath: string | undefined;
      if (focusedElement instanceof DocumentEditor) {
        const uri = focusedElement.getUri();
        if (uri) {
          currentPath = uri.replace(this.workingDirectory + '/', '');
        }
      }

      const result = await this.dialogManager.showFilePicker({
        files: fileEntries,
        currentPath,
        placeholder: 'Search files...',
      });

      if (result.confirmed && result.value) {
        const fileUri = `file://${this.workingDirectory}/${result.value.path}`;
        await this.openFile(fileUri);
      }
    } catch (error) {
      this.log(`Failed to list files: ${error}`);
      this.window.showNotification('Failed to list files', 'error');
    }
  }

  /**
   * Show goto line dialog.
   */
  private async showGotoLine(): Promise<void> {
    if (!this.dialogManager) return;

    const focusedElement = this.window.getFocusedElement();
    if (!(focusedElement instanceof DocumentEditor)) {
      this.window.showNotification('No active editor', 'warning');
      return;
    }

    // Get current line
    const currentLine = focusedElement.getCursor().line + 1;

    const result = await this.dialogManager.showGotoLine(currentLine);

    if (result.confirmed && result.value) {
      // Use setCursorPosition to go to the specified line
      focusedElement.setCursorPosition(
        { line: result.value.line - 1, column: result.value.column ? result.value.column - 1 : 0 },
        false
      );
      this.scheduleRender();
    }
  }

  /**
   * Show git commit dialog.
   */
  private async showCommitDialog(): Promise<void> {
    if (!this.dialogManager) return;

    // Get staged files from git status
    let stagedFiles: StagedFile[] = [];
    try {
      const gitStatus = await gitCliService.status(this.workingDirectory);
      stagedFiles = gitStatus.staged.map((file) => ({
        path: file.path,
        status: file.status === 'A' ? 'added' as const :
                file.status === 'D' ? 'deleted' as const :
                file.status === 'R' ? 'renamed' as const : 'modified' as const,
      }));
    } catch (error) {
      this.log(`Failed to get git status: ${error}`);
    }

    if (stagedFiles.length === 0) {
      this.window.showNotification('No staged changes to commit', 'warning');
      return;
    }

    // Force render before showing dialog
    this.render();

    const result = await this.dialogManager.showCommit({
      stagedFiles,
      showConventionalHints: true,
    });

    if (result.confirmed && result.value) {
      try {
        // Perform the commit (or amend)
        if (result.value.amend) {
          await gitCliService.amend(this.workingDirectory, result.value.message);
        } else {
          await gitCliService.commit(this.workingDirectory, result.value.message);
        }
        this.window.showNotification('Changes committed successfully', 'success');
        await this.refreshGitStatus();
      } catch (error) {
        this.window.showNotification(`Commit failed: ${error}`, 'error');
      }
    }
  }

  /**
   * Push commits to remote.
   */
  private async gitPush(): Promise<void> {
    this.window.showNotification('Pushing...', 'info');

    try {
      const result = await gitCliService.push(this.workingDirectory);
      if (result.success) {
        this.window.showNotification('Pushed successfully', 'success');
      } else {
        this.window.showNotification(`Push failed: ${result.error}`, 'error');
      }
      await this.refreshGitStatus();
    } catch (error) {
      this.window.showNotification(`Push failed: ${error}`, 'error');
    }
  }

  /**
   * Show dialog to save session with a name.
   */
  private async showSaveSessionDialog(): Promise<void> {
    if (!this.dialogManager) return;

    const result = await this.dialogManager.showInput({
      title: 'Save Session As',
      prompt: 'Enter a name for this session:',
      placeholder: 'my-session',
    });

    if (result.confirmed && result.value) {
      await this.saveSession(result.value);
    }
  }

  /**
   * Show session picker dialog.
   */
  private async showSessionPicker(): Promise<void> {
    if (!this.dialogManager) return;

    try {
      const sessions = await localSessionService.listSessions();

      if (sessions.length === 0) {
        this.window.showNotification('No saved sessions found', 'info');
        return;
      }

      // Build file entries for the file picker (reusing the dialog type)
      const sessionEntries = sessions.map((s) => ({
        path: s.id,
        name: s.name,
        directory: s.type === 'named' ? 'Named' : 'Workspace',
        extension: undefined,
      }));

      const result = await this.dialogManager.showFilePicker({
        files: sessionEntries,
        placeholder: 'Search sessions...',
        title: 'Open Session',
      });

      if (result.confirmed && result.value) {
        try {
          const session = await localSessionService.loadSession(result.value.path);
          await this.restoreFromSession(session);
          this.window.showNotification('Session loaded', 'success');
        } catch (error) {
          this.window.showNotification(`Failed to load session: ${error}`, 'error');
        }
      }
    } catch (error) {
      this.window.showNotification(`Failed to list sessions: ${error}`, 'error');
    }
  }

  /**
   * Close the currently focused pane.
   */
  private closeCurrentPane(): void {
    const pane = this.window.getFocusedPane();
    if (pane) {
      // Don't close the last editor pane
      const allPanes = this.window.getPaneContainer().getPanes();
      const editorPanes = allPanes.filter((p) => p.getMode() === 'tabs');
      if (editorPanes.length <= 1 && pane.getMode() === 'tabs') {
        this.window.showNotification('Cannot close the last editor pane', 'warning');
        return;
      }
      this.window.closePane(pane.id);
      // Mark session dirty
      this.markSessionDirty();
    }
  }

  /**
   * Split the editor pane (not the sidebar).
   * Uses the focused pane if it's an editor pane, otherwise uses the default editor pane.
   */
  private splitEditorPane(direction: 'horizontal' | 'vertical'): void {
    // Get the target pane - focused if it's a tabs pane, otherwise default editor pane
    const focusedPane = this.window.getFocusedPane();
    const targetPane = focusedPane?.getMode() === 'tabs' ? focusedPane : this.getEditorPane();

    if (!targetPane) {
      this.window.showNotification('No editor pane to split', 'warning');
      return;
    }

    // Split the specific pane
    const container = this.window.getPaneContainer();
    const newPaneId = container.split(direction, targetPane.id);
    const newPane = container.getPane(newPaneId);

    // Focus the new pane
    if (newPane) {
      this.window.focusPane(newPane);
      // Mark session dirty
      this.markSessionDirty();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Session Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the session service with paths and workspace.
   */
  private async initSessionService(): Promise<void> {
    // Configure session paths from TUI config
    const paths = this.configManager.getPaths();
    localSessionService.setSessionPaths({
      sessionsDir: paths.sessionsDir,
      workspaceSessionsDir: paths.workspaceSessionsDir,
      namedSessionsDir: paths.namedSessionsDir,
      lastSessionFile: paths.lastSessionFile,
    });

    // Initialize with workspace
    await localSessionService.init(this.workingDirectory);

    // Start auto-save
    localSessionService.startAutoSave(30000); // 30 seconds

    this.log('Session service initialized');
  }

  /**
   * Try to restore the last session for this workspace.
   * Returns true if a session was restored.
   */
  private async tryRestoreSession(): Promise<boolean> {
    try {
      const session = await localSessionService.tryLoadLastSession();
      if (session) {
        await this.restoreFromSession(session);
        this.log('Session restored');
        return true;
      }
    } catch (error) {
      this.log(`Failed to restore session: ${error}`);
    }
    return false;
  }

  /**
   * Serialize the current TUI state to a SessionState.
   */
  private serializeSession(): SessionState {
    // Use debugLog directly to ensure we see this even if this.debug is false
    debugLog(`[TUIClient] Serializing session with ${this.openDocuments.size} open documents`);

    const container = this.window.getPaneContainer();
    const layoutConfig = container.serialize();

    // Debug: log the raw layout
    debugLog(`[TUIClient] Raw layout: ${JSON.stringify(layoutConfig)}`);

    // Convert layout config to SessionLayoutNode format
    const layout = this.convertLayoutToSessionFormat(layoutConfig);
    debugLog(`[TUIClient] Converted layout: ${JSON.stringify(layout)}`);

    // Serialize documents
    const documents: SessionDocumentState[] = [];
    let tabOrder = 0;

    for (const [uri, docInfo] of this.openDocuments) {
      debugLog(`[TUIClient] Serializing document: ${uri} (editorId: ${docInfo.editorId})`);
      const editor = this.findEditorById(docInfo.editorId);
      if (!editor) {
        debugLog(`[TUIClient]   Editor not found for ${uri}`);
        continue;
      }

      const state = editor.getState();
      const pane = this.findPaneForElement(docInfo.editorId);
      const cursor = editor.getCursor();

      // Get unsaved content if modified
      let unsavedContent: string | undefined;
      if (editor.isModified()) {
        unsavedContent = editor.getContent();
      }

      documents.push({
        filePath: uri.replace(/^file:\/\//, ''),
        scrollTop: state.scrollTop,
        scrollLeft: 0,
        cursorLine: cursor.line,
        cursorColumn: cursor.column,
        foldedRegions: state.foldedRegions ?? [],
        paneId: pane?.id ?? 'main',
        tabOrder: tabOrder++,
        isActiveInPane: pane?.getActiveElement() === editor,
        unsavedContent,
      });
      debugLog(`[TUIClient]   Document serialized: ${uri.replace(/^file:\/\//, '')}`);
    }

    debugLog(`[TUIClient] Serialized ${documents.length} documents`);

    // Determine active document
    const focusedElement = this.window.getFocusedElement();
    let activeDocumentPath: string | null = null;
    if (focusedElement instanceof DocumentEditor) {
      const uri = focusedElement.getUri();
      if (uri) {
        activeDocumentPath = uri.replace(/^file:\/\//, '');
      }
    }

    // Get active pane
    const focusedPane = this.window.getFocusedPane();
    const activePaneId = focusedPane?.id ?? 'main';

    // Serialize UI state
    const ui: SessionUIState = {
      sidebarVisible: this.sidebarPaneId !== null,
      sidebarWidth: this.configManager.getWithDefault('tui.sidebar.width', 30),
      terminalVisible: this.terminalPanelVisible,
      terminalHeight: this.terminalPanelHeight,
      gitPanelVisible: false,
      gitPanelWidth: 40,
      activeSidebarPanel: 'files',
      minimapEnabled: this.configManager.getWithDefault('editor.minimap.enabled', false),
    };

    return {
      version: 1,
      timestamp: new Date().toISOString(),
      instanceId: `${Date.now()}-${process.pid}`,
      workspaceRoot: this.workingDirectory,
      documents,
      activeDocumentPath,
      activePaneId,
      layout,
      ui,
    };
  }

  /**
   * Convert pane container layout to session format.
   */
  private convertLayoutToSessionFormat(
    config: { mode?: string; id: string; direction?: string; children?: unknown[]; ratios?: number[] }
  ): SessionLayoutNode {
    if ('mode' in config && config.mode !== undefined) {
      // PaneConfig (leaf node)
      return {
        type: 'leaf',
        paneId: config.id,
      };
    }

    // SplitConfig
    const children = (config.children ?? []) as { mode?: string; id: string; direction?: string; children?: unknown[]; ratios?: number[] }[];
    return {
      type: config.direction === 'horizontal' ? 'horizontal' : 'vertical',
      children: children.map((c) => this.convertLayoutToSessionFormat(c)),
      ratios: config.ratios,
    };
  }

  /**
   * Restore TUI state from a SessionState.
   */
  private async restoreFromSession(session: SessionState): Promise<void> {
    this.log(`Restoring session with ${session.documents.length} documents`);

    const container = this.window.getPaneContainer();

    // Collect all pane IDs needed from documents
    const neededPaneIds = new Set<string>();
    for (const doc of session.documents) {
      neededPaneIds.add(doc.paneId);
    }

    // Check which panes already exist
    const existingPanes = new Map<string, Pane>();
    for (const pane of container.getPanes()) {
      existingPanes.set(pane.id, pane);
    }

    // Create missing panes by splitting the editor pane
    // We need to create panes in order (pane-3, pane-4, etc.)
    const missingPaneIds = [...neededPaneIds].filter(id => !existingPanes.has(id)).sort();

    if (missingPaneIds.length > 0) {
      debugLog(`[TUIClient] Creating missing panes: ${missingPaneIds.join(', ')}`);

      // Find the main editor pane to split from
      let editorPane = this.getEditorPane();

      for (const paneId of missingPaneIds) {
        if (editorPane) {
          // Split the editor pane to create a new pane
          // Use vertical split (side by side) by default
          const newPaneId = container.split('vertical', editorPane.id);
          const newPane = container.getPane(newPaneId);

          if (newPane) {
            debugLog(`[TUIClient] Created pane ${newPaneId} (needed: ${paneId})`);
            // Map the needed paneId to the actual new pane
            existingPanes.set(paneId, newPane);
          }
        }
      }
    }

    // Restore pane ratios from session layout
    if (session.layout && session.layout.type !== 'leaf' && session.layout.ratios) {
      container.adjustRatios('split-1', session.layout.ratios);
      this.log(`Restored pane ratios: ${session.layout.ratios.join(', ')}`);

      // Also restore nested split ratios if present
      if (session.layout.children) {
        this.restoreNestedRatios(container, session.layout.children, 2);
      }
    }

    // Restore documents into their correct panes
    for (const doc of session.documents) {
      try {
        const uri = `file://${doc.filePath}`;

        // Check if file exists or if we have unsaved content
        let content: string | undefined;
        try {
          const file = await this.fileService.read(uri);
          content = file.content;
        } catch {
          if (doc.unsavedContent) {
            content = doc.unsavedContent;
          } else {
            this.log(`Skipping missing file: ${doc.filePath}`);
            continue;
          }
        }

        // Find the target pane for this document
        const targetPane = existingPanes.get(doc.paneId);

        // Open the document in the correct pane
        const editor = await this.openFile(uri, { focus: false, pane: targetPane ?? undefined });
        if (!editor) continue;

        // Restore content if we had unsaved changes
        if (doc.unsavedContent && content !== doc.unsavedContent) {
          editor.setContent(doc.unsavedContent);
        }

        // Restore cursor position
        editor.setCursorPosition({ line: doc.cursorLine, column: doc.cursorColumn }, false);

        // Restore scroll position
        editor.scrollToLine(doc.scrollTop);

        // Restore folded regions
        if (doc.foldedRegions && doc.foldedRegions.length > 0) {
          for (const line of doc.foldedRegions) {
            editor.foldLine(line);
          }
        }
      } catch (error) {
        this.log(`Failed to restore document ${doc.filePath}: ${error}`);
      }
    }

    // Focus the active document if specified
    if (session.activeDocumentPath) {
      const uri = `file://${session.activeDocumentPath}`;
      const docInfo = this.openDocuments.get(uri);
      if (docInfo) {
        const editor = this.findEditorById(docInfo.editorId);
        if (editor) {
          this.window.focusElement(editor);
        }
      }
    }

    // Restore UI state
    if (session.ui) {
      // Restore terminal panel height (session overrides config)
      if (session.ui.terminalHeight) {
        this.terminalPanelHeight = session.ui.terminalHeight;
      }

      // Restore terminal visibility
      if (session.ui.terminalVisible) {
        await this.showTerminalPanel();
      }
    }

    // Mark session as loaded in service
    localSessionService.setCurrentSession(session);
  }

  /**
   * Restore nested split ratios recursively.
   */
  private restoreNestedRatios(
    container: ReturnType<Window['getPaneContainer']>,
    children: SessionLayoutNode[],
    splitIndex: number
  ): void {
    for (const child of children) {
      if (child.type !== 'leaf' && child.ratios && child.children) {
        const splitId = `split-${splitIndex}`;
        try {
          container.adjustRatios(splitId, child.ratios);
          debugLog(`[TUIClient] Restored ratios for ${splitId}: ${child.ratios.join(', ')}`);
        } catch {
          // Split may not exist yet
        }
        // Recurse into nested children
        this.restoreNestedRatios(container, child.children, splitIndex + 1);
      }
    }
  }

  /**
   * Find the pane containing an element.
   */
  private findPaneForElement(elementId: string): Pane | null {
    const container = this.window.getPaneContainer();
    for (const pane of container.getPanes()) {
      if (pane.getElement(elementId)) {
        return pane;
      }
    }
    return null;
  }

  /**
   * Mark the session as dirty (needs saving).
   */
  private markSessionDirty(): void {
    localSessionService.markSessionDirty();
  }

  /**
   * Save the current session.
   */
  async saveSession(name?: string): Promise<void> {
    const state = this.serializeSession();
    localSessionService.setCurrentSession(state);
    await localSessionService.saveSession(name);
    this.window.showNotification('Session saved', 'success');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the window instance.
   */
  getWindow(): Window {
    return this.window;
  }

  /**
   * Get the working directory.
   */
  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  /**
   * Show a notification.
   */
  notify(message: string, type: 'info' | 'warning' | 'error' | 'success' = 'info'): void {
    this.window.showNotification(message, type);
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new TUI client.
 */
export function createTUIClient(options?: TUIClientOptions): TUIClient {
  return new TUIClient(options);
}
