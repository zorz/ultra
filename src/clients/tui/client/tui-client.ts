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
  OutlinePanel,
  GitTimelinePanel,
  GitDiffBrowser,
  TerminalSession,
  TerminalPanel,
  AITerminalChat,
  createTerminalPanel,
  createAITerminalChat,
  createTestContext,
  registerBuiltinElements,
  getSymbolParser,
  type FileNode,
  type DocumentEditorCallbacks,
  type FileTreeCallbacks,
  type GitPanelCallbacks,
  type OutlinePanelCallbacks,
  type OutlineSymbol,
  type GitTimelinePanelCallbacks,
  type TimelineMode,
  type TerminalSessionCallbacks,
  type AITerminalChatState,
  type AIProvider,
  type TerminalTabDropdownInfo,
  type GitDiffBrowserCallbacks,
  type DiagnosticsProvider,
  type EditCallbacks,
} from '../elements/index.ts';
import { createGitDiffArtifact } from '../artifacts/git-diff-artifact.ts';
import type { Pane } from '../layout/pane.ts';

// Dialog system
import {
  DialogManager,
  createDialogManager,
  FileBrowserDialog,
  SaveAsDialog,
  SearchReplaceDialog,
  createSearchReplaceDialog,
  buildSettingItem,
  type Command,
  type FileEntry,
  type StagedFile,
  type SearchOptions,
  type SettingItem,
  type KeybindingItem,
} from '../overlays/index.ts';
import { TabSwitcherDialog, type TabInfo } from '../overlays/tab-switcher.ts';

// Debug utilities
import { debugLog, isDebugEnabled } from '../../../debug.ts';

// Config
import { TUIConfigManager, createTUIConfigManager, type TUISettings } from '../config/index.ts';
import { defaultThemes, defaultSettings, defaultKeybindings } from '../../../config/defaults.ts';

// Services
import { localDocumentService, type DocumentService } from '../../../services/document/index.ts';
import { fileService, type FileService, type WatchHandle } from '../../../services/file/index.ts';
import { gitCliService } from '../../../services/git/index.ts';
import type { GitDiffHunk } from '../../../services/git/types.ts';
import { localSyntaxService, type SyntaxService, type HighlightToken } from '../../../services/syntax/index.ts';
import {
  localSessionService,
  type SessionState,
  type SessionDocumentState,
  type SessionTerminalState,
  type SessionAIChatState,
  type SessionSQLEditorState,
  type SessionLayoutNode,
  type SessionUIState,
} from '../../../services/session/index.ts';

// Terminal
import { createPtyBackend } from '../../../terminal/pty-factory.ts';
import type { PTYBackend } from '../../../terminal/pty-backend.ts';

// LSP
import { createLSPIntegration, type LSPIntegration } from './lsp-integration.ts';
import { localLSPService, type LSPDocumentSymbol } from '../../../services/lsp/index.ts';

// Database
import {
  localDatabaseService,
  getSQLCompletionProvider,
  parseTableInfoFromSql,
  type SQLCompletionItem,
  SQLCompletionKind,
} from '../../../services/database/index.ts';
import { localSecretService } from '../../../services/secret/index.ts';
import type { ConnectionInfo, QueryResult } from '../../../services/database/types.ts';
import {
  ConnectionPickerDialog,
  createConnectionPicker,
  ConnectionEditDialog,
  createConnectionEditDialog,
  type ConnectionEditResult,
  SchemaBrowser,
  createSchemaBrowser,
} from '../overlays/index.ts';
import {
  SQLEditor,
  QueryResults,
  RowDetailsPanel,
  type RowDetailsPanelCallbacks,
  type PrimaryKeyDef,
} from '../elements/index.ts';

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
  /** Line number to navigate to (1-indexed) */
  line?: number;
  /** Column number to navigate to (0-indexed) */
  column?: number;
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

  /** Initial file to open on startup */
  private initialFile: string | undefined;

  /** Theme colors */
  private theme: Record<string, string>;

  /** Document service */
  private documentService: DocumentService;

  /** File service */
  private fileService: FileService;

  /** Syntax service */
  private syntaxService: SyntaxService;

  /** Open documents by URI -> editor mapping */
  private openDocuments = new Map<string, {
    documentId: string;
    editorId: string;
    syntaxSessionId?: string;
    /** Last known file modification time (ms since epoch) */
    lastModified?: number;
  }>();

  /** Internal clipboard for cut/copy/paste */
  private clipboard: string = '';

  /** Open terminals in panes by element ID -> PTY mapping */
  private paneTerminals = new Map<string, PTYBackend>();

  /** Open AI chats in panes by element ID -> AITerminalChat mapping */
  private paneAIChats = new Map<string, AITerminalChat>();

  /** Open SQL editors in panes by element ID -> SQLEditor mapping */
  private paneSQLEditors = new Map<string, SQLEditor>();

  /** SQL editor syntax session IDs by element ID */
  private sqlEditorSyntaxSessions = new Map<string, string>();

  /** Whether client is running */
  private running = false;

  /** Counter for untitled documents */
  private untitledCounter = 1;

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

  /** File browser dialog for Open File */
  private fileBrowserDialog: FileBrowserDialog | null = null;

  /** Save As dialog */
  private saveAsDialog: SaveAsDialog | null = null;

  /** Search/Replace dialog */
  private searchReplaceDialog: SearchReplaceDialog | null = null;

  /** Tab switcher dialog */
  private tabSwitcherDialog: TabSwitcherDialog | null = null;

  /** Connection picker dialog */
  private connectionPickerDialog: ConnectionPickerDialog | null = null;

  /** Connection edit dialog */
  private connectionEditDialog: ConnectionEditDialog | null = null;

  /** Schema browser dialog */
  private schemaBrowser: SchemaBrowser | null = null;

  /** Command handlers */
  private commandHandlers: Map<string, () => boolean | Promise<boolean>> = new Map();

  /** Editor pane ID */
  private editorPaneId: string | null = null;

  /** Sidebar pane ID */
  private sidebarPaneId: string | null = null;

  /** Sidebar visible */
  private sidebarVisible = true;

  /** Sidebar location (left or right) */
  private sidebarLocation: 'left' | 'right' = 'left';

  /** Saved sidebar width ratio for restore after hiding */
  private savedSidebarRatio: number = 0.2;

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

  /** LSP integration */
  private lspIntegration: LSPIntegration | null = null;

  /** File tree element reference */
  private fileTree: FileTree | null = null;

  /** Outline panel element reference */
  private outlinePanel: OutlinePanel | null = null;

  /** Git panel element reference */
  private gitPanel: GitPanel | null = null;

  /** Git timeline panel element reference */
  private gitTimelinePanel: GitTimelinePanel | null = null;

  /** Workspace directory watcher */
  private workspaceWatcher: WatchHandle | null = null;

  /** Debounce timer for workspace refresh */
  private workspaceRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** Unsubscribe function for git change events */
  private gitChangeUnsubscribe: (() => void) | null = null;

  constructor(options: TUIClientOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.initialFile = options.initialFile;
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
      getSetting: (key, defaultValue) => this.configManager.getWithDefault(key as any, defaultValue),
      onDirty: () => this.scheduleRender(),
      onElementCloseRequest: (elementId, element) => this.handleElementCloseRequest(elementId, element),
      onFocusChange: (_prevElemId, _nextElemId, _prevPaneId, nextPaneId) => {
        // Track last focused editor pane (for opening files from sidebar)
        const nextPane = nextPaneId ? this.window.getPaneContainer().getPane(nextPaneId) : null;
        if (nextPane && nextPane.getMode() === 'tabs') {
          this.lastFocusedEditorPaneId = nextPaneId;
        }

        // Look up the focused element and update status bar
        const focusedElement = this.window.getFocusedElement();
        // Only update sidebar panels when focus changes in a tabs pane (editor area)
        // Don't update when clicking on sidebar panels themselves
        const isTabsPane = nextPane !== null && nextPane.getMode() === 'tabs';
        this.handleFocusChange(focusedElement, isTabsPane);
      },
      onShowTabDropdown: (paneId, tabs, x, y) => {
        this.showTabSwitcher(paneId, tabs);
      },
    };
    this.window = createWindow(windowConfig);

    // Create dialog manager
    this.dialogManager = createDialogManager(this.window.getOverlayManager(), {
      onDirty: () => this.scheduleRender(),
      getThemeColor: (key, fallback) => this.getThemeColor(key, fallback),
      getScreenSize: () => this.getTerminalSize(),
    });

    // Create file browser dialog
    const overlayCallbacks = {
      onDirty: () => this.scheduleRender(),
      getThemeColor: (key: string, fallback?: string) => this.getThemeColor(key, fallback ?? '#cccccc'),
      getScreenSize: () => this.getTerminalSize(),
    };
    this.fileBrowserDialog = new FileBrowserDialog('file-browser', overlayCallbacks);
    this.fileBrowserDialog.setFileService(this.fileService);
    this.window.getOverlayManager().addOverlay(this.fileBrowserDialog);

    // Create save-as dialog
    this.saveAsDialog = new SaveAsDialog('save-as', overlayCallbacks);
    this.saveAsDialog.setFileService(this.fileService);
    this.window.getOverlayManager().addOverlay(this.saveAsDialog);

    // Create search/replace dialog
    this.searchReplaceDialog = createSearchReplaceDialog({
      ...overlayCallbacks,
      onSearch: (query: string, options: SearchOptions) => {
        this.handleSearch(query, options);
      },
      onFindNext: () => {
        this.handleFindNext();
      },
      onFindPrevious: () => {
        this.handleFindPrevious();
      },
      onReplace: (replacement: string) => {
        this.handleReplace(replacement);
      },
      onReplaceAll: (replacement: string) => {
        this.handleReplaceAll(replacement);
      },
      onDismiss: () => {
        this.handleSearchDismiss();
      },
    });
    this.window.getOverlayManager().addOverlay(this.searchReplaceDialog);

    // Create tab switcher dialog
    this.tabSwitcherDialog = new TabSwitcherDialog(overlayCallbacks);
    this.window.getOverlayManager().addOverlay(this.tabSwitcherDialog);

    // Create database connection dialogs
    this.connectionPickerDialog = createConnectionPicker(overlayCallbacks);
    this.window.getOverlayManager().addOverlay(this.connectionPickerDialog);
    this.connectionEditDialog = createConnectionEditDialog(overlayCallbacks);
    this.window.getOverlayManager().addOverlay(this.connectionEditDialog);
    this.schemaBrowser = createSchemaBrowser('schema-browser', overlayCallbacks);
    this.schemaBrowser.setDatabaseService(localDatabaseService);
    this.window.getOverlayManager().addOverlay(this.schemaBrowser);

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

    // Start watching config files for hot-reload
    this.configManager.startWatching();
    this.configManager.onReload((type) => this.handleConfigReload(type));
    this.log('Config hot-reload enabled');

    // Apply terminal panel height from config
    this.terminalPanelHeight = this.configManager.getWithDefault('tui.terminal.height', 10);
    this.log(`Terminal panel height: ${this.terminalPanelHeight}`);

    // Apply theme from config
    const themeName = this.configManager.get('workbench.colorTheme') ?? 'catppuccin-frappe';
    this.theme = this.loadThemeColors(themeName);
    this.log(`Theme: ${themeName}`);

    // Initialize session service (before layout setup)
    await this.initSessionService();

    // Initialize database service (enables connection dialogs and secret storage)
    await localDatabaseService.init(this.workingDirectory || undefined);
    this.log('Database service initialized');

    // Initialize syntax service
    await this.syntaxService.waitForReady();
    this.syntaxService.setTheme(themeName);
    this.log('Syntax service ready');

    // Initialize LSP integration
    this.initLSPIntegration();
    this.log('LSP integration initialized');

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

    // If an initial file was specified, open it instead of restoring session
    if (this.initialFile) {
      this.log(`Opening initial file: ${this.initialFile}`);
      await this.openFile(`file://${this.initialFile}`);
    } else {
      // Try to restore the last session
      const restored = await this.tryRestoreSession();
      if (restored) {
        this.log('Restored previous session');
      }
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
  /** Exit codes for restart commands */
  static readonly EXIT_CODE_RESTART = 75;
  static readonly EXIT_CODE_RESTART_REBUILD = 76;

  async stop(exitCode?: number): Promise<void> {
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

    // Cleanup config manager (stop file watching)
    this.configManager.destroy();

    // Stop workspace watcher
    this.stopWorkspaceWatcher();

    // Stop git change listener
    this.stopGitChangeListener();

    // Stop input handler
    this.inputHandler.stop();

    // Stop window
    this.window.stop();

    // Cleanup renderer
    this.renderer.cleanup();

    // Shutdown LSP integration
    if (this.lspIntegration) {
      await this.lspIntegration.shutdown();
      this.lspIntegration = null;
    }

    // Close all documents and dispose syntax sessions
    for (const [, { documentId, syntaxSessionId }] of this.openDocuments) {
      await this.documentService.close(documentId);
      if (syntaxSessionId) {
        this.syntaxService.disposeSession(syntaxSessionId);
      }
    }
    this.openDocuments.clear();

    this.log('TUI Client stopped');

    // Exit with code if specified (for restart commands)
    // Do this before the exit callback to ensure the correct exit code
    if (exitCode !== undefined) {
      process.exit(exitCode);
    }

    // Call exit callback for normal exits
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
      this.fileTree = fileTree;  // Save reference for refresh
      this.configureFileTree(fileTree);
    }

    // Add git panel
    const gitPanelId = sidePane.addElement('GitPanel', 'Source Control');
    const gitPanel = sidePane.getElement(gitPanelId) as GitPanel | null;
    if (gitPanel) {
      this.gitPanel = gitPanel;
      this.configureGitPanel(gitPanel);
    }

    // Add outline panel
    const outlinePanelId = sidePane.addElement('OutlinePanel', 'Outline');
    const outlinePanel = sidePane.getElement(outlinePanelId) as OutlinePanel | null;
    if (outlinePanel) {
      this.outlinePanel = outlinePanel;
      this.configureOutlinePanel(outlinePanel);

      // Collapse by default if configured
      const collapseOnStartup = this.configManager.getWithDefault('tui.outline.collapsedOnStartup', true);
      if (collapseOnStartup) {
        sidePane.collapseAccordionSection(outlinePanelId);
      }
    }

    // Add git timeline panel
    const timelinePanelId = sidePane.addElement('GitTimelinePanel', 'Timeline');
    const timelinePanel = sidePane.getElement(timelinePanelId) as GitTimelinePanel | null;
    if (timelinePanel) {
      this.gitTimelinePanel = timelinePanel;
      this.configureGitTimelinePanel(timelinePanel);

      // Collapse by default if configured
      const collapseOnStartup = this.configManager.getWithDefault('tui.timeline.collapsedOnStartup', true);
      if (collapseOnStartup) {
        sidePane.collapseAccordionSection(timelinePanelId);
      }
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

    // Apply sidebar location from config
    this.sidebarLocation = this.configManager.getWithDefault('tui.sidebar.location', 'left') as 'left' | 'right';
    if (this.sidebarLocation === 'right') {
      // Swap the children so sidebar is on the right
      container.swapSplitChildren('split-1');
    }

    // Load file tree
    if (fileTree) {
      await this.loadFileTree(fileTree);
      // Start watching workspace for file changes
      this.startWorkspaceWatcher();
    }

    // Load git status
    if (gitPanel) {
      await this.loadGitStatus(gitPanel);
    }

    // Start listening for git changes to auto-refresh diff browsers
    this.startGitChangeListener();

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
    // Set workspace root for file operations
    fileTree.setWorkspaceRoot(this.workingDirectory);

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
      onRefreshRoots: async () => {
        try {
          const entries = await this.fileService.readDir(`file://${this.workingDirectory}`);
          return entries.map((entry) => ({
            name: entry.name,
            path: `${this.workingDirectory}/${entry.name}`,
            isDirectory: entry.type === 'directory',
          }));
        } catch (error) {
          this.log(`Failed to refresh roots: ${error}`);
          return [];
        }
      },
      onCreateFile: async (dirPath, fileName) => {
        try {
          const newPath = `${dirPath}/${fileName}`;
          await this.fileService.write(`file://${newPath}`, '');
          this.window.showNotification(`Created ${fileName}`, 'success');
          return newPath;
        } catch (error) {
          this.window.showNotification(`Failed to create file: ${error}`, 'error');
          return null;
        }
      },
      onCreateFolder: async (dirPath, folderName) => {
        try {
          const newPath = `${dirPath}/${folderName}`;
          await this.fileService.createDir(`file://${newPath}`);
          this.window.showNotification(`Created folder ${folderName}`, 'success');
          return true;
        } catch (error) {
          this.window.showNotification(`Failed to create folder: ${error}`, 'error');
          return false;
        }
      },
      onRename: async (oldPath, newName) => {
        try {
          const dirPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
          const newPath = `${dirPath}/${newName}`;
          await this.fileService.rename(`file://${oldPath}`, `file://${newPath}`);
          this.window.showNotification(`Renamed to ${newName}`, 'success');
          return newPath;
        } catch (error) {
          this.window.showNotification(`Failed to rename: ${error}`, 'error');
          return null;
        }
      },
      onDelete: async (path) => {
        try {
          const name = path.substring(path.lastIndexOf('/') + 1);
          // Try file delete first, if it fails as directory, use deleteDir
          try {
            await this.fileService.delete(`file://${path}`);
          } catch {
            // If delete fails (e.g., it's a directory), try deleteDir with recursive
            await this.fileService.deleteDir(`file://${path}`, { recursive: true });
          }
          this.window.showNotification(`Deleted ${name}`, 'success');
          return true;
        } catch (error) {
          this.window.showNotification(`Failed to delete: ${error}`, 'error');
          return false;
        }
      },
      onNotify: (message, type) => {
        this.window.showNotification(message, type === 'success' ? 'info' : type);
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
      onOpenDiff: async (path, staged) => {
        await this.openFileDiff(path, staged);
      },
      onOpenFile: async (path) => {
        await this.openFile(`file://${this.workingDirectory}/${path}`);
      },
    };
    gitPanel.setCallbacks(callbacks);
  }

  /**
   * Configure outline panel callbacks.
   */
  private configureOutlinePanel(outlinePanel: OutlinePanel): void {
    // Set auto-follow from config
    const autoFollow = this.configManager.getWithDefault('tui.outline.autoFollow', true);
    outlinePanel.setAutoFollow(autoFollow);

    const callbacks: OutlinePanelCallbacks = {
      onSymbolSelect: async (uri, line, column) => {
        // Open the file if not already open, then navigate
        await this.openFile(uri, { focus: true });

        // Find the editor for this file and navigate to position
        const docInfo = this.openDocuments.get(uri);
        if (docInfo) {
          const container = this.window.getPaneContainer();
          const panes = container.getPanes();
          for (const pane of panes) {
            const element = pane.getElement(docInfo.editorId);
            if (element instanceof DocumentEditor) {
              // setCursor also ensures the cursor is visible
              element.setCursor({ line, column });
              this.window.focusElement(element);
              break;
            }
          }
        }
      },
    };
    outlinePanel.setCallbacks(callbacks);
  }

  /**
   * Update outline panel with symbols for a document.
   */
  private async updateOutlineForDocument(uri: string, editor: DocumentEditor): Promise<void> {
    if (!this.outlinePanel) return;

    // Only update if this is the focused editor
    const focusedElement = this.window.getFocusedElement();
    if (focusedElement !== editor) return;

    try {
      // Try LSP first
      const symbols = await localLSPService.getDocumentSymbols(uri);
      if (symbols.length > 0) {
        const outlineSymbols = this.convertLSPSymbols(symbols as LSPDocumentSymbol[]);
        this.outlinePanel.setSymbols(outlineSymbols, uri);
        return;
      }
    } catch {
      // LSP not available or failed, try fallback parser
    }

    // Fallback: use regex parser
    const parser = getSymbolParser(uri);
    if (parser) {
      const content = editor.getContent();
      const symbols = parser(content, uri);
      this.outlinePanel.setSymbols(symbols, uri);
    } else {
      // No parser available for this file type
      this.outlinePanel.clearSymbols();
    }
  }

  /**
   * Update outline panel for a GitDiffBrowser.
   * Shows symbols for the first file in the diff with changed sections highlighted.
   */
  private async updateOutlineForDiffBrowser(diffBrowser: GitDiffBrowser): Promise<void> {
    if (!this.outlinePanel) return;

    const artifacts = diffBrowser.getArtifacts();
    if (artifacts.length === 0) {
      this.outlinePanel.clearSymbols();
      return;
    }

    // Use the first file (or could be enhanced to use selected file)
    const artifact = artifacts[0]!;
    const filePath = artifact.filePath;
    const fullPath = `${this.workingDirectory}/${filePath}`;
    const uri = `file://${fullPath}`;

    try {
      // Get symbols from LSP
      const symbols = await localLSPService.getDocumentSymbols(uri);
      if (symbols.length === 0) {
        // Try fallback parser
        const parser = getSymbolParser(uri);
        if (parser) {
          const content = await Bun.file(fullPath).text();
          const fallbackSymbols = parser(content, uri);
          this.markSymbolsDiffState(fallbackSymbols, artifact.hunks);
          this.outlinePanel.setSymbols(fallbackSymbols, uri);
        } else {
          this.outlinePanel.clearSymbols();
        }
        return;
      }

      const outlineSymbols = this.convertLSPSymbols(symbols as LSPDocumentSymbol[]);
      this.markSymbolsDiffState(outlineSymbols, artifact.hunks);
      this.outlinePanel.setSymbols(outlineSymbols, uri);
    } catch {
      this.outlinePanel.clearSymbols();
    }
  }

  /**
   * Mark symbols with their diff state based on which lines are affected by hunks.
   */
  private markSymbolsDiffState(symbols: OutlineSymbol[], hunks: GitDiffHunk[]): void {
    // Build a set of affected line ranges (1-based, from newStart/newLines in hunks)
    const affectedRanges: Array<{ start: number; end: number; type: 'added' | 'modified' }> = [];

    for (const hunk of hunks) {
      // Check what type of change this hunk represents
      let hasAdded = false;
      let hasDeleted = false;

      for (const line of hunk.lines) {
        if (line.type === 'added') hasAdded = true;
        if (line.type === 'deleted') hasDeleted = true;
      }

      const changeType: 'added' | 'modified' = hasAdded && hasDeleted ? 'modified' : hasAdded ? 'added' : 'modified';

      // The hunk affects lines from newStart to newStart + newCount - 1
      affectedRanges.push({
        start: hunk.newStart,
        end: hunk.newStart + hunk.newCount - 1,
        type: changeType,
      });
    }

    // Recursively mark symbols
    const markSymbol = (symbol: OutlineSymbol): void => {
      // Symbol lines are 0-indexed, hunk lines are 1-indexed
      const symbolStart = symbol.startLine + 1;
      const symbolEnd = symbol.endLine + 1;

      // Check if any affected range overlaps with this symbol
      let hasChange = false;
      let isModified = false;
      let isAdded = false;

      for (const range of affectedRanges) {
        if (range.start <= symbolEnd && range.end >= symbolStart) {
          hasChange = true;
          if (range.type === 'modified') isModified = true;
          if (range.type === 'added') isAdded = true;
        }
      }

      if (hasChange) {
        symbol.diffState = isModified ? 'modified' : isAdded ? 'added' : 'modified';
      } else {
        symbol.diffState = 'unchanged';
      }

      // Mark children
      if (symbol.children) {
        for (const child of symbol.children) {
          markSymbol(child);
        }
      }
    };

    for (const symbol of symbols) {
      markSymbol(symbol);
    }
  }

  /**
   * Convert LSP document symbols to outline symbols.
   */
  private convertLSPSymbols(lspSymbols: LSPDocumentSymbol[], parent?: OutlineSymbol): OutlineSymbol[] {
    return lspSymbols.map((lsp, index) => {
      const symbol: OutlineSymbol = {
        id: parent ? `${parent.id}-${index}` : `symbol-${index}`,
        name: lsp.name,
        kind: lsp.kind,
        detail: lsp.detail,
        startLine: lsp.range.start.line,
        startColumn: lsp.range.start.character,
        endLine: lsp.range.end.line,
        parent,
      };

      if (lsp.children && lsp.children.length > 0) {
        symbol.children = this.convertLSPSymbols(lsp.children, symbol);
      }

      return symbol;
    });
  }

  /**
   * Configure git timeline panel callbacks.
   */
  private configureGitTimelinePanel(timelinePanel: GitTimelinePanel): void {
    // Set mode from config
    const mode = this.configManager.getWithDefault('tui.timeline.mode', 'file') as TimelineMode;
    timelinePanel.setMode(mode);
    timelinePanel.setRepoUri(`file://${this.workingDirectory}`);

    const callbacks: GitTimelinePanelCallbacks = {
      onViewDiff: async (commit, filePath) => {
        await this.openCommitDiff(commit.hash, commit.shortHash, commit.message, filePath);
      },
      onViewFileAtCommit: async (commit, filePath) => {
        await this.openFileAtCommit(commit.hash, filePath);
      },
      onCopyHash: async (hash) => {
        this.clipboard = hash;
        this.window.showNotification(`Copied: ${hash.substring(0, 8)}`, 'success');
      },
      onFocusChange: (focused) => {
        if (focused) {
          this.updateTimelineForCurrentFile();
        }
      },
      onModeChange: async (newMode) => {
        if (newMode === 'repo') {
          await this.updateTimelineRepoMode();
        } else {
          await this.updateTimelineForCurrentFile();
        }
      },
    };
    timelinePanel.setCallbacks(callbacks);
  }

  /**
   * Update timeline for current file (file mode).
   */
  private async updateTimelineForCurrentFile(): Promise<void> {
    if (!this.gitTimelinePanel) return;
    if (this.gitTimelinePanel.getMode() !== 'file') return;

    const focusedElement = this.window.getFocusedElement();
    if (!(focusedElement instanceof DocumentEditor)) {
      // Try to find the active editor in the editor pane
      if (this.editorPaneId) {
        const pane = this.window.getPaneContainer().getPane(this.editorPaneId);
        const activeElement = pane?.getActiveElement();
        if (activeElement instanceof DocumentEditor) {
          await this.loadTimelineForEditor(activeElement);
          return;
        }
      }
      this.gitTimelinePanel.clearCommits();
      return;
    }

    await this.loadTimelineForEditor(focusedElement);
  }

  /**
   * Load timeline for a specific editor.
   */
  private async loadTimelineForEditor(editor: DocumentEditor): Promise<void> {
    if (!this.gitTimelinePanel) return;

    const uri = editor.getUri();
    if (!uri) {
      this.gitTimelinePanel.clearCommits();
      return;
    }

    const absolutePath = uri.replace(/^file:\/\//, '');
    const count = this.configManager.getWithDefault('tui.timeline.commitCount', 50);

    this.gitTimelinePanel.setLoading(true);

    try {
      // Get the actual git repo root (handles monorepos/nested workspaces)
      const repoRoot = await gitCliService.getRoot(this.workingDirectory);
      if (!repoRoot) {
        this.gitTimelinePanel.clearCommits();
        return;
      }

      // Calculate path relative to repo root, not workspace root
      let filePath: string;
      if (absolutePath.startsWith(repoRoot + '/')) {
        filePath = absolutePath.slice(repoRoot.length + 1);
      } else if (absolutePath.startsWith(repoRoot)) {
        filePath = absolutePath.slice(repoRoot.length);
      } else {
        // File is outside the repo
        this.gitTimelinePanel.clearCommits();
        return;
      }

      const commits = await gitCliService.fileLog(repoRoot, filePath, count);
      this.gitTimelinePanel.setCommits(commits, uri, filePath);
    } catch {
      this.gitTimelinePanel.clearCommits();
    }
  }

  /**
   * Update timeline for repo mode.
   */
  private async updateTimelineRepoMode(): Promise<void> {
    if (!this.gitTimelinePanel) return;

    const count = this.configManager.getWithDefault('tui.timeline.commitCount', 50);

    this.gitTimelinePanel.setLoading(true);

    try {
      const commits = await gitCliService.log(this.workingDirectory, count);
      this.gitTimelinePanel.setCommits(commits);
    } catch {
      this.gitTimelinePanel.clearCommits();
    }
  }

  /**
   * Open a file at a specific commit.
   */
  private async openFileAtCommit(commitHash: string, filePath: string): Promise<void> {
    try {
      // Get the actual git repo root
      const repoRoot = await gitCliService.getRoot(this.workingDirectory);
      if (!repoRoot) {
        this.window.showNotification('Not in a git repository', 'error');
        return;
      }

      const content = await gitCliService.show(repoRoot, filePath, commitHash);
      const fileName = filePath.split('/').pop() || filePath;
      const shortHash = commitHash.substring(0, 7);

      // Find or create a pane for the editor
      const pane = this.editorPaneId
        ? this.window.getPaneContainer().getPane(this.editorPaneId)
        : this.window.getPaneContainer().ensureRoot();

      if (!pane) return;

      // Add editor element with a virtual URI to indicate it's read-only historical content
      const title = `${fileName} @ ${shortHash}`;
      const virtualUri = `git://${commitHash}/${filePath}`;
      const editorId = pane.addElement('DocumentEditor', title);
      const editor = pane.getElement(editorId) as DocumentEditor | null;

      if (editor) {
        editor.setContent(content);
        editor.setUri(virtualUri);
        editor.setReadOnly(true);
        this.window.focusElement(editor);
      }
    } catch (error) {
      this.window.showNotification(`Failed to get file at commit: ${error}`, 'error');
    }
  }

  /**
   * Open a diff viewer showing changes from a specific commit.
   *
   * @param commitHash Full commit hash
   * @param shortHash Short commit hash for display
   * @param message Commit message for title
   * @param filePath Optional file path to filter to a specific file
   */
  private async openCommitDiff(
    commitHash: string,
    shortHash: string,
    message: string,
    filePath?: string
  ): Promise<void> {
    try {
      const repoUri = `file://${this.workingDirectory}`;

      // Get list of files changed in this commit
      const changedFiles = filePath
        ? [filePath]
        : await gitCliService.getCommitFiles(repoUri, commitHash);

      if (changedFiles.length === 0) {
        this.window.showNotification('No changes in this commit', 'info');
        return;
      }

      // Get diffs for each file and create artifacts
      const artifacts = [];
      for (const file of changedFiles) {
        const hunks = await gitCliService.diffCommit(repoUri, commitHash, file);
        if (hunks.length > 0) {
          const artifact = createGitDiffArtifact(file, hunks, {
            staged: false, // Commit diffs are historical, not staged
            changeType: 'modified', // TODO: Could detect add/delete from diff
          });
          artifacts.push(artifact);
        }
      }

      if (artifacts.length === 0) {
        this.window.showNotification('No diff data for this commit', 'info');
        return;
      }

      // Find or create a pane for the diff viewer
      const pane = this.editorPaneId
        ? this.window.getPaneContainer().getPane(this.editorPaneId)
        : this.window.getPaneContainer().ensureRoot();

      if (!pane) return;

      // Create the diff browser tab
      const truncatedMessage = message.length > 30 ? message.substring(0, 30) + '…' : message;
      const title = `${shortHash}: ${truncatedMessage}`;
      const diffBrowserId = pane.addElement('GitDiffBrowser', title);
      const diffBrowser = pane.getElement(diffBrowserId) as GitDiffBrowser | null;

      if (diffBrowser) {
        // Configure the diff browser
        diffBrowser.setBrowserSubtitle(`Commit ${shortHash}`);
        diffBrowser.setHistoricalDiff(true); // Commit diffs don't auto-refresh
        diffBrowser.setArtifacts(artifacts);

        // Set up diagnostics provider for LSP integration
        const diagnosticsProvider = this.getDiagnosticsProvider();
        if (diagnosticsProvider) {
          diffBrowser.setDiagnosticsProvider(diagnosticsProvider);
        }

        // Set up callbacks for opening files
        const callbacks: GitDiffBrowserCallbacks = {
          onOpenFile: (path, line) => {
            this.openFile(`file://${this.workingDirectory}/${path}`, { line });
          },
        };
        diffBrowser.setGitCallbacks(callbacks);

        // Focus the new tab
        this.window.focusElement(diffBrowser);
      }
    } catch (error) {
      debugLog(`[TUIClient] Failed to open commit diff: ${error}`);
      this.window.showNotification(`Failed to open diff: ${error}`, 'error');
    }
  }

  /**
   * Open a diff viewer for working tree changes.
   * @param staged If true, show staged changes; if false, show unstaged changes
   */
  private async openWorkingTreeDiff(staged: boolean): Promise<void> {
    try {
      const repoUri = `file://${this.workingDirectory}`;
      const status = await gitCliService.status(repoUri);

      // Get files to diff
      const filesToDiff = staged ? status.staged : status.unstaged;
      if (filesToDiff.length === 0) {
        this.window.showNotification(
          staged ? 'No staged changes' : 'No unstaged changes',
          'info'
        );
        return;
      }

      // Get diffs for each file
      const artifacts = [];
      for (const file of filesToDiff) {
        const hunks = await gitCliService.diff(repoUri, file.path, staged);
        if (hunks.length > 0) {
          const artifact = createGitDiffArtifact(file.path, hunks, {
            staged,
            changeType: file.status === 'A' ? 'added' : file.status === 'D' ? 'deleted' : 'modified',
          });
          artifacts.push(artifact);
        }
      }

      if (artifacts.length === 0) {
        this.window.showNotification('No diff data available', 'info');
        return;
      }

      // Find or create pane
      const pane = this.editorPaneId
        ? this.window.getPaneContainer().getPane(this.editorPaneId)
        : this.window.getPaneContainer().ensureRoot();

      if (!pane) return;

      // Create diff browser
      const title = staged ? 'Staged Changes' : 'Changes';
      const diffBrowserId = pane.addElement('GitDiffBrowser', title);
      const diffBrowser = pane.getElement(diffBrowserId) as GitDiffBrowser | null;

      if (diffBrowser) {
        diffBrowser.setStaged(staged);
        diffBrowser.setArtifacts(artifacts);

        // Set up diagnostics
        const diagnosticsProvider = this.getDiagnosticsProvider();
        if (diagnosticsProvider) {
          diffBrowser.setDiagnosticsProvider(diagnosticsProvider);
        }

        // Set up edit callbacks for inline editing
        diffBrowser.setEditCallbacks(this.getEditCallbacks());

        // Set up git callbacks
        const callbacks: GitDiffBrowserCallbacks = {
          onOpenFile: (path, line) => {
            this.openFile(`file://${this.workingDirectory}/${path}`, { line });
          },
          onStageFile: async (path) => {
            await gitCliService.stage(this.workingDirectory, [path]);
            await this.refreshGitStatus();
            this.window.showNotification(`Staged: ${path}`, 'success');
          },
          onUnstageFile: async (path) => {
            await gitCliService.unstage(this.workingDirectory, [path]);
            await this.refreshGitStatus();
            this.window.showNotification(`Unstaged: ${path}`, 'success');
          },
          onDiscardFile: async (path) => {
            await gitCliService.discard(`file://${this.workingDirectory}`, [path]);
            await this.refreshGitStatus();
            this.window.showNotification(`Discarded: ${path}`, 'success');
          },
        };
        diffBrowser.setGitCallbacks(callbacks);

        this.window.focusElement(diffBrowser);
      }
    } catch (error) {
      debugLog(`[TUIClient] Failed to open working tree diff: ${error}`);
      this.window.showNotification(`Failed to open diff: ${error}`, 'error');
    }
  }

  /**
   * Open a diff viewer for a file.
   * @param pathOverride Optional relative path to diff (if not provided, uses focused editor)
   * @param staged Whether to show staged changes (default: false for unstaged)
   */
  private async openFileDiff(pathOverride?: string, staged: boolean = false): Promise<void> {
    let relativePath: string;

    if (pathOverride) {
      relativePath = pathOverride;
    } else {
      // Get path from focused editor
      const focusedElement = this.window.getFocusedElement();
      if (!(focusedElement instanceof DocumentEditor)) {
        this.window.showNotification('No file open', 'info');
        return;
      }

      const uri = this.findUriForEditor(focusedElement);
      if (!uri) {
        this.window.showNotification('File not saved', 'info');
        return;
      }

      const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
      relativePath = filePath.startsWith(this.workingDirectory)
        ? filePath.slice(this.workingDirectory.length + 1)
        : filePath;
    }

    try {
      const repoUri = `file://${this.workingDirectory}`;
      const hunks = await gitCliService.diff(repoUri, relativePath, staged);

      if (hunks.length === 0) {
        this.window.showNotification('No changes in this file', 'info');
        return;
      }

      const artifact = createGitDiffArtifact(relativePath, hunks, {
        staged,
        changeType: 'modified',
      });

      // Find or create pane
      const pane = this.editorPaneId
        ? this.window.getPaneContainer().getPane(this.editorPaneId)
        : this.window.getPaneContainer().ensureRoot();

      if (!pane) return;

      const title = staged
        ? `Staged: ${relativePath.split('/').pop()}`
        : `Diff: ${relativePath.split('/').pop()}`;
      const diffBrowserId = pane.addElement('GitDiffBrowser', title);
      const diffBrowser = pane.getElement(diffBrowserId) as GitDiffBrowser | null;

      if (diffBrowser) {
        diffBrowser.setStaged(staged);
        diffBrowser.setArtifacts([artifact]);

        const diagnosticsProvider = this.getDiagnosticsProvider();
        if (diagnosticsProvider) {
          diffBrowser.setDiagnosticsProvider(diagnosticsProvider);
        }

        diffBrowser.setEditCallbacks(this.getEditCallbacks());

        const callbacks: GitDiffBrowserCallbacks = {
          onOpenFile: (path, line) => {
            this.openFile(`file://${this.workingDirectory}/${path}`, { line });
          },
          onStageFile: async (path) => {
            await gitCliService.stage(this.workingDirectory, [path]);
            await this.refreshGitStatus();
          },
          onUnstageFile: async (path) => {
            await gitCliService.unstage(this.workingDirectory, [path]);
            await this.refreshGitStatus();
          },
          onDiscardFile: async (path) => {
            await gitCliService.discard(`file://${this.workingDirectory}`, [path]);
            await this.refreshGitStatus();
          },
        };
        diffBrowser.setGitCallbacks(callbacks);

        this.window.focusElement(diffBrowser);
      }
    } catch (error) {
      debugLog(`[TUIClient] Failed to open file diff: ${error}`);
      this.window.showNotification(`Failed to open diff: ${error}`, 'error');
    }
  }

  /**
   * Configure document editor callbacks.
   * @param uri File URI, or null for untitled documents
   */
  private configureDocumentEditor(editor: DocumentEditor, uri: string | null): void {
    // Debounce timer for syntax highlighting updates
    let syntaxUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    // Debounce timer for LSP document change notifications
    let lspUpdateTimer: ReturnType<typeof setTimeout> | null = null;

    const callbacks: DocumentEditorCallbacks = {
      onContentChange: (content) => {
        // Update status bar (dirty indicator may change)
        this.updateStatusBarFile(editor);

        // Only update syntax/LSP for saved files with a URI
        if (uri) {
          // Debounce syntax highlighting updates (200ms delay)
          if (syntaxUpdateTimer) {
            clearTimeout(syntaxUpdateTimer);
          }
          syntaxUpdateTimer = setTimeout(() => {
            this.updateSyntaxHighlighting(uri, editor);
          }, 200);

          // Debounce LSP document change notifications
          if (lspUpdateTimer) {
            clearTimeout(lspUpdateTimer);
          }
          lspUpdateTimer = setTimeout(() => {
            this.lspDocumentChanged(uri, content);
          }, 100);
        }
      },
      onCursorChange: () => {
        // Update cursor position in status bar
        this.updateStatusBarFile(editor);

        // Update outline panel with cursor position for auto-follow
        if (this.outlinePanel && uri) {
          const cursor = editor.getCursor();
          this.outlinePanel.updateCursorPosition(cursor.line, cursor.column);
        }
      },
      onSave: () => {
        this.saveCurrentDocument();
      },
      onCharTyped: (char, position) => {
        // Trigger autocomplete if character is a trigger (only for saved files)
        if (uri) {
          this.handleCharTyped(editor, uri, char, position);
        }
      },
      onFocus: () => {
        // Check for external file changes when editor receives focus (only for saved files)
        if (uri) {
          this.checkExternalFileChanges(uri, editor);
          // Update outline panel when switching to this editor
          this.updateOutlineForDocument(uri, editor);
        }
      },
      onGetDiffHunk: async (bufferLine: number) => {
        // Only works for saved files with git changes
        if (!uri) return null;

        try {
          // Convert URI to file path for git service
          const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
          const repoUri = `file://${this.workingDirectory}`;

          // Get diff hunks for this file (unstaged changes)
          const hunks = await gitCliService.diff(repoUri, filePath, false);

          // Find the hunk that contains this line (1-based line number in new file)
          const lineNumber = bufferLine + 1; // Convert 0-based to 1-based
          for (const hunk of hunks) {
            // Check if line is within the hunk's range in the new file
            const hunkEnd = hunk.newStart + hunk.newCount - 1;
            if (lineNumber >= hunk.newStart && lineNumber <= hunkEnd) {
              return hunk;
            }
          }

          return null;
        } catch {
          return null;
        }
      },
      onStageHunk: async (_bufferLine, _hunk) => {
        // Stage the file (staging individual hunks requires git add -p which is interactive)
        if (!uri) return;
        try {
          const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
          await gitCliService.stage(this.workingDirectory, [filePath]);
          // Refresh git status and line changes
          await this.refreshGitStatus();
          await this.updateGitLineChanges(editor, uri);
          this.window.showNotification('Changes staged', 'success');
        } catch (err) {
          this.window.showNotification(`Failed to stage: ${err}`, 'error');
        }
      },
      onRevertHunk: async (_bufferLine, _hunk) => {
        // Discard all changes to the file (discarding individual hunks is complex)
        if (!uri) return;
        try {
          const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
          await gitCliService.discard(this.workingDirectory, [filePath]);
          // Reload the file content
          const fileContent = await this.fileService.read(uri);
          editor.setContent(fileContent.content);
          editor.markSaved();
          // Refresh git status
          await this.refreshGitStatus();
          await this.updateGitLineChanges(editor, uri);
          this.window.showNotification('Changes discarded', 'success');
        } catch (err) {
          this.window.showNotification(`Failed to discard: ${err}`, 'error');
        }
      },
      onConfirmRevert: async (message: string) => {
        if (!this.dialogManager) return false;
        const result = await this.dialogManager.showConfirm({
          title: 'Discard Changes',
          message,
          confirmText: 'Discard',
          cancelText: 'Cancel',
          destructive: true,
        });
        return result.confirmed;
      },
    };
    editor.setCallbacks(callbacks);
    if (uri) {
      editor.setUri(uri);
    }

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
    // Check if this is a SQL file - use SQLEditor instead
    if (uri.endsWith('.sql') || uri.endsWith('.pgsql') || uri.endsWith('.psql')) {
      await this.openSqlFile(uri, options);
      return null; // SQLEditor is not a DocumentEditor
    }

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
      // Read file content (or create empty content for new files)
      let fileContent: { content: string; modTime?: number };
      try {
        fileContent = await this.fileService.read(uri);
      } catch {
        // File doesn't exist - create it with empty content
        this.log(`File not found, creating new file: ${uri}`);
        fileContent = { content: '' };
      }

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

      // Track open document with modification time
      this.openDocuments.set(uri, {
        documentId: result.documentId,
        editorId,
        syntaxSessionId,
        lastModified: fileContent.modTime,
      });

      // Notify LSP of document open
      await this.lspDocumentOpened(uri, fileContent.content);

      // Focus if requested
      if (options.focus !== false) {
        this.window.focusElement(editor);
      }

      // Navigate to line/column if specified
      if (options.line !== undefined) {
        editor.goToLine(options.line);
        if (options.column !== undefined) {
          editor.setCursor({ line: options.line - 1, column: options.column });
        }
      }

      // Update status bar with file info
      this.updateStatusBarFile(editor);

      // Update git line changes for gutter indicators
      this.updateGitLineChanges(editor, uri);

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
   * Create a new untitled document.
   */
  newFile(): DocumentEditor | null {
    // Determine which pane to use
    const pane = this.getTargetEditorPane();
    if (!pane) {
      this.window.showNotification('No editor pane available', 'error');
      return null;
    }

    // Generate unique untitled name
    const filename = `Untitled-${this.untitledCounter++}`;

    // Add editor element via factory
    const editorId = pane.addElement('DocumentEditor', filename);
    const editor = pane.getElement(editorId) as DocumentEditor | null;

    if (!editor) {
      this.window.showNotification('Failed to create editor', 'error');
      return null;
    }

    // Configure the editor callbacks (null URI for untitled)
    this.configureDocumentEditor(editor, null);

    // Set empty content
    editor.setContent('');

    // Focus the new editor
    this.window.focusElement(editor);

    // Mark session dirty
    this.markSessionDirty();

    this.log(`Created new file: ${filename}`);
    return editor;
  }

  /**
   * Save the current document.
   */
  async saveCurrentDocument(): Promise<boolean> {
    const editor = this.window.getFocusedElement();

    // Handle SQLEditor
    if (editor instanceof SQLEditor) {
      await editor.save();
      return true;
    }

    if (!(editor instanceof DocumentEditor)) {
      this.window.showNotification('No document to save', 'warning');
      return false;
    }

    const uri = editor.getUri();
    if (!uri) {
      // Untitled file - trigger Save As
      await this.showSaveAsDialog();
      return true;
    }

    try {
      const content = editor.getContent();
      const result = await this.fileService.write(uri, content);

      // Update stored mtime to prevent false "external change" detection
      const docInfo = this.openDocuments.get(uri);
      if (docInfo) {
        docInfo.lastModified = result.modTime;
      }

      // Notify LSP of document save
      await this.lspDocumentSaved(uri, content);

      // Invalidate git cache for this file and update line changes
      const repoUri = `file://${this.workingDirectory}`;
      gitCliService.invalidateCache(repoUri);
      await this.updateGitLineChanges(editor, uri);

      // Clear modified flag
      editor.markSaved();

      this.window.showNotification('File saved', 'success');
      return true;
    } catch (error) {
      this.window.showNotification(`Failed to save: ${error}`, 'error');
      return false;
    }
  }

  /**
   * Update git line changes for an editor.
   * Shows added/modified/deleted lines in the gutter.
   */
  private async updateGitLineChanges(editor: DocumentEditor, uri: string): Promise<void> {
    try {
      // Convert URI to file path for git service
      const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
      const repoUri = `file://${this.workingDirectory}`;

      // Get line-level changes from git
      const lineChanges = await gitCliService.diffLines(repoUri, filePath);

      // Convert to map for editor
      const changeMap = new Map<number, 'added' | 'modified' | 'deleted'>();
      for (const change of lineChanges) {
        changeMap.set(change.line, change.type);
      }

      editor.setGitLineChanges(changeMap);
    } catch {
      // Not a git repo or other error - clear git indicators
      editor.clearGitLineChanges();
    }
  }

  /**
   * Check if a file has been modified externally and reload if needed.
   * Called when an editor receives focus.
   */
  private async checkExternalFileChanges(uri: string, editor: DocumentEditor): Promise<void> {
    // Check if watching is enabled
    const watchMode = this.configManager.getWithDefault('files.watchFiles', 'onFocus');
    if (watchMode === 'off') return;

    const docInfo = this.openDocuments.get(uri);
    if (!docInfo?.lastModified) return;

    try {
      // Get current file stats
      const stats = await this.fileService.stat(uri);
      if (!stats.exists || stats.isDirectory) return;

      const currentMtime = stats.modTime;
      if (currentMtime <= docInfo.lastModified) return;

      // File has been modified externally
      this.log(`External change detected for: ${uri}`);

      // If document is dirty, warn but don't reload
      if (editor.isModified()) {
        this.window.showNotification(
          'File changed externally. Save your changes to overwrite or close without saving to reload.',
          'warning'
        );
        return;
      }

      // Reload the file content
      const fileContent = await this.fileService.read(uri);
      editor.setContent(fileContent.content);

      // Update mtime
      docInfo.lastModified = fileContent.modTime;

      // Update syntax highlighting
      if (docInfo.syntaxSessionId) {
        await this.syntaxService.updateSession(docInfo.syntaxSessionId, fileContent.content);
        this.applySyntaxTokens(editor, docInfo.syntaxSessionId);
      }

      // Notify LSP
      await this.lspDocumentChanged(uri, fileContent.content);

      this.window.showNotification('File reloaded (changed externally)', 'info');
      this.scheduleRender();
    } catch (error) {
      this.log(`Failed to check external changes: ${error}`);
    }
  }

  /**
   * Show the Open File dialog.
   */
  private async showOpenFileDialog(): Promise<void> {
    if (!this.fileBrowserDialog) return;

    const result = await this.fileBrowserDialog.showBrowser({
      title: 'Open File',
      startPath: this.workingDirectory,
      width: 70,
      height: 25,
    });

    if (result.confirmed && result.value) {
      // Convert file path to URI for openFile
      const uri = this.fileService.pathToUri(result.value);
      await this.openFile(uri);
    }
  }

  /**
   * Show the Save As dialog.
   */
  private async showSaveAsDialog(): Promise<void> {
    if (!this.saveAsDialog) return;

    // Get current document info for default filename
    const editor = this.window.getFocusedElement();
    let defaultPath = this.workingDirectory;
    let defaultFilename = 'untitled.txt';

    if (editor instanceof DocumentEditor) {
      const uri = editor.getUri();
      if (uri) {
        // Convert URI to file path if needed
        const filePath = this.fileService.uriToPath(uri) || uri;
        // Use current file's directory and name
        const lastSlash = filePath.lastIndexOf('/');
        if (lastSlash >= 0) {
          defaultPath = filePath.substring(0, lastSlash);
          defaultFilename = filePath.substring(lastSlash + 1);
        }
      }
    }

    const result = await this.saveAsDialog.showSaveAs({
      title: 'Save As',
      startPath: defaultPath,
      suggestedFilename: defaultFilename,
      width: 70,
      height: 25,
    });

    if (result.confirmed && result.value) {
      await this.saveDocumentAs(result.value);
    }
  }

  /**
   * Save the current document to a new path.
   */
  private async saveDocumentAs(newPath: string): Promise<boolean> {
    const editor = this.window.getFocusedElement();
    if (!(editor instanceof DocumentEditor)) {
      this.window.showNotification('No document to save', 'warning');
      return false;
    }

    try {
      const content = editor.getContent();
      // Convert file path to URI for the file service
      const newUri = this.fileService.pathToUri(newPath);
      const result = await this.fileService.write(newUri, content);

      // Update editor URI and title
      const oldUri = editor.getUri();
      editor.setUri(newUri);

      // Update tab title to new filename
      const filename = newPath.split('/').pop() || 'untitled';
      editor.setTitle(filename);

      // Update open documents map
      if (oldUri) {
        const docInfo = this.openDocuments.get(oldUri);
        if (docInfo) {
          this.openDocuments.delete(oldUri);
          docInfo.lastModified = result.modTime;
          this.openDocuments.set(newUri, docInfo);
        }
      }

      // Notify LSP of the change
      if (oldUri) {
        await this.lspDocumentClosed(oldUri);
      }
      await this.lspDocumentOpened(newUri, content);

      // Update syntax highlighting for new language
      const docInfo = this.openDocuments.get(newUri);
      if (docInfo) {
        // End old syntax session
        if (docInfo.syntaxSessionId) {
          this.syntaxService.disposeSession(docInfo.syntaxSessionId);
        }
        // Start new syntax session with correct language
        const languageId = this.detectLanguage(newPath);
        const syntaxSession = await this.syntaxService.createSession(newPath, languageId, content);
        docInfo.syntaxSessionId = syntaxSession.sessionId;
        if (docInfo.syntaxSessionId) {
          await this.applySyntaxTokens(editor, docInfo.syntaxSessionId);
        }
      }

      // Clear modified flag
      editor.markSaved();

      this.window.showNotification(`Saved as ${filename}`, 'success');
      this.scheduleRender();
      return true;
    } catch (error) {
      this.window.showNotification(`Failed to save: ${error}`, 'error');
      return false;
    }
  }

  /**
   * Close the current document.
   * Shows save confirmation if document has unsaved changes.
   */
  async closeCurrentDocument(): Promise<boolean> {
    const element = this.window.getFocusedElement();
    if (!element) {
      return false;
    }

    // For DocumentEditor, handle unsaved changes
    if (element instanceof DocumentEditor) {
      const isUntitled = element.getUri() === null;
      const hasChanges = element.isModified() || isUntitled;

      if (hasChanges) {
        if (!this.dialogManager) {
          return false;
        }
        const filename = element.getTitle();
        const result = await this.dialogManager.showSaveConfirm(filename);

        if (result.cancelled) {
          // User cancelled - don't close
          return false;
        }

        if (result.confirmed && result.value === true) {
          // User wants to save first
          const saved = await this.saveCurrentDocument();
          if (!saved) {
            // Save failed or was cancelled - don't close
            return false;
          }
        }
        // else: result.value === false means "Don't Save" - proceed with close
      }

      const uri = element.getUri();
      if (uri) {
        const doc = this.openDocuments.get(uri);
        if (doc) {
          await this.documentService.close(doc.documentId);
          this.openDocuments.delete(uri);
        }
        // Notify LSP of document close
        await this.lspDocumentClosed(uri);
      }
    }

    // Remove element from pane (works for any element type)
    const pane = this.window.getFocusedPane();
    if (pane) {
      pane.removeElement(element.id);
    }

    // Mark session dirty
    this.markSessionDirty();

    return true;
  }

  /**
   * Handle element close request from tab X click.
   * Returns true to proceed with close, false to cancel.
   */
  private async handleElementCloseRequest(elementId: string, element: BaseElement): Promise<boolean> {
    if (element instanceof DocumentEditor) {
      // Check for unsaved changes
      const isUntitled = element.getUri() === null;
      const hasChanges = element.isModified() || isUntitled;

      if (hasChanges) {
        if (!this.dialogManager) {
          return false;
        }
        const filename = element.getTitle();
        const result = await this.dialogManager.showSaveConfirm(filename);

        if (result.cancelled) {
          // User cancelled - don't close
          return false;
        }

        if (result.confirmed && result.value === true) {
          // User wants to save first - focus the element and save
          this.window.focusElement(element);
          const saved = await this.saveCurrentDocument();
          if (!saved) {
            // Save failed or was cancelled - don't close
            return false;
          }
        }
        // else: result.value === false means "Don't Save" - proceed with close
      }

      // Clean up document resources
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

          // Notify LSP of document close
          this.lspDocumentClosed(uri);

          this.openDocuments.delete(uri);
        }
      }

      // Mark session dirty
      this.markSessionDirty();
      return true;
    } else if (element instanceof TerminalSession) {
      // Clean up PTY for terminals in panes
      const pty = this.paneTerminals.get(elementId);
      if (pty) {
        debugLog(`[TUIClient] Killing PTY for terminal: ${elementId}`);
        pty.kill();
        this.paneTerminals.delete(elementId);
      }
      return true;
    } else if (element instanceof AITerminalChat) {
      // Show confirmation dialog if the AI chat is running
      if (element.isRunning()) {
        if (!this.dialogManager) {
          return false;
        }
        const providerName = element.getProviderName();
        const result = await this.dialogManager.showConfirm({
          title: 'Close AI Chat',
          message: `Are you sure you want to close this ${providerName} chat?\n\nThe session will be ended.`,
          confirmText: 'Close',
          declineText: 'Cancel',
          destructive: true,
        });

        if (!result.confirmed) {
          return false;
        }
      }

      // Clean up AI chat tracking
      if (this.paneAIChats.has(elementId)) {
        debugLog(`[TUIClient] Removing AI chat from tracking: ${elementId}`);
        this.paneAIChats.delete(elementId);
      }
      return true;
    } else if (element instanceof SQLEditor) {
      // Check if SQL editor has unsaved changes
      if (element.getIsDirty()) {
        if (!this.dialogManager) {
          return false;
        }
        const result = await this.dialogManager.showConfirm({
          title: 'Unsaved Changes',
          message: 'This SQL file has unsaved changes. Close anyway?',
          confirmText: 'Close',
          declineText: 'Cancel',
          destructive: true,
        });

        if (!result.confirmed) {
          return false;
        }
      }

      // Clean up SQL editor tracking
      if (this.paneSQLEditors.has(elementId)) {
        debugLog(`[TUIClient] Removing SQL editor from tracking: ${elementId}`);
        this.paneSQLEditors.delete(elementId);
      }
      return true;
    }

    return true;
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

  /**
   * Start watching the workspace directory for file changes.
   */
  private startWorkspaceWatcher(): void {
    this.stopWorkspaceWatcher();

    try {
      const workspaceUri = `file://${this.workingDirectory}`;

      // Watch the working directory recursively using file service
      this.workspaceWatcher = this.fileService.watch(
        workspaceUri,
        (event) => {
          // Extract relative path from URI for filtering
          const relativePath = event.uri.replace(workspaceUri + '/', '');

          // Skip hidden files, common noise, and debug log
          if (
            relativePath.startsWith('.git/') ||
            relativePath.includes('node_modules/') ||
            relativePath.endsWith('.swp') ||
            relativePath.endsWith('~') ||
            relativePath === 'debug.log'
          ) {
            return;
          }

          this.log(`Workspace file ${event.type}: ${relativePath}`);
          this.scheduleWorkspaceRefresh();
        },
        {
          recursive: true,
          debounceMs: 100,
          excludePatterns: ['**/.git/**', '**/node_modules/**', '**/*.swp', '**/*~'],
        }
      );

      this.log(`Started watching workspace: ${this.workingDirectory}`);
    } catch (error) {
      this.log(`Failed to start workspace watcher: ${error}`);
    }
  }

  /**
   * Stop the workspace directory watcher.
   */
  private stopWorkspaceWatcher(): void {
    if (this.workspaceWatcher) {
      this.workspaceWatcher.dispose();
      this.workspaceWatcher = null;
    }
    if (this.workspaceRefreshTimer) {
      clearTimeout(this.workspaceRefreshTimer);
      this.workspaceRefreshTimer = null;
    }
  }

  /**
   * Schedule a debounced file tree refresh.
   */
  private scheduleWorkspaceRefresh(): void {
    // Clear existing timer
    if (this.workspaceRefreshTimer) {
      clearTimeout(this.workspaceRefreshTimer);
    }

    // Debounce to avoid excessive refreshes
    this.workspaceRefreshTimer = setTimeout(async () => {
      this.workspaceRefreshTimer = null;
      if (this.fileTree) {
        this.log('Refreshing file tree due to workspace changes');
        await this.fileTree.refresh();
      }
    }, 300); // 300ms debounce
  }

  /**
   * Start listening for git change events to auto-refresh diff browsers.
   */
  private startGitChangeListener(): void {
    this.stopGitChangeListener();

    this.gitChangeUnsubscribe = gitCliService.onChange((event) => {
      this.log(`Git change event: ${event.type}`);
      this.notifyDiffBrowsersGitChange(event.type);
    });

    this.log('Started git change listener');
  }

  /**
   * Stop listening for git change events.
   */
  private stopGitChangeListener(): void {
    if (this.gitChangeUnsubscribe) {
      this.gitChangeUnsubscribe();
      this.gitChangeUnsubscribe = null;
    }
  }

  /**
   * Notify all active GitDiffBrowsers about a git change.
   */
  private notifyDiffBrowsersGitChange(changeType: import('../../../services/git/types.ts').GitChangeType): void {
    const container = this.window.getPaneContainer();
    const panes = container.getPanes();

    for (const pane of panes) {
      for (const element of pane.getElements()) {
        if (element instanceof GitDiffBrowser) {
          element.notifyGitChange(changeType);
        }
      }
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
      // Also update file tree with git status if enabled
      if (this.configManager.getWithDefault('tui.fileTree.showGitStatus', true)) {
        this.updateFileTreeGitStatus(status);
      }
    } catch (error) {
      this.log(`Failed to load git status: ${error}`);
    }
  }

  /**
   * Update file tree nodes with git status colors.
   */
  private updateFileTreeGitStatus(status: import('../../../services/git/types.ts').GitStatus): void {
    if (!this.fileTree) return;

    // Build a map of relative paths to git status codes
    const statusMap = new Map<string, string>();

    // Add staged files (prefer staged status)
    for (const file of status.staged) {
      statusMap.set(file.path, file.status);
    }

    // Add unstaged files (only if not already staged)
    for (const file of status.unstaged) {
      if (!statusMap.has(file.path)) {
        statusMap.set(file.path, file.status);
      }
    }

    // Add untracked files
    for (const path of status.untracked) {
      statusMap.set(path, '?');
    }

    // Update file tree nodes recursively
    const updateNode = (node: FileNode, parentPath: string): void => {
      // Calculate relative path from workspace root
      const relativePath = node.path.replace(this.workingDirectory + '/', '');

      // Check if this file has git status
      const gitStatus = statusMap.get(relativePath);
      if (gitStatus) {
        node.gitStatus = gitStatus;
      } else {
        // Clear git status if file is now clean
        node.gitStatus = undefined;
      }

      // For directories, check if any children have status
      if (node.isDirectory && node.children) {
        let hasModifiedChild = false;
        for (const child of node.children) {
          updateNode(child, node.path);
          if (child.gitStatus) {
            hasModifiedChild = true;
          }
        }
        // Optionally mark directory if it contains modified files
        if (hasModifiedChild && !node.gitStatus) {
          node.gitStatus = 'M'; // Mark as modified if children are modified
        }
      }
    };

    // Process all root nodes
    for (const root of this.fileTree.getRoots()) {
      updateNode(root, this.workingDirectory);
    }

    // Mark file tree dirty to re-render
    this.fileTree['ctx'].markDirty();
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

    // Handle paste events (bracketed paste mode)
    this.inputHandler.onPaste((text) => {
      this.log(`Paste received: ${text.length} chars`);
      // Insert the pasted text into the focused editor
      this.handlePasteText(text);
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

    this.commandHandlers.set('file.open', async () => {
      await this.showOpenFileDialog();
      return true;
    });

    this.commandHandlers.set('file.new', () => {
      this.newFile();
      return true;
    });

    this.commandHandlers.set('file.saveAs', async () => {
      await this.showSaveAsDialog();
      return true;
    });

    // Edit commands
    this.commandHandlers.set('edit.undo', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        if (element.canUndo()) {
          element.undo();
          this.scheduleRender();
        } else {
          this.window.showNotification('Nothing to undo', 'info');
        }
      }
      return true;
    });

    this.commandHandlers.set('edit.redo', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        if (element.canRedo()) {
          element.redo();
          this.scheduleRender();
        } else {
          this.window.showNotification('Nothing to redo', 'info');
        }
      }
      return true;
    });

    this.commandHandlers.set('edit.cut', async () => {
      await this.editCut();
      return true;
    });

    this.commandHandlers.set('edit.copy', async () => {
      await this.editCopy();
      return true;
    });

    this.commandHandlers.set('edit.paste', async () => {
      await this.editPaste();
      return true;
    });

    this.commandHandlers.set('edit.selectAll', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.selectAll();
        this.scheduleRender();
      }
      return true;
    });

    // Search commands
    this.commandHandlers.set('search.find', () => {
      this.showSearchDialog(false);
      return true;
    });

    this.commandHandlers.set('search.replace', () => {
      this.showSearchDialog(true);
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

    this.commandHandlers.set('editor.gotoSymbol', async () => {
      await this.showSymbolPicker();
      return true;
    });

    this.commandHandlers.set('editor.gotoWorkspaceSymbol', async () => {
      await this.showWorkspaceSymbolPicker();
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

    // Tab navigation in panes
    this.commandHandlers.set('editor.nextTab', () => {
      const pane = this.window.getFocusedPane();
      if (pane) {
        pane.nextTab();
        this.scheduleRender();
      }
      return true;
    });

    this.commandHandlers.set('editor.previousTab', () => {
      const pane = this.window.getFocusedPane();
      if (pane) {
        pane.prevTab();
        this.scheduleRender();
      }
      return true;
    });

    this.commandHandlers.set('editor.switchTab', async () => {
      await this.showTabSwitcherForCurrentPane();
      return true;
    });

    this.commandHandlers.set('editor.switchTabAllPanes', async () => {
      await this.showTabSwitcherForAllPanes();
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
      await this.showSettingsPalette();
      return true;
    });

    this.commandHandlers.set('workbench.openKeybindings', async () => {
      await this.showKeybindingsPalette();
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

    this.commandHandlers.set('terminal.newInPane', async () => {
      await this.createTerminalInPane();
      return true;
    });

    // AI Chat commands
    this.commandHandlers.set('ai.newChat', async () => {
      await this.createNewAIChat();
      return true;
    });

    this.commandHandlers.set('ai.newClaudeChat', async () => {
      await this.createNewAIChat(undefined, { provider: 'claude-code' });
      return true;
    });

    this.commandHandlers.set('ai.newCodexChat', async () => {
      await this.createNewAIChat(undefined, { provider: 'codex' });
      return true;
    });

    this.commandHandlers.set('ai.newGeminiChat', async () => {
      await this.createNewAIChat(undefined, { provider: 'gemini' });
      return true;
    });

    this.commandHandlers.set('ai.toggleChat', () => {
      this.toggleAIChat();
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

    this.commandHandlers.set('git.pull', async () => {
      await this.gitPull();
      return true;
    });

    this.commandHandlers.set('git.fetch', async () => {
      await this.gitFetch();
      return true;
    });

    this.commandHandlers.set('git.createBranch', async () => {
      await this.gitCreateBranch();
      return true;
    });

    this.commandHandlers.set('git.switchBranch', async () => {
      await this.gitSwitchBranch();
      return true;
    });

    this.commandHandlers.set('git.deleteBranch', async () => {
      await this.gitDeleteBranch();
      return true;
    });

    this.commandHandlers.set('git.renameBranch', async () => {
      await this.gitRenameBranch();
      return true;
    });

    this.commandHandlers.set('git.merge', async () => {
      await this.gitMerge();
      return true;
    });

    this.commandHandlers.set('git.abortMerge', async () => {
      await this.gitAbortMerge();
      return true;
    });

    this.commandHandlers.set('git.stash', async () => {
      await this.gitStash();
      return true;
    });

    this.commandHandlers.set('git.stashPop', async () => {
      await this.gitStashPop();
      return true;
    });

    this.commandHandlers.set('git.stashApply', async () => {
      await this.gitStashApply();
      return true;
    });

    this.commandHandlers.set('git.stashDrop', async () => {
      await this.gitStashDrop();
      return true;
    });

    this.commandHandlers.set('git.viewChanges', async () => {
      await this.openWorkingTreeDiff(false);
      return true;
    });

    this.commandHandlers.set('git.viewStagedChanges', async () => {
      await this.openWorkingTreeDiff(true);
      return true;
    });

    this.commandHandlers.set('git.openFileDiff', async () => {
      await this.openFileDiff();
      return true;
    });

    // Ultra namespace commands for keybindings
    this.commandHandlers.set('view.splitVertical', () => {
      this.splitEditorPane('vertical');
      return true;
    });

    this.commandHandlers.set('view.splitHorizontal', () => {
      this.splitEditorPane('horizontal');
      return true;
    });

    // Note: ultra.focusNextPane, ultra.focusPreviousPane are aliases for workbench.focusNextPane, workbench.focusPreviousPane
    // Note: ultra.toggleTerminal is an alias for workbench.toggleTerminal
    // Note: ultra.newTerminal is an alias for terminal.new
    // These are kept as aliases for backward compatibility with keybindings

    this.commandHandlers.set('view.closePane', () => {
      this.closeCurrentPane();
      return true;
    });

    this.commandHandlers.set('git.focusPanel', () => {
      this.focusGitPanel();
      return true;
    });

    // Git panel commands (context: gitPanelFocus)
    this.commandHandlers.set('gitPanel.stage', () => {
      if (this.gitPanel) {
        const node = this.gitPanel.getSelectedNode();
        if (node?.type === 'file' && node.section !== 'staged' && node.change) {
          this.gitPanel.getCallbacks().onStage?.(node.change.path);
        }
      }
      return true;
    });

    this.commandHandlers.set('gitPanel.stageAll', () => {
      if (this.gitPanel) {
        this.gitPanel.stageAll();
      }
      return true;
    });

    this.commandHandlers.set('gitPanel.unstage', () => {
      if (this.gitPanel) {
        const node = this.gitPanel.getSelectedNode();
        if (node?.type === 'file' && node.section === 'staged' && node.change) {
          this.gitPanel.getCallbacks().onUnstage?.(node.change.path);
        }
      }
      return true;
    });

    this.commandHandlers.set('gitPanel.discard', () => {
      if (this.gitPanel) {
        this.gitPanel.discardChanges();
      }
      return true;
    });

    this.commandHandlers.set('gitPanel.openDiff', () => {
      if (this.gitPanel) {
        this.gitPanel.openDiff();
      }
      return true;
    });

    this.commandHandlers.set('gitPanel.openFile', () => {
      if (this.gitPanel) {
        this.gitPanel.openFile();
      }
      return true;
    });

    this.commandHandlers.set('gitPanel.refresh', () => {
      this.gitPanel?.getCallbacks().onRefresh?.();
      return true;
    });

    this.commandHandlers.set('gitPanel.commit', () => {
      this.gitPanel?.getCallbacks().onCommit?.();
      return true;
    });

    this.commandHandlers.set('gitPanel.toggleSection', () => {
      if (this.gitPanel) {
        this.gitPanel.toggleSection();
      }
      return true;
    });

    this.commandHandlers.set('gitPanel.moveUp', () => {
      if (this.gitPanel) {
        this.gitPanel.moveUp();
      }
      return true;
    });

    this.commandHandlers.set('gitPanel.moveDown', () => {
      if (this.gitPanel) {
        this.gitPanel.moveDown();
      }
      return true;
    });

    // File tree commands (context: fileTreeFocus)
    this.commandHandlers.set('fileTree.moveUp', () => {
      this.fileTree?.moveUp();
      return true;
    });

    this.commandHandlers.set('fileTree.moveDown', () => {
      this.fileTree?.moveDown();
      return true;
    });

    this.commandHandlers.set('fileTree.expand', () => {
      this.fileTree?.expand();
      return true;
    });

    this.commandHandlers.set('fileTree.collapse', () => {
      this.fileTree?.collapse();
      return true;
    });

    this.commandHandlers.set('fileTree.open', () => {
      this.fileTree?.openSelected();
      return true;
    });

    this.commandHandlers.set('fileTree.newFile', () => {
      this.fileTree?.startNewFile();
      return true;
    });

    this.commandHandlers.set('fileTree.newFolder', () => {
      this.fileTree?.startNewFolder();
      return true;
    });

    this.commandHandlers.set('fileTree.rename', () => {
      this.fileTree?.startRename();
      return true;
    });

    this.commandHandlers.set('fileTree.delete', () => {
      this.fileTree?.startDelete();
      return true;
    });

    this.commandHandlers.set('fileTree.goToFirst', () => {
      this.fileTree?.goToFirst();
      return true;
    });

    this.commandHandlers.set('fileTree.goToLast', () => {
      this.fileTree?.goToLast();
      return true;
    });

    this.commandHandlers.set('fileTree.pageUp', () => {
      this.fileTree?.pageUp();
      return true;
    });

    this.commandHandlers.set('fileTree.pageDown', () => {
      this.fileTree?.pageDown();
      return true;
    });

    // Outline panel commands (context: outlinePanelFocus)
    this.commandHandlers.set('outlinePanel.moveUp', () => {
      this.outlinePanel?.moveUp();
      return true;
    });

    this.commandHandlers.set('outlinePanel.moveDown', () => {
      this.outlinePanel?.moveDown();
      return true;
    });

    this.commandHandlers.set('outlinePanel.expand', () => {
      this.outlinePanel?.expand();
      return true;
    });

    this.commandHandlers.set('outlinePanel.collapse', () => {
      this.outlinePanel?.collapse();
      return true;
    });

    this.commandHandlers.set('outlinePanel.toggleExpand', () => {
      this.outlinePanel?.toggleExpand();
      return true;
    });

    this.commandHandlers.set('outlinePanel.select', () => {
      this.outlinePanel?.selectSymbol();
      return true;
    });

    this.commandHandlers.set('outlinePanel.pageUp', () => {
      this.outlinePanel?.pageUp();
      return true;
    });

    this.commandHandlers.set('outlinePanel.pageDown', () => {
      this.outlinePanel?.pageDown();
      return true;
    });

    this.commandHandlers.set('outlinePanel.goToFirst', () => {
      this.outlinePanel?.goToFirst();
      return true;
    });

    this.commandHandlers.set('outlinePanel.goToLast', () => {
      this.outlinePanel?.goToLast();
      return true;
    });

    // Timeline panel commands (context: timelinePanelFocus)
    this.commandHandlers.set('timelinePanel.moveUp', () => {
      this.gitTimelinePanel?.moveUp();
      return true;
    });

    this.commandHandlers.set('timelinePanel.moveDown', () => {
      this.gitTimelinePanel?.moveDown();
      return true;
    });

    this.commandHandlers.set('timelinePanel.pageUp', () => {
      this.gitTimelinePanel?.pageUp();
      return true;
    });

    this.commandHandlers.set('timelinePanel.pageDown', () => {
      this.gitTimelinePanel?.pageDown();
      return true;
    });

    this.commandHandlers.set('timelinePanel.goToFirst', () => {
      this.gitTimelinePanel?.goToFirst();
      return true;
    });

    this.commandHandlers.set('timelinePanel.goToLast', () => {
      this.gitTimelinePanel?.goToLast();
      return true;
    });

    this.commandHandlers.set('timelinePanel.viewDiff', () => {
      this.gitTimelinePanel?.viewDiff();
      return true;
    });

    this.commandHandlers.set('timelinePanel.openFileAtCommit', () => {
      this.gitTimelinePanel?.openFileAtCommit();
      return true;
    });

    this.commandHandlers.set('timelinePanel.toggleMode', () => {
      this.gitTimelinePanel?.toggleMode();
      return true;
    });

    this.commandHandlers.set('timelinePanel.copyHash', () => {
      this.gitTimelinePanel?.copyHash();
      return true;
    });

    // Query Results commands (context: queryResultsFocus)
    this.commandHandlers.set('queryResults.moveUp', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'ArrowUp', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.moveDown', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.moveLeft', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'ArrowLeft', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.moveRight', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'ArrowRight', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.pageUp', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'PageUp', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.pageDown', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'PageDown', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.goToFirst', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'Home', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.goToLast', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'End', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.showDetails', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.refresh', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        // Call the refresh callback directly
        (element as any).callbacks?.onRefresh?.();
      }
      return true;
    });

    this.commandHandlers.set('queryResults.export', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'e', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.sort', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 's', ctrl: false, alt: false, shift: false, meta: false });
      }
      return true;
    });

    this.commandHandlers.set('queryResults.toggleViewMode', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof QueryResults) {
        element.handleKey({ key: 'Tab', ctrl: false, alt: false, shift: false, meta: false });
      }
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
      return this.stop().then(() => true);
    });

    this.commandHandlers.set('workbench.restart', () => {
      return this.stop(TUIClient.EXIT_CODE_RESTART).then(() => true);
    });

    this.commandHandlers.set('workbench.restartAndRebuild', () => {
      return this.stop(TUIClient.EXIT_CODE_RESTART_REBUILD).then(() => true);
    });

    // Migration command
    this.commandHandlers.set('workbench.migrateConfig', async () => {
      const hasLegacy = await this.configManager.hasLegacyConfig();
      if (!hasLegacy) {
        this.window.showNotification('No legacy config found in ~/.ultra/new-tui/', 'info');
        return true;
      }

      const result = await this.configManager.migrateFromLegacy();
      if (result.success) {
        this.window.showNotification(result.message, 'info');
        // Log details
        for (const detail of result.details) {
          this.log(detail);
        }
      } else {
        this.window.showNotification(result.message, 'error');
      }
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

    // Line selection and duplication commands
    this.commandHandlers.set('editor.selectLine', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.selectCurrentLine();
      }
      return true;
    });

    this.commandHandlers.set('editor.duplicateLine', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.duplicateLine();
      }
      return true;
    });

    this.commandHandlers.set('editor.duplicateSelection', () => {
      const element = this.window.getFocusedElement();
      if (element instanceof DocumentEditor) {
        element.duplicateSelection();
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

    // LSP commands
    this.commandHandlers.set('lsp.showHover', async () => {
      await this.lspShowHover();
      return true;
    });

    this.commandHandlers.set('lsp.goToDefinition', async () => {
      await this.lspGoToDefinition();
      return true;
    });

    this.commandHandlers.set('lsp.triggerCompletion', async () => {
      await this.lspTriggerCompletion();
      return true;
    });

    this.commandHandlers.set('lsp.triggerSignatureHelp', async () => {
      await this.lspTriggerSignatureHelp();
      return true;
    });

    // Database commands
    this.commandHandlers.set('database.newQuery', async () => {
      await this.openNewSqlEditor();
      return true;
    });

    this.commandHandlers.set('database.connect', async () => {
      await this.showDatabaseConnectionPicker();
      return true;
    });

    this.commandHandlers.set('database.newConnection', async () => {
      await this.showNewDatabaseConnectionDialog();
      return true;
    });

    this.commandHandlers.set('database.viewHistory', async () => {
      await this.showDatabaseQueryHistory();
      return true;
    });

    this.commandHandlers.set('database.browseSchema', async () => {
      await this.showDatabaseSchemaBrowser();
      return true;
    });

    // Sidebar panel commands
    this.commandHandlers.set('sidebar.addFileTree', () => {
      this.addSidebarPanel('FileTree', 'Explorer');
      return true;
    });

    this.commandHandlers.set('sidebar.addGitPanel', () => {
      this.addSidebarPanel('GitPanel', 'Source Control');
      return true;
    });

    this.commandHandlers.set('sidebar.addOutline', () => {
      this.addSidebarPanel('OutlinePanel', 'Outline');
      return true;
    });

    this.commandHandlers.set('sidebar.addTimeline', () => {
      this.addSidebarPanel('GitTimelinePanel', 'Timeline');
      return true;
    });
  }

  /**
   * Setup keybindings from config.
   */
  private setupKeybindings(): void {
    // Clear existing keybindings first (important for hot-reload)
    this.window.clearKeybindings();

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
    switch (when) {
      case 'editorHasMultipleCursors': {
        // Check if the focused element is an editor with multiple cursors
        const element = this.window.getFocusedElement();
        if (element && 'getCursors' in element && typeof element.getCursors === 'function') {
          const cursors = (element as { getCursors: () => unknown[] }).getCursors();
          return Array.isArray(cursors) && cursors.length > 1;
        }
        return false;
      }
      case 'editorFocus': {
        const element = this.window.getFocusedElement();
        return element?.type === 'DocumentEditor';
      }
      case 'terminalFocus': {
        const element = this.window.getFocusedElement();
        return element?.type === 'TerminalSession';
      }
      case 'fileTreeFocus': {
        const element = this.window.getFocusedElement();
        return element?.type === 'FileTree';
      }
      case 'gitPanelFocus': {
        const element = this.window.getFocusedElement();
        return element?.type === 'GitPanel';
      }
      case 'outlinePanelFocus': {
        const element = this.window.getFocusedElement();
        return element?.type === 'OutlinePanel';
      }
      case 'timelinePanelFocus': {
        const element = this.window.getFocusedElement();
        return element?.type === 'GitTimelinePanel';
      }
      case 'queryResultsFocus': {
        const element = this.window.getFocusedElement();
        return element?.type === 'QueryResults';
      }
      default:
        // Unknown when clause - return false to be safe (don't activate binding)
        return false;
    }
  }

  /**
   * Toggle sidebar visibility.
   */
  private toggleSidebar(): void {
    if (this.sidebarVisible) {
      this.hideSidebar();
    } else {
      this.showSidebar();
    }
    // Update setting to reflect new state
    this.configManager.set('tui.sidebar.visible', this.sidebarVisible);
    this.configManager.saveSettings();
  }

  /**
   * Show the sidebar.
   */
  private showSidebar(): void {
    if (this.sidebarVisible) return;
    if (!this.sidebarPaneId) return;

    const container = this.window.getPaneContainer();
    // Restore the sidebar ratio based on location
    if (this.sidebarLocation === 'left') {
      container.adjustRatios('split-1', [this.savedSidebarRatio, 1 - this.savedSidebarRatio]);
    } else {
      container.adjustRatios('split-1', [1 - this.savedSidebarRatio, this.savedSidebarRatio]);
    }

    this.sidebarVisible = true;
    this.scheduleRender();
    debugLog('[TUIClient] Sidebar shown');
  }

  /**
   * Hide the sidebar.
   */
  private hideSidebar(): void {
    if (!this.sidebarVisible) return;
    if (!this.sidebarPaneId) return;

    const container = this.window.getPaneContainer();
    // Save current ratio before hiding
    const sidebarWidth = this.configManager.getWithDefault('tui.sidebar.width', 36);
    const totalWidth = this.window.getSize().width;
    this.savedSidebarRatio = Math.min(0.3, sidebarWidth / totalWidth);

    // Set sidebar to minimal width (effectively hiding it) based on location
    if (this.sidebarLocation === 'left') {
      container.adjustRatios('split-1', [0.001, 0.999]);
    } else {
      container.adjustRatios('split-1', [0.999, 0.001]);
    }

    this.sidebarVisible = false;
    this.scheduleRender();
    debugLog('[TUIClient] Sidebar hidden');
  }

  /**
   * Update sidebar width based on setting.
   */
  private updateSidebarWidth(): void {
    if (!this.sidebarVisible) return;
    if (!this.sidebarPaneId) return;

    const sidebarWidth = this.configManager.getWithDefault('tui.sidebar.width', 36);
    const totalWidth = this.window.getSize().width;
    const sidebarRatio = Math.min(0.3, sidebarWidth / totalWidth);

    const container = this.window.getPaneContainer();
    // Ratios depend on sidebar location
    if (this.sidebarLocation === 'left') {
      container.adjustRatios('split-1', [sidebarRatio, 1 - sidebarRatio]);
    } else {
      container.adjustRatios('split-1', [1 - sidebarRatio, sidebarRatio]);
    }
    this.scheduleRender();
  }

  /**
   * Handle live updates when settings change.
   * Called when a setting is modified in the settings palette.
   */
  private handleSettingChange(key: string, value: unknown): void {
    switch (key) {
      case 'tui.sidebar.visible':
        if (value) {
          this.showSidebar();
        } else {
          this.hideSidebar();
        }
        break;

      case 'tui.sidebar.width':
        this.updateSidebarWidth();
        break;

      case 'tui.sidebar.location':
        {
          const newLocation = value as 'left' | 'right';
          if (newLocation !== this.sidebarLocation) {
            // Swap the sidebar position
            const container = this.window.getPaneContainer();
            container.swapSplitChildren('split-1');
            this.sidebarLocation = newLocation;
            this.scheduleRender();
            debugLog(`[TUIClient] Sidebar location changed to ${newLocation}`);
          }
        }
        break;

      case 'workbench.colorTheme':
        // Theme change - reload theme colors
        {
          const themeName = value as string;
          const newTheme = this.loadThemeColors(themeName);
          this.theme = newTheme;
          this.syntaxService.setTheme(themeName);
          this.notifySettingsChanged();
          this.scheduleRender();
          debugLog(`[TUIClient] Theme changed to ${themeName}`);
        }
        break;

      case 'tui.terminal.height':
        // Terminal height - handled on next terminal open
        this.scheduleRender();
        break;

      default:
        // Other settings don't need live updates
        break;
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

      // Set up dropdown callback for terminal tabs
      this.terminalPanel.setTabDropdownCallback((tabs, x, y) => {
        this.showTerminalTabSwitcher(tabs, x, y);
      });

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
   * Terminal panel aligns with editor area (excludes sidebar).
   */
  private layoutTerminalPanel(): void {
    const panelHeight = this.terminalPanelVisible ? this.terminalPanelHeight : 0;

    // Tell window about bottom panel height so it can shrink the pane container
    this.window.setBottomPanelHeight(panelHeight);

    if (!this.terminalPanel) return;

    const size = this.getTerminalSize();

    // Calculate sidebar offset - terminal should align with editor area
    let sidebarOffset = 0;
    if (this.sidebarPaneId !== null) {
      const sidebarWidth = this.configManager.getWithDefault('tui.sidebar.width', 24);
      sidebarOffset = sidebarWidth;
    }

    debugLog(`[TUIClient] Layout terminal panel: visible=${this.terminalPanelVisible}, size=${size.width}x${size.height}, panelHeight=${panelHeight}, sidebarOffset=${sidebarOffset}`);

    if (this.terminalPanelVisible) {
      // Position terminal panel at bottom, aligned with editor area
      const bounds = {
        x: sidebarOffset,
        y: size.height - panelHeight - 1, // -1 for status bar
        width: size.width - sidebarOffset,
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
   * Create a terminal in the specified pane (or focused pane).
   * Unlike the terminal panel, this creates a terminal as a tab in an editor pane.
   */
  private async createTerminalInPane(pane?: Pane): Promise<void> {
    const targetPane = pane ?? this.window.getFocusedPane();
    if (!targetPane) {
      this.window.showNotification('No pane available for terminal', 'warning');
      return;
    }

    // Only allow terminals in tab-mode panes (editor panes)
    if (targetPane.getMode() !== 'tabs') {
      this.window.showNotification('Cannot add terminal to sidebar pane', 'warning');
      return;
    }

    debugLog(`[TUIClient] Creating terminal in pane: ${targetPane.id}`);

    // Create terminal element via pane factory
    const terminalId = targetPane.addElement('TerminalSession', 'Terminal');
    const terminal = targetPane.getElement(terminalId) as TerminalSession | null;

    if (!terminal) {
      this.window.showNotification('Failed to create terminal', 'error');
      return;
    }

    // Get pane bounds for PTY size
    const bounds = targetPane.getContentBounds();

    // Create and attach PTY backend
    try {
      const pty = await createPtyBackend({
        cwd: this.workingDirectory,
        cols: Math.max(1, bounds.width - 1), // -1 for scrollbar
        rows: Math.max(1, bounds.height),
      });

      // Set up callbacks
      terminal.setCallbacks({
        onTitleChange: (title) => {
          terminal.setTitle(title);
          this.scheduleRender();
        },
        onExit: (code) => {
          debugLog(`[TUIClient] Terminal ${terminalId} exited with code ${code}`);
        },
      });

      // Attach PTY to session
      terminal.attachPty(pty);

      // Start the PTY
      await pty.start();

      // Track the PTY for cleanup
      this.paneTerminals.set(terminalId, pty);

      debugLog(`[TUIClient] Terminal created in pane: ${terminalId}`);

      // Focus the terminal
      targetPane.setActiveElement(terminalId);
      this.scheduleRender();
    } catch (error) {
      debugLog(`[TUIClient] Failed to create PTY: ${error}`);
      this.window.showNotification('Failed to start terminal', 'error');
      // Remove the terminal element since PTY failed
      targetPane.removeElement(terminalId);
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
  // AI Chat
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new AI chat in the focused pane.
   */
  private async createNewAIChat(pane?: Pane, options?: {
    sessionId?: string;
    cwd?: string;
    provider?: AIProvider;
  }): Promise<AITerminalChat | null> {
    const targetPane = pane ?? this.window.getFocusedPane();
    if (!targetPane) {
      this.window.showNotification('No pane available for AI chat', 'warning');
      return null;
    }

    // Only allow AI chats in tab-mode panes (editor panes)
    if (targetPane.getMode() !== 'tabs') {
      this.window.showNotification('Cannot add AI chat to sidebar pane', 'warning');
      return null;
    }

    // Get default provider from settings if not specified
    const provider = options?.provider ?? this.configManager.getWithDefault('ai.defaultProvider', 'claude-code') as AIProvider;

    debugLog(`[TUIClient] Creating AI chat in pane: ${targetPane.id}, provider: ${provider}`);

    // Get tab title based on provider
    const titleMap: Record<AIProvider, string> = {
      'claude-code': 'Claude',
      'codex': 'Codex',
      'gemini': 'Gemini',
      'custom': 'AI Chat',
    };
    const tabTitle = titleMap[provider] || 'AI Chat';

    // Create AI chat element via pane factory with optional state
    const state: AITerminalChatState = {
      provider,
      sessionId: options?.sessionId ?? null,
      cwd: options?.cwd ?? this.workingDirectory,
    };

    const chatId = targetPane.addElement('AgentChat', tabTitle, state);
    const chat = targetPane.getElement(chatId);

    if (!chat || !(chat instanceof AITerminalChat)) {
      this.window.showNotification('Failed to create AI chat', 'error');
      return null;
    }

    // Wire up notification callback to show OSC 99 messages in the notification system
    chat.setCallbacks({
      onNotification: (message) => {
        this.window.showNotification(message, 'info');
      },
    });

    // Track the AI chat for session persistence
    this.paneAIChats.set(chatId, chat);

    debugLog(`[TUIClient] AI chat created in pane: ${chatId}`);

    // Focus the AI chat
    targetPane.setActiveElement(chatId);
    this.scheduleRender();

    return chat;
  }

  /**
   * Toggle AI chat visibility / focus.
   * If no AI chat exists, creates one.
   * If AI chat exists but not focused, focuses it.
   * If AI chat is focused, switches to previous element.
   */
  private toggleAIChat(): void {
    const focusedPane = this.window.getFocusedPane();
    if (!focusedPane) return;

    // Look for an existing AI chat in the focused pane
    const elements = focusedPane.getElements();
    const aiChat = elements.find((el) => el.type === 'AgentChat');

    if (aiChat) {
      // AI chat exists - toggle focus
      const activeElement = focusedPane.getActiveElement();
      if (activeElement && activeElement.id === aiChat.id) {
        // Already focused, switch to previous (cycle tabs)
        focusedPane.prevTab();
      } else {
        // Not focused, focus it
        focusedPane.setActiveElement(aiChat.id);
      }
      this.scheduleRender();
    } else {
      // No AI chat, create one
      this.createNewAIChat(focusedPane).catch((err) => {
        debugLog(`[TUIClient] Failed to create AI chat: ${err}`);
      });
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
      jsonc: 'jsonc',
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
      sql: 'sql',
      pgsql: 'sql',
      psql: 'sql',
    };
    return languageMap[ext] ?? 'plaintext';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hot-Reload Handler
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle config file reload.
   * Applies new settings/keybindings and re-renders.
   */
  private handleConfigReload(type: 'settings' | 'keybindings' | 'theme'): void {
    this.log(`Config reloaded: ${type}`);

    if (type === 'settings') {
      // Apply terminal panel height from updated config
      this.terminalPanelHeight = this.configManager.getWithDefault('tui.terminal.height', 10);

      // Apply sidebar visibility from updated config
      const shouldBeVisible = this.configManager.getWithDefault('tui.sidebar.visible', true);
      if (shouldBeVisible !== this.sidebarVisible) {
        if (shouldBeVisible) {
          this.showSidebar();
        } else {
          this.hideSidebar();
        }
      } else if (this.sidebarVisible) {
        // Only apply width if sidebar is visible
        this.applySidebarWidth();
      }

      // Apply sidebar location from updated config
      const newLocation = this.configManager.getWithDefault('tui.sidebar.location', 'left') as 'left' | 'right';
      if (newLocation !== this.sidebarLocation) {
        const container = this.window.getPaneContainer();
        container.swapSplitChildren('split-1');
        this.sidebarLocation = newLocation;
        this.log(`Sidebar location updated to: ${newLocation}`);
      }

      // Apply theme from updated config
      const themeName = this.configManager.get('workbench.colorTheme') ?? 'catppuccin-frappe';
      const newTheme = this.loadThemeColors(themeName);

      // Check if theme actually changed
      const themeChanged = JSON.stringify(this.theme) !== JSON.stringify(newTheme);
      if (themeChanged) {
        this.theme = newTheme;

        // Update syntax highlighting theme
        this.syntaxService.setTheme(themeName);

        this.log(`Theme updated to: ${themeName}`);
      }

      // Notify all elements about settings changes
      this.notifySettingsChanged();
    }

    if (type === 'keybindings') {
      // Re-setup keybindings with new config
      this.setupKeybindings();
      this.log('Keybindings updated');
    }

    // Re-render to apply changes
    this.scheduleRender();
  }

  /**
   * Apply sidebar width from config.
   * Only applies if sidebar is currently visible.
   */
  private applySidebarWidth(): void {
    if (this.sidebarPaneId === null) return;
    if (!this.sidebarVisible) return; // Don't override hidden state

    const container = this.window.getPaneContainer();
    if (!container) return;

    const sidebarWidth = this.configManager.getWithDefault('tui.sidebar.width', 36);
    const totalWidth = this.window.getSize().width;
    const sidebarRatio = Math.min(0.3, sidebarWidth / totalWidth);

    // Ratios depend on sidebar location
    if (this.sidebarLocation === 'left') {
      container.adjustRatios('split-1', [sidebarRatio, 1 - sidebarRatio]);
    } else {
      container.adjustRatios('split-1', [1 - sidebarRatio, sidebarRatio]);
    }
    this.log(`Sidebar width updated to: ${sidebarWidth}`);
  }

  /**
   * Notify all elements about settings changes.
   * Elements can react to settings like tabSize, wordWrap, etc.
   */
  private notifySettingsChanged(): void {
    const container = this.window.getPaneContainer();
    if (!container) return;

    // Get all elements from all panes and notify them
    const allPanes = container.getPanes();
    for (const pane of allPanes) {
      for (const element of pane.getElements()) {
        if ('onSettingsChanged' in element && typeof element.onSettingsChanged === 'function') {
          try {
            element.onSettingsChanged();
          } catch (error) {
            this.log(`Error notifying element of settings change: ${error}`);
          }
        }
      }
    }
    this.log('Elements notified of settings changes');
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
   * Update status bar for SQL editor.
   */
  private updateStatusBarForSQLEditor(sqlEditor: SQLEditor, docEditor: DocumentEditor): void {
    // File name
    const filename = sqlEditor.getFilePath()
      ? sqlEditor.getFilePath()!.split('/').pop() || 'query.sql'
      : `Query ${(sqlEditor as any).queryId || ''}`;
    const dirtyIndicator = sqlEditor.getIsDirty() ? '● ' : '';
    this.window.setStatusItem('file', `${dirtyIndicator}${filename}`);

    // Language - always SQL
    this.window.setStatusItem('language', 'SQL');

    // Position (1-indexed for display)
    const cursor = docEditor.getCursor();
    this.window.setStatusItem('position', `Ln ${cursor.line + 1}, Col ${cursor.column + 1}`);

    // Selection info
    const selection = docEditor.getSelection();
    if (selection) {
      const lines = Math.abs(selection.end.line - selection.start.line) + 1;
      const chars = docEditor.getSelectedText()?.length || 0;
      this.window.setStatusItem('selection', `${lines} lines, ${chars} chars selected`);
    } else {
      this.window.setStatusItem('selection', '');
    }

    // LSP status
    const lspStatus = this.lspIntegration?.isEnabled() ? 'LSP: SQL' : '';
    this.window.setStatusItem('lsp', lspStatus);

    // Indent (default for SQL)
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
      sql: 'SQL',
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
   * Handle focus change to update status bar and sidebar panels.
   * @param element The newly focused element
   * @param updateSidebarPanels Only update sidebar panels when focusing in editor panes (tabs mode)
   */
  private handleFocusChange(element: BaseElement | null, updateSidebarPanels = false): void {
    if (element instanceof DocumentEditor) {
      this.updateStatusBarFile(element);

      // Update sidebar panels only when switching tabs in editor pane
      if (updateSidebarPanels) {
        const uri = this.findUriForEditor(element);
        if (uri) {
          this.updateOutlineForDocument(uri, element);
          this.loadTimelineForEditor(element);
        }
      }
    } else if (element instanceof SQLEditor) {
      // SQLEditor contains a DocumentEditor - update status bar with SQL info
      const docEditor = element.getDocumentEditor();
      this.updateStatusBarForSQLEditor(element, docEditor);
    } else if (element instanceof GitDiffBrowser) {
      // GitDiffBrowser - keep timeline visible, update outline for first file
      this.clearStatusBarFile();

      if (updateSidebarPanels) {
        // Keep timeline visible - don't clear it
        // The timeline shows relevant context for the diff being viewed

        // Update outline for first file in the diff (if available)
        this.updateOutlineForDiffBrowser(element);
      }
    } else {
      // Not a document editor - clear file-related status bar items
      this.clearStatusBarFile();

      // Clear sidebar panels only when switching to non-editor in editor pane
      if (updateSidebarPanels) {
        if (this.outlinePanel) {
          this.outlinePanel.clearSymbols();
        }
        if (this.gitTimelinePanel) {
          this.gitTimelinePanel.clearCommits();
        }
      }
    }
  }

  /**
   * Find the URI for a given editor by looking up in openDocuments.
   */
  private findUriForEditor(editor: DocumentEditor): string | null {
    for (const [uri, docInfo] of this.openDocuments) {
      if (docInfo.editorId === editor.id) {
        return uri;
      }
    }
    return null;
  }

  /**
   * Find the currently focused GitDiffBrowser, if any.
   */
  private findGitDiffBrowser(): GitDiffBrowser | null {
    const container = this.window.getPaneContainer();
    for (const pane of container.getPanes()) {
      for (const element of pane.getElements()) {
        if (element instanceof GitDiffBrowser) {
          return element;
        }
      }
    }
    return null;
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
   * Command labels and categories for the command palette.
   * Maps command IDs to { label, category } for clean display.
   */
  private static readonly COMMAND_INFO: Record<string, { label: string; category: string }> = {
    // File
    'file.save': { label: 'Save File', category: 'File' },
    'file.saveAs': { label: 'Save File As...', category: 'File' },
    'file.close': { label: 'Close File', category: 'File' },
    'file.open': { label: 'Open File...', category: 'File' },
    'file.new': { label: 'New File', category: 'File' },
    // Edit
    'edit.undo': { label: 'Undo', category: 'Edit' },
    'edit.redo': { label: 'Redo', category: 'Edit' },
    'edit.cut': { label: 'Cut', category: 'Edit' },
    'edit.copy': { label: 'Copy', category: 'Edit' },
    'edit.paste': { label: 'Paste', category: 'Edit' },
    'edit.selectAll': { label: 'Select All', category: 'Edit' },
    'edit.selectNextMatch': { label: 'Select Next Match', category: 'Edit' },
    'edit.selectAllOccurrences': { label: 'Select All Occurrences', category: 'Edit' },
    // Editor tabs
    'editor.nextTab': { label: 'Next Tab', category: 'Editor' },
    'editor.previousTab': { label: 'Previous Tab', category: 'Editor' },
    'editor.switchTab': { label: 'Switch Tab (Current Pane)', category: 'Editor' },
    'editor.switchTabAllPanes': { label: 'Switch Tab (All Panes)', category: 'Editor' },
    // Search
    'search.find': { label: 'Find', category: 'Search' },
    'search.replace': { label: 'Find and Replace', category: 'Search' },
    'search.findInFiles': { label: 'Find in Files', category: 'Search' },
    // Editor
    'editor.gotoLine': { label: 'Go to Line...', category: 'Editor' },
    'editor.gotoSymbol': { label: 'Go to Symbol in File...', category: 'Editor' },
    'editor.gotoWorkspaceSymbol': { label: 'Go to Symbol in Workspace...', category: 'Editor' },
    'editor.fold': { label: 'Fold Region', category: 'Editor' },
    'editor.unfold': { label: 'Unfold Region', category: 'Editor' },
    'editor.foldAll': { label: 'Fold All Regions', category: 'Editor' },
    'editor.unfoldAll': { label: 'Unfold All Regions', category: 'Editor' },
    'editor.selectLine': { label: 'Select Line', category: 'Editor' },
    'editor.duplicateLine': { label: 'Duplicate Line', category: 'Editor' },
    'editor.duplicateSelection': { label: 'Duplicate Selection', category: 'Editor' },
    'editor.addCursorAbove': { label: 'Add Cursor Above', category: 'Editor' },
    'editor.addCursorBelow': { label: 'Add Cursor Below', category: 'Editor' },
    'editor.clearCursors': { label: 'Clear Secondary Cursors', category: 'Editor' },
    // View
    'view.splitVertical': { label: 'Split Editor Right', category: 'View' },
    'view.splitHorizontal': { label: 'Split Editor Down', category: 'View' },
    'view.closePane': { label: 'Close Pane', category: 'View' },
    'workbench.toggleSidebar': { label: 'Toggle Sidebar', category: 'View' },
    'workbench.toggleTerminal': { label: 'Toggle Terminal Panel', category: 'Term' },
    'workbench.focusNextPane': { label: 'Focus Next Pane', category: 'View' },
    'workbench.focusPreviousPane': { label: 'Focus Previous Pane', category: 'View' },
    'workbench.quickOpen': { label: 'Quick Open File...', category: 'File' },
    'workbench.commandPalette': { label: 'Command Palette', category: 'View' },
    'workbench.openSettings': { label: 'Open Settings', category: 'Prefs' },
    'workbench.openKeybindings': { label: 'Open Keyboard Shortcuts', category: 'Prefs' },
    'workbench.quit': { label: 'Quit', category: 'App' },
    'workbench.restart': { label: 'Restart', category: 'App' },
    'workbench.restartAndRebuild': { label: 'Restart and Rebuild', category: 'App' },
    'workbench.migrateConfig': { label: 'Migrate Legacy Config (~/.ultra/new-tui)', category: 'App' },
    // Terminal
    'terminal.new': { label: 'New Terminal in Panel', category: 'Term' },
    'terminal.newInPane': { label: 'New Terminal in Pane', category: 'Term' },
    'terminal.close': { label: 'Close Terminal', category: 'Term' },
    'terminal.focus': { label: 'Focus Terminal', category: 'Term' },
    'terminal.nextTab': { label: 'Next Terminal Tab', category: 'Term' },
    'terminal.previousTab': { label: 'Previous Terminal Tab', category: 'Term' },
    // AI Chat
    'ai.newChat': { label: 'New AI Chat (Default)', category: 'AI' },
    'ai.newClaudeChat': { label: 'New Claude Chat', category: 'AI' },
    'ai.newCodexChat': { label: 'New Codex Chat', category: 'AI' },
    'ai.newGeminiChat': { label: 'New Gemini Chat', category: 'AI' },
    'ai.toggleChat': { label: 'Toggle AI Chat', category: 'AI' },
    // Git
    'git.commit': { label: 'Git: Commit...', category: 'Git' },
    'git.push': { label: 'Git: Push', category: 'Git' },
    'git.pull': { label: 'Git: Pull', category: 'Git' },
    'git.fetch': { label: 'Git: Fetch', category: 'Git' },
    'git.focusPanel': { label: 'Git: Focus Panel', category: 'Git' },
    // Git branches
    'git.createBranch': { label: 'Git: Create Branch...', category: 'Git' },
    'git.switchBranch': { label: 'Git: Switch Branch...', category: 'Git' },
    'git.deleteBranch': { label: 'Git: Delete Branch...', category: 'Git' },
    'git.renameBranch': { label: 'Git: Rename Branch...', category: 'Git' },
    // Git merge
    'git.merge': { label: 'Git: Merge Branch...', category: 'Git' },
    'git.abortMerge': { label: 'Git: Abort Merge', category: 'Git' },
    // Git stash
    'git.stash': { label: 'Git: Stash Changes...', category: 'Git' },
    'git.stashPop': { label: 'Git: Pop Stash', category: 'Git' },
    'git.stashApply': { label: 'Git: Apply Stash...', category: 'Git' },
    'git.stashDrop': { label: 'Git: Drop Stash...', category: 'Git' },
    // Git diff
    'git.viewChanges': { label: 'Git: View Changes (Unstaged)', category: 'Git' },
    'git.viewStagedChanges': { label: 'Git: View Staged Changes', category: 'Git' },
    'git.openFileDiff': { label: 'Git: View File Changes', category: 'Git' },
    // Git panel (context: gitPanelFocus)
    'gitPanel.stage': { label: 'Git Panel: Stage File', category: 'Git Panel' },
    'gitPanel.stageAll': { label: 'Git Panel: Stage All', category: 'Git Panel' },
    'gitPanel.unstage': { label: 'Git Panel: Unstage File', category: 'Git Panel' },
    'gitPanel.discard': { label: 'Git Panel: Discard Changes', category: 'Git Panel' },
    'gitPanel.openDiff': { label: 'Git Panel: Open Diff', category: 'Git Panel' },
    'gitPanel.openFile': { label: 'Git Panel: Open File', category: 'Git Panel' },
    'gitPanel.refresh': { label: 'Git Panel: Refresh', category: 'Git Panel' },
    'gitPanel.commit': { label: 'Git Panel: Commit', category: 'Git Panel' },
    'gitPanel.toggleSection': { label: 'Git Panel: Toggle Section', category: 'Git Panel' },
    'gitPanel.moveUp': { label: 'Git Panel: Move Up', category: 'Git Panel' },
    'gitPanel.moveDown': { label: 'Git Panel: Move Down', category: 'Git Panel' },
    // File tree (context: fileTreeFocus)
    'fileTree.moveUp': { label: 'File Tree: Move Up', category: 'File Tree' },
    'fileTree.moveDown': { label: 'File Tree: Move Down', category: 'File Tree' },
    'fileTree.expand': { label: 'File Tree: Expand', category: 'File Tree' },
    'fileTree.collapse': { label: 'File Tree: Collapse', category: 'File Tree' },
    'fileTree.open': { label: 'File Tree: Open', category: 'File Tree' },
    'fileTree.newFile': { label: 'File Tree: New File', category: 'File Tree' },
    'fileTree.newFolder': { label: 'File Tree: New Folder', category: 'File Tree' },
    'fileTree.rename': { label: 'File Tree: Rename', category: 'File Tree' },
    'fileTree.delete': { label: 'File Tree: Delete', category: 'File Tree' },
    'fileTree.goToFirst': { label: 'File Tree: Go to First', category: 'File Tree' },
    'fileTree.goToLast': { label: 'File Tree: Go to Last', category: 'File Tree' },
    'fileTree.pageUp': { label: 'File Tree: Page Up', category: 'File Tree' },
    'fileTree.pageDown': { label: 'File Tree: Page Down', category: 'File Tree' },
    // Outline panel (context: outlinePanelFocus)
    'outlinePanel.moveUp': { label: 'Outline: Move Up', category: 'Outline' },
    'outlinePanel.moveDown': { label: 'Outline: Move Down', category: 'Outline' },
    'outlinePanel.expand': { label: 'Outline: Expand', category: 'Outline' },
    'outlinePanel.collapse': { label: 'Outline: Collapse', category: 'Outline' },
    'outlinePanel.toggleExpand': { label: 'Outline: Toggle Expand', category: 'Outline' },
    'outlinePanel.select': { label: 'Outline: Go to Symbol', category: 'Outline' },
    'outlinePanel.pageUp': { label: 'Outline: Page Up', category: 'Outline' },
    'outlinePanel.pageDown': { label: 'Outline: Page Down', category: 'Outline' },
    'outlinePanel.goToFirst': { label: 'Outline: Go to First', category: 'Outline' },
    'outlinePanel.goToLast': { label: 'Outline: Go to Last', category: 'Outline' },
    // Timeline panel (context: timelinePanelFocus)
    'timelinePanel.moveUp': { label: 'Timeline: Move Up', category: 'Timeline' },
    'timelinePanel.moveDown': { label: 'Timeline: Move Down', category: 'Timeline' },
    'timelinePanel.pageUp': { label: 'Timeline: Page Up', category: 'Timeline' },
    'timelinePanel.pageDown': { label: 'Timeline: Page Down', category: 'Timeline' },
    'timelinePanel.goToFirst': { label: 'Timeline: Go to First', category: 'Timeline' },
    'timelinePanel.goToLast': { label: 'Timeline: Go to Last', category: 'Timeline' },
    'timelinePanel.viewDiff': { label: 'Timeline: View Diff', category: 'Timeline' },
    'timelinePanel.openFileAtCommit': { label: 'Timeline: Open File at Commit', category: 'Timeline' },
    'timelinePanel.toggleMode': { label: 'Timeline: Toggle Mode', category: 'Timeline' },
    'timelinePanel.copyHash': { label: 'Timeline: Copy Commit Hash', category: 'Timeline' },
    // Session
    'session.save': { label: 'Save Session', category: 'Session' },
    'session.saveAs': { label: 'Save Session As...', category: 'Session' },
    'session.open': { label: 'Open Session...', category: 'Session' },
  };

  /**
   * Format a keybinding for display.
   * Converts "ctrl+shift+p" to "^⇧P"
   */
  private formatKeybinding(key: string): string {
    return key
      .replace(/ctrl\+/gi, '^')
      .replace(/shift\+/gi, '⇧')
      .replace(/alt\+/gi, '⌥')
      .replace(/meta\+/gi, '⌘')
      .replace(/\+/g, '')
      .toUpperCase();
  }

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

      // Get clean label and category from map, or generate from command ID
      const info = TUIClient.COMMAND_INFO[commandId];
      let label: string;
      let category: string;

      if (info) {
        label = info.label;
        category = info.category;
      } else {
        // Fallback: convert command ID to readable label
        const parts = commandId.split('.');
        category = parts[0]?.charAt(0).toUpperCase() + (parts[0]?.slice(1) ?? '');
        const nameParts = parts.slice(1);
        label = nameParts
          .join(' ')
          .replace(/([A-Z])/g, ' $1')
          .trim();
        label = label.charAt(0).toUpperCase() + label.slice(1);
      }

      // Format keybinding for display, combine with category
      const formattedKey = keybinding ? this.formatKeybinding(keybinding.key) : '';
      const secondary = formattedKey ? `${formattedKey}  ${category}` : category;

      commands.push({
        id: commandId,
        label,
        keybinding: secondary,
      });
    }

    // Sort commands alphabetically by label
    commands.sort((a, b) => a.label.localeCompare(b.label));

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
      const maxFiles = this.configManager.get('tui.filePicker.maxFiles') ?? 10000;
      const fileUris = await this.fileService.glob('**/*', {
        baseUri,
        maxResults: maxFiles,
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
   * Show symbol picker for go-to-symbol in the current file.
   */
  private async showSymbolPicker(): Promise<void> {
    if (!this.dialogManager) return;

    const focusedElement = this.window.getFocusedElement();
    if (!(focusedElement instanceof DocumentEditor)) {
      this.window.showNotification('No active editor', 'warning');
      return;
    }

    const uri = focusedElement.getUri();
    if (!uri) {
      this.window.showNotification('No file open', 'warning');
      return;
    }

    try {
      // Get document symbols from LSP
      const lspSymbols = await localLSPService.getDocumentSymbols(uri);

      if (!lspSymbols || lspSymbols.length === 0) {
        this.window.showNotification('No symbols found', 'info');
        return;
      }

      // Flatten symbols into SymbolEntry array
      const flattenSymbols = (
        symbols: typeof lspSymbols,
        containerName?: string
      ): import('../overlays/symbol-picker.ts').SymbolEntry[] => {
        const result: import('../overlays/symbol-picker.ts').SymbolEntry[] = [];

        for (const sym of symbols) {
          // Handle both DocumentSymbol and SymbolInformation formats
          const name = sym.name;
          const kind = sym.kind;
          const detail = 'detail' in sym ? sym.detail : undefined;
          const container = 'containerName' in sym ? sym.containerName : containerName;

          // Get position - DocumentSymbol has selectionRange, SymbolInformation has location
          let line = 0;
          let column = 0;
          if ('selectionRange' in sym) {
            line = sym.selectionRange.start.line;
            column = sym.selectionRange.start.character;
          } else if ('location' in sym) {
            line = (sym.location as { range: { start: { line: number; character: number } } }).range.start.line;
            column = (sym.location as { range: { start: { line: number; character: number } } }).range.start.character;
          }

          result.push({
            name,
            kind,
            detail,
            containerName: container,
            uri,
            line,
            column,
          });

          // Recurse into children (DocumentSymbol only)
          if ('children' in sym && sym.children) {
            result.push(...flattenSymbols(sym.children, name));
          }
        }

        return result;
      };

      const symbolEntries = flattenSymbols(lspSymbols);

      const result = await this.dialogManager.showSymbolPicker({
        symbols: symbolEntries,
        currentUri: uri,
        placeholder: 'Search symbols in file...',
      });

      if (result.confirmed && result.value) {
        // Navigate to the symbol
        focusedElement.setCursorPosition(
          { line: result.value.line, column: result.value.column },
          false
        );
        focusedElement.scrollToLine(result.value.line);
        this.scheduleRender();
      }
    } catch (error) {
      this.log(`Failed to get symbols: ${error}`);
      this.window.showNotification('Failed to get symbols', 'error');
    }
  }

  /**
   * Show workspace symbol picker for go-to-symbol across all files.
   */
  private async showWorkspaceSymbolPicker(): Promise<void> {
    if (!this.dialogManager) return;

    try {
      // Get workspace symbols with an empty query first to show all
      // The LSP will return symbols matching the query as user types
      const lspSymbols = await localLSPService.getWorkspaceSymbols('');

      if (!lspSymbols || lspSymbols.length === 0) {
        this.window.showNotification('No symbols found in workspace', 'info');
        return;
      }

      // Convert to SymbolEntry array
      const symbolEntries: import('../overlays/symbol-picker.ts').SymbolEntry[] = lspSymbols.map((sym) => {
        // SymbolInformation has location property
        const location = sym.location as { uri: string; range: { start: { line: number; character: number } } };

        return {
          name: sym.name,
          kind: sym.kind,
          containerName: sym.containerName,
          uri: location.uri,
          line: location.range.start.line,
          column: location.range.start.character,
        };
      });

      const result = await this.dialogManager.showSymbolPicker({
        title: 'Go to Symbol in Workspace',
        symbols: symbolEntries,
        placeholder: 'Search symbols in workspace...',
        showFilePaths: true,
        workspaceRoot: this.workingDirectory,
      });

      if (result.confirmed && result.value) {
        // Open the file and navigate to the symbol
        const uri = result.value.uri;
        await this.openFile(uri);

        // After opening, navigate to the symbol position
        const focusedElement = this.window.getFocusedElement();
        if (focusedElement instanceof DocumentEditor) {
          focusedElement.setCursorPosition(
            { line: result.value.line, column: result.value.column },
            false
          );
          focusedElement.scrollToLine(result.value.line);
          this.scheduleRender();
        }
      }
    } catch (error) {
      this.log(`Failed to get workspace symbols: ${error}`);
      this.window.showNotification('Failed to get workspace symbols', 'error');
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

  // ─────────────────────────────────────────────────────────────────────────
  // Tab Switcher
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show tab switcher for a specific pane.
   */
  private async showTabSwitcher(paneId: string, tabs: Array<{ id: string; title: string; isActive: boolean }>): Promise<void> {
    if (!this.tabSwitcherDialog) return;

    const pane = this.window.getPaneContainer().getPane(paneId);
    if (!pane) return;

    // Convert to TabInfo format
    const tabInfos: TabInfo[] = tabs.map((tab) => {
      const element = pane.getElement(tab.id);
      const filePath = element instanceof DocumentEditor ? element.getUri() ?? undefined : undefined;
      const isModified = element instanceof DocumentEditor && element.isModified();

      return {
        id: tab.id,
        title: tab.title,
        paneId,
        isActive: tab.isActive,
        isModified,
        filePath,
      };
    });

    // Find current tab for highlight
    const currentTab = tabInfos.find((t) => t.isActive);

    const result = await this.tabSwitcherDialog.showWithItems(
      {
        title: 'Switch Tab',
        placeholder: 'Type to filter tabs...',
        showSearchInput: true,
        maxResults: 15,
      },
      tabInfos,
      currentTab?.id
    );

    if (result.confirmed && result.value) {
      pane.setActiveElement(result.value.id);
      this.scheduleRender();
    }
  }

  /**
   * Show tab switcher for current pane via command palette.
   */
  private async showTabSwitcherForCurrentPane(): Promise<void> {
    const focusedPane = this.window.getFocusedPane();
    if (!focusedPane) return;

    const tabs = focusedPane.getTabsForDropdown();
    await this.showTabSwitcher(focusedPane.id, tabs);
  }

  /**
   * Show tab switcher for all panes via command palette.
   */
  private async showTabSwitcherForAllPanes(): Promise<void> {
    if (!this.tabSwitcherDialog) return;

    const paneContainer = this.window.getPaneContainer();
    const allTabs: TabInfo[] = [];
    const focusedPane = this.window.getFocusedPane();
    const focusedPaneId = focusedPane?.id ?? null;

    // Collect tabs from all panes
    for (const paneId of paneContainer.getPaneIds()) {
      const pane = paneContainer.getPane(paneId);
      if (!pane || pane.getMode() !== 'tabs') continue;

      const elements = pane.getElements();
      const activeIdx = pane.getActiveElementIndex();

      elements.forEach((element, idx) => {
        const filePath = element instanceof DocumentEditor ? element.getUri() ?? undefined : undefined;
        const isModified = element instanceof DocumentEditor && element.isModified();

        allTabs.push({
          id: element.id,
          title: element.getTitle(),
          paneId,
          isActive: paneId === focusedPaneId && idx === activeIdx,
          isModified,
          filePath,
        });
      });
    }

    if (allTabs.length === 0) {
      this.window.showNotification('No open tabs', 'info');
      return;
    }

    // Find current tab for highlight
    const currentTab = allTabs.find((t) => t.isActive);

    const result = await this.tabSwitcherDialog.showWithItems(
      {
        title: 'Switch Tab (All Panes)',
        placeholder: 'Type to filter tabs...',
        showSearchInput: true,
        maxResults: 15,
      },
      allTabs,
      currentTab?.id
    );

    if (result.confirmed && result.value) {
      const pane = paneContainer.getPane(result.value.paneId);
      if (pane) {
        pane.setActiveElement(result.value.id);
        // Focus the pane
        this.window.getFocusManager().focusPane(result.value.paneId);
        this.scheduleRender();
      }
    }
  }

  /**
   * Show tab switcher for terminal panel tabs.
   */
  private async showTerminalTabSwitcher(
    tabs: TerminalTabDropdownInfo[],
    _x: number,
    _y: number
  ): Promise<void> {
    if (!this.tabSwitcherDialog || !this.terminalPanel) return;

    // Convert to TabInfo format
    const tabInfos: TabInfo[] = tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      paneId: 'terminal-panel',
      isActive: tab.isActive,
      isModified: false,
      filePath: undefined,
    }));

    // Find current tab for highlight
    const currentTab = tabInfos.find((t) => t.isActive);

    const result = await this.tabSwitcherDialog.showWithItems(
      {
        title: 'Switch Terminal',
        placeholder: 'Type to filter terminals...',
        showSearchInput: true,
        maxResults: 15,
      },
      tabInfos,
      currentTab?.id
    );

    if (result.confirmed && result.value) {
      this.terminalPanel.setActiveTerminal(result.value.id);
      this.scheduleRender();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Settings Palette
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the settings palette for inline editing of settings.
   */
  private async showSettingsPalette(): Promise<void> {
    if (!this.dialogManager) return;

    // Build settings items from the known schema (defaultSettings),
    // getting current values from config manager (which includes user overrides)
    const settingItems: SettingItem[] = [];

    for (const [key, defaultValue] of Object.entries(defaultSettings)) {
      // Get current value from config manager (user setting or default)
      // Cast key since Object.entries returns string keys
      const typedKey = key as keyof TUISettings;
      const currentValue = this.configManager.get(typedKey) ?? defaultValue;
      const item = buildSettingItem(key, currentValue, defaultValue);
      settingItems.push(item);
    }

    // Sort by key for consistent ordering
    settingItems.sort((a, b) => a.key.localeCompare(b.key));

    await this.dialogManager.showSettings({
      settings: settingItems,
      title: 'Settings',
      placeholder: 'Search settings...',
      width: 80,
      height: 25,
      callbacks: {
        onValueChange: async (key: string, value: unknown) => {
          // Update the setting in config manager
          this.configManager.set(key as keyof TUISettings, value as never);
          // Save to file
          await this.configManager.saveSettings();
          debugLog(`[TUIClient] Setting changed: ${key} = ${JSON.stringify(value)}`);
          // Handle live updates for certain settings
          this.handleSettingChange(key, value);
        },
        onReset: async (key: string, defaultValue: unknown) => {
          // Reset to default in config manager
          this.configManager.set(key as keyof TUISettings, defaultValue as never);
          // Save to file
          await this.configManager.saveSettings();
          debugLog(`[TUIClient] Setting reset: ${key} = ${JSON.stringify(defaultValue)}`);
          // Handle live updates for certain settings
          this.handleSettingChange(key, defaultValue);
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keybindings Palette
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the keybindings palette for editing keybindings.
   */
  private async showKeybindingsPalette(): Promise<void> {
    if (!this.dialogManager) return;

    // Build keybinding items from current keybindings
    const keybindings = this.configManager.getKeybindings();
    const keybindingItems: KeybindingItem[] = [];
    const commandsWithBindings = new Set<string>();

    for (const binding of keybindings) {
      commandsWithBindings.add(binding.command);

      // Find the default keybinding for this command
      const defaultBinding = defaultKeybindings.find((b) => b.command === binding.command);
      const defaultKey = defaultBinding?.key ?? binding.key;

      // Get command info for label and category
      const info = TUIClient.COMMAND_INFO[binding.command];

      keybindingItems.push({
        command: binding.command,
        label: info?.label ?? binding.command,
        key: binding.key,
        defaultKey,
        when: binding.when,
        category: info?.category ?? 'Other',
        isModified: binding.key !== defaultKey,
      });
    }

    // Add commands from COMMAND_INFO that don't have keybindings yet
    for (const [command, info] of Object.entries(TUIClient.COMMAND_INFO)) {
      if (!commandsWithBindings.has(command)) {
        keybindingItems.push({
          command,
          label: info.label,
          key: '', // No keybinding
          defaultKey: '', // No default
          when: undefined,
          category: info.category,
          isModified: false,
        });
      }
    }

    // Sort by label for consistent ordering
    keybindingItems.sort((a, b) => a.label.localeCompare(b.label));

    await this.dialogManager.showKeybindings({
      keybindings: keybindingItems,
      title: 'Keyboard Shortcuts',
      placeholder: 'Search keybindings...',
      width: 80,
      height: 25,
      callbacks: {
        onKeybindingChange: async (command: string, newKey: string) => {
          // Find and update the keybinding, or add a new one
          const bindings = this.configManager.getKeybindings();
          const binding = bindings.find((b) => b.command === command);
          if (binding) {
            binding.key = newKey;
          } else {
            // Add new keybinding for previously unbound command
            bindings.push({ key: newKey, command });
          }
          // Save to file
          await this.configManager.saveKeybindings();
          debugLog(`[TUIClient] Keybinding changed: ${command} = ${newKey}`);
        },
        onReset: async (command: string, defaultKey: string) => {
          // Find and reset the keybinding
          const bindings = this.configManager.getKeybindings();
          const binding = bindings.find((b) => b.command === command);
          if (binding) {
            if (defaultKey) {
              binding.key = defaultKey;
            } else {
              // Remove the binding if there's no default
              const index = bindings.indexOf(binding);
              bindings.splice(index, 1);
            }
          }
          // Save to file
          await this.configManager.saveKeybindings();
          debugLog(`[TUIClient] Keybinding reset: ${command} = ${defaultKey || '(removed)'}`);
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Search/Replace
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show search dialog.
   */
  private showSearchDialog(withReplace: boolean = false): void {
    if (!this.searchReplaceDialog) return;

    const focusedElement = this.window.getFocusedElement();
    if (!(focusedElement instanceof DocumentEditor)) {
      this.window.showNotification('No active editor', 'warning');
      return;
    }

    // Get the editor's bounds to position dialog at top-right of editor pane
    const editorBounds = focusedElement.getBounds();
    const dialogWidth = Math.min(56, editorBounds.width - 6);
    const dialogHeight = withReplace ? 7 : 5;

    // Position at top-right of editor pane with margin for scrollbar/minimap
    const dialogX = editorBounds.x + editorBounds.width - dialogWidth - 9;
    const dialogY = editorBounds.y;

    this.searchReplaceDialog.setReplaceMode(withReplace);
    this.searchReplaceDialog.setBounds({
      x: dialogX,
      y: dialogY,
      width: dialogWidth,
      height: dialogHeight,
    });
    this.searchReplaceDialog.show(withReplace);
    this.scheduleRender();
  }

  /**
   * Handle search query change.
   */
  private handleSearch(query: string, options: SearchOptions): void {
    const focusedElement = this.window.getFocusedElement();
    if (!(focusedElement instanceof DocumentEditor)) return;

    const result = focusedElement.search(query, {
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      useRegex: options.useRegex,
    });

    // Update dialog with match info
    this.searchReplaceDialog?.setMatches(
      result.matches.map((m) => ({
        line: m.line,
        column: m.column,
        length: m.length,
        text: '',
      })),
      result.currentIndex
    );

    this.scheduleRender();
  }

  /**
   * Handle find next.
   */
  private handleFindNext(): void {
    const focusedElement = this.window.getFocusedElement();
    if (!(focusedElement instanceof DocumentEditor)) return;

    const result = focusedElement.findNext();

    this.searchReplaceDialog?.setMatches(
      result.matches.map((m) => ({
        line: m.line,
        column: m.column,
        length: m.length,
        text: '',
      })),
      result.currentIndex
    );

    this.scheduleRender();
  }

  /**
   * Handle find previous.
   */
  private handleFindPrevious(): void {
    const focusedElement = this.window.getFocusedElement();
    if (!(focusedElement instanceof DocumentEditor)) return;

    const result = focusedElement.findPrevious();

    this.searchReplaceDialog?.setMatches(
      result.matches.map((m) => ({
        line: m.line,
        column: m.column,
        length: m.length,
        text: '',
      })),
      result.currentIndex
    );

    this.scheduleRender();
  }

  /**
   * Handle replace current match.
   */
  private handleReplace(replacement: string): void {
    const focusedElement = this.window.getFocusedElement();
    if (!(focusedElement instanceof DocumentEditor)) return;

    const result = focusedElement.replaceCurrent(replacement);

    this.searchReplaceDialog?.setMatches(
      result.matches.map((m) => ({
        line: m.line,
        column: m.column,
        length: m.length,
        text: '',
      })),
      result.currentIndex
    );

    this.scheduleRender();
  }

  /**
   * Handle replace all matches.
   */
  private handleReplaceAll(replacement: string): void {
    const focusedElement = this.window.getFocusedElement();
    if (!(focusedElement instanceof DocumentEditor)) return;

    const state = focusedElement.getSearchState();
    const count = state.matches.length;

    focusedElement.replaceAll(replacement);
    this.searchReplaceDialog?.setMatches([], -1);

    this.window.showNotification(`Replaced ${count} occurrence${count !== 1 ? 's' : ''}`, 'info');
    this.scheduleRender();
  }

  /**
   * Handle search dialog dismiss.
   */
  private handleSearchDismiss(): void {
    const focusedElement = this.window.getFocusedElement();
    if (focusedElement instanceof DocumentEditor) {
      focusedElement.clearSearch();
    }
    this.scheduleRender();
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
   * Pull changes from remote.
   */
  private async gitPull(): Promise<void> {
    this.window.showNotification('Pulling...', 'info');

    try {
      const result = await gitCliService.pull(this.workingDirectory);
      if (result.success) {
        this.window.showNotification('Pulled successfully', 'success');
      } else {
        this.window.showNotification(`Pull failed: ${result.error}`, 'error');
      }
      await this.refreshGitStatus();
    } catch (error) {
      this.window.showNotification(`Pull failed: ${error}`, 'error');
    }
  }

  /**
   * Fetch from remote.
   */
  private async gitFetch(): Promise<void> {
    this.window.showNotification('Fetching...', 'info');

    try {
      await gitCliService.fetch(this.workingDirectory);
      this.window.showNotification('Fetched successfully', 'success');
      await this.refreshGitStatus();
    } catch (error) {
      this.window.showNotification(`Fetch failed: ${error}`, 'error');
    }
  }

  /**
   * Create a new branch.
   */
  private async gitCreateBranch(): Promise<void> {
    if (!this.dialogManager) return;

    const result = await this.dialogManager.showInput({
      title: 'Create Branch',
      prompt: 'Enter the new branch name:',
      placeholder: 'feature/my-branch',
    });

    if (result.confirmed && result.value) {
      try {
        await gitCliService.createBranch(this.workingDirectory, result.value, true);
        this.window.showNotification(`Created and switched to branch: ${result.value}`, 'success');
        await this.refreshGitStatus();
      } catch (error) {
        this.window.showNotification(`Failed to create branch: ${error}`, 'error');
      }
    }
  }

  /**
   * Switch to an existing branch.
   */
  private async gitSwitchBranch(): Promise<void> {
    if (!this.dialogManager) return;

    try {
      const { branches, current } = await gitCliService.branches(this.workingDirectory);

      if (branches.length === 0) {
        this.window.showNotification('No branches found', 'info');
        return;
      }

      // Build file entries for picker (reusing file picker dialog)
      const branchEntries = branches
        .filter(b => b.name !== current) // Exclude current branch
        .map((b) => ({
          path: b.name,
          name: b.name,
          directory: b.tracking ? 'Tracking' : 'Local',
          extension: b.current ? '(current)' : undefined,
        }));

      if (branchEntries.length === 0) {
        this.window.showNotification('No other branches to switch to', 'info');
        return;
      }

      const result = await this.dialogManager.showFilePicker({
        files: branchEntries,
        placeholder: 'Search branches...',
        title: 'Switch Branch',
      });

      if (result.confirmed && result.value) {
        await gitCliService.switchBranch(this.workingDirectory, result.value.path);
        this.window.showNotification(`Switched to branch: ${result.value.path}`, 'success');
        await this.refreshGitStatus();
      }
    } catch (error) {
      this.window.showNotification(`Failed to switch branch: ${error}`, 'error');
    }
  }

  /**
   * Delete a branch.
   */
  private async gitDeleteBranch(): Promise<void> {
    if (!this.dialogManager) return;

    try {
      const { branches, current } = await gitCliService.branches(this.workingDirectory);

      // Filter to local branches that aren't current
      const deletableBranches = branches.filter(b => !b.tracking && b.name !== current);

      if (deletableBranches.length === 0) {
        this.window.showNotification('No branches available to delete', 'info');
        return;
      }

      const branchEntries = deletableBranches.map((b) => ({
        path: b.name,
        name: b.name,
        directory: 'Local',
        extension: undefined,
      }));

      const pickResult = await this.dialogManager.showFilePicker({
        files: branchEntries,
        placeholder: 'Search branches to delete...',
        title: 'Delete Branch',
      });

      if (pickResult.confirmed && pickResult.value) {
        const branchName = pickResult.value.path;
        const confirmResult = await this.dialogManager.showConfirm({
          title: 'Delete Branch',
          message: `Are you sure you want to delete branch "${branchName}"?`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          destructive: true,
        });

        if (confirmResult.confirmed) {
          try {
            await gitCliService.deleteBranch(this.workingDirectory, branchName);
            this.window.showNotification(`Deleted branch: ${branchName}`, 'success');
            await this.refreshGitStatus();
          } catch {
            // Try force delete if regular delete fails
            const forceResult = await this.dialogManager.showConfirm({
              title: 'Force Delete?',
              message: `Branch "${branchName}" is not fully merged. Force delete?`,
              confirmText: 'Force Delete',
              cancelText: 'Cancel',
              destructive: true,
            });

            if (forceResult.confirmed) {
              await gitCliService.deleteBranch(this.workingDirectory, branchName, true);
              this.window.showNotification(`Force deleted branch: ${branchName}`, 'success');
              await this.refreshGitStatus();
            }
          }
        }
      }
    } catch (error) {
      this.window.showNotification(`Failed to delete branch: ${error}`, 'error');
    }
  }

  /**
   * Rename the current branch.
   */
  private async gitRenameBranch(): Promise<void> {
    if (!this.dialogManager) return;

    try {
      const { current } = await gitCliService.branches(this.workingDirectory);

      const result = await this.dialogManager.showInput({
        title: 'Rename Branch',
        prompt: `Rename branch "${current}" to:`,
        placeholder: 'new-branch-name',
        initialValue: current,
      });

      if (result.confirmed && result.value && result.value !== current) {
        await gitCliService.renameBranch(this.workingDirectory, result.value);
        this.window.showNotification(`Renamed branch to: ${result.value}`, 'success');
        await this.refreshGitStatus();
      }
    } catch (error) {
      this.window.showNotification(`Failed to rename branch: ${error}`, 'error');
    }
  }

  /**
   * Merge a branch into current.
   */
  private async gitMerge(): Promise<void> {
    if (!this.dialogManager) return;

    try {
      const { branches, current } = await gitCliService.branches(this.workingDirectory);

      // Filter out current branch
      const mergeableBranches = branches.filter(b => b.name !== current);

      if (mergeableBranches.length === 0) {
        this.window.showNotification('No branches available to merge', 'info');
        return;
      }

      const branchEntries = mergeableBranches.map((b) => ({
        path: b.name,
        name: b.name,
        directory: b.tracking ? 'Tracking' : 'Local',
        extension: undefined,
      }));

      const pickResult = await this.dialogManager.showFilePicker({
        files: branchEntries,
        placeholder: 'Search branches to merge...',
        title: `Merge into ${current}`,
      });

      if (pickResult.confirmed && pickResult.value) {
        const branchName = pickResult.value.path;
        this.window.showNotification(`Merging ${branchName}...`, 'info');

        const mergeResult = await gitCliService.merge(this.workingDirectory, branchName);
        if (mergeResult.success) {
          this.window.showNotification(`Merged ${branchName} successfully`, 'success');
        } else if (mergeResult.conflicts && mergeResult.conflicts.length > 0) {
          this.window.showNotification(
            `Merge conflicts in ${mergeResult.conflicts.length} file(s)`,
            'warning'
          );
        } else {
          this.window.showNotification(`Merge failed: ${mergeResult.message}`, 'error');
        }
        await this.refreshGitStatus();
      }
    } catch (error) {
      this.window.showNotification(`Failed to merge: ${error}`, 'error');
    }
  }

  /**
   * Abort an in-progress merge.
   */
  private async gitAbortMerge(): Promise<void> {
    try {
      const isMerging = await gitCliService.isMerging(this.workingDirectory);
      if (!isMerging) {
        this.window.showNotification('No merge in progress', 'info');
        return;
      }

      await gitCliService.abortMerge(this.workingDirectory);
      this.window.showNotification('Merge aborted', 'success');
      await this.refreshGitStatus();
    } catch (error) {
      this.window.showNotification(`Failed to abort merge: ${error}`, 'error');
    }
  }

  /**
   * Stash current changes.
   */
  private async gitStash(): Promise<void> {
    if (!this.dialogManager) return;

    const result = await this.dialogManager.showInput({
      title: 'Stash Changes',
      prompt: 'Enter a message for this stash (optional):',
      placeholder: 'WIP: my changes',
    });

    if (result.confirmed) {
      try {
        const stashId = await gitCliService.stash(this.workingDirectory, result.value || undefined);
        this.window.showNotification(`Changes stashed: ${stashId}`, 'success');
        await this.refreshGitStatus();
      } catch (error) {
        this.window.showNotification(`Failed to stash: ${error}`, 'error');
      }
    }
  }

  /**
   * Pop the latest stash.
   */
  private async gitStashPop(): Promise<void> {
    try {
      await gitCliService.stashPop(this.workingDirectory);
      this.window.showNotification('Stash popped successfully', 'success');
      await this.refreshGitStatus();
    } catch (error) {
      this.window.showNotification(`Failed to pop stash: ${error}`, 'error');
    }
  }

  /**
   * Apply a stash without removing it.
   */
  private async gitStashApply(): Promise<void> {
    if (!this.dialogManager) return;

    try {
      const stashes = await gitCliService.stashList(this.workingDirectory);

      if (stashes.length === 0) {
        this.window.showNotification('No stashes found', 'info');
        return;
      }

      const stashEntries = stashes.map((s) => ({
        path: s.id,
        name: s.message || `(stash@{${s.index}})`,
        directory: s.branch || 'unknown',
        extension: undefined,
      }));

      const pickResult = await this.dialogManager.showFilePicker({
        files: stashEntries,
        placeholder: 'Search stashes...',
        title: 'Apply Stash',
      });

      if (pickResult.confirmed && pickResult.value) {
        await gitCliService.stashApply(this.workingDirectory, pickResult.value.path);
        this.window.showNotification('Stash applied successfully', 'success');
        await this.refreshGitStatus();
      }
    } catch (error) {
      this.window.showNotification(`Failed to apply stash: ${error}`, 'error');
    }
  }

  /**
   * Drop a stash.
   */
  private async gitStashDrop(): Promise<void> {
    if (!this.dialogManager) return;

    try {
      const stashes = await gitCliService.stashList(this.workingDirectory);

      if (stashes.length === 0) {
        this.window.showNotification('No stashes found', 'info');
        return;
      }

      const stashEntries = stashes.map((s) => ({
        path: s.id,
        name: s.message || `(stash@{${s.index}})`,
        directory: s.branch || 'unknown',
        extension: undefined,
      }));

      const pickResult = await this.dialogManager.showFilePicker({
        files: stashEntries,
        placeholder: 'Search stashes to drop...',
        title: 'Drop Stash',
      });

      if (pickResult.confirmed && pickResult.value) {
        const stashId = pickResult.value.path;
        const confirmResult = await this.dialogManager.showConfirm({
          title: 'Drop Stash',
          message: `Are you sure you want to drop "${stashId}"?`,
          confirmText: 'Drop',
          cancelText: 'Cancel',
          destructive: true,
        });

        if (confirmResult.confirmed) {
          await gitCliService.stashDrop(this.workingDirectory, stashId);
          this.window.showNotification('Stash dropped successfully', 'success');
          await this.refreshGitStatus();
        }
      }
    } catch (error) {
      this.window.showNotification(`Failed to drop stash: ${error}`, 'error');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Clipboard Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Copy selected text to system clipboard (macOS).
   */
  private async copyToSystemClipboard(text: string): Promise<void> {
    try {
      const proc = Bun.spawn(['pbcopy'], {
        stdin: 'pipe',
      });
      proc.stdin.write(text);
      proc.stdin.end();
      const exitCode = await proc.exited;
      this.log(`copyToSystemClipboard: pbcopy exited with code ${exitCode}`);
    } catch (err) {
      this.log(`copyToSystemClipboard failed: ${err}`);
    }
  }

  /**
   * Paste text from system clipboard (macOS).
   */
  private async pasteFromSystemClipboard(): Promise<string | null> {
    try {
      const proc = Bun.spawn(['pbpaste'], {
        stdout: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      this.log(`pasteFromSystemClipboard: pbpaste exited with code ${exitCode}, got ${output.length} chars`);
      return output;
    } catch (err) {
      this.log(`pasteFromSystemClipboard failed: ${err}`);
      return null;
    }
  }

  /**
   * Cut selected text to clipboard.
   */
  private async editCut(): Promise<void> {
    const element = this.window.getFocusedElement();
    this.log(`editCut called, focused element: ${element?.constructor.name}`);

    let text: string | undefined;

    if (element instanceof DocumentEditor) {
      text = element.getSelectedText();
      if (text) {
        this.clipboard = text;
        await this.copyToSystemClipboard(text);
        element.deleteBackward();
      }
    } else if (element instanceof SQLEditor) {
      text = element.getSelectedText();
      if (text) {
        this.clipboard = text;
        await this.copyToSystemClipboard(text);
        element.deleteBackward();
      }
    }
    // Note: Cut doesn't apply to terminals

    if (text) {
      this.log(`editCut: cut ${text.length} chars`);
      this.scheduleRender();
    }
  }

  /**
   * Copy selected text to clipboard.
   */
  private async editCopy(): Promise<void> {
    const element = this.window.getFocusedElement();
    this.log(`editCopy called, focused element: ${element?.constructor.name}`);

    let text: string | undefined;

    if (element instanceof DocumentEditor) {
      text = element.getSelectedText();
    } else if (element instanceof SQLEditor) {
      text = element.getSelectedText();
    }
    // Note: Terminal copy requires text selection support which isn't implemented yet

    this.log(`editCopy: selected text length = ${text?.length ?? 0}`);
    if (!text) return;

    // Copy to clipboard
    this.clipboard = text;
    await this.copyToSystemClipboard(text);
    this.log(`editCopy: copied ${text.length} chars to clipboard`);
  }

  /**
   * Paste text from clipboard.
   */
  private async editPaste(): Promise<void> {
    const element = this.window.getFocusedElement();
    this.log(`editPaste called, focused element: ${element?.constructor.name}`);

    // Try system clipboard first, fall back to internal
    const systemText = await this.pasteFromSystemClipboard();
    const text = systemText || this.clipboard;
    this.log(`editPaste: system=${systemText?.length ?? 0}, internal=${this.clipboard?.length ?? 0}`);
    if (!text) return;

    if (element instanceof DocumentEditor) {
      element.insertText(text);
      this.log(`editPaste: inserted ${text.length} chars into DocumentEditor`);
    } else if (element instanceof SQLEditor) {
      element.insertText(text);
      this.log(`editPaste: inserted ${text.length} chars into SQLEditor`);
    } else if (element instanceof AITerminalChat) {
      // Write text directly to the terminal PTY
      element.writeInput(text);
      this.log(`editPaste: wrote ${text.length} chars to AITerminalChat`);
    } else if (element instanceof TerminalPanel) {
      // Write text to the active terminal session
      element.write(text);
      this.log(`editPaste: wrote ${text.length} chars to TerminalPanel`);
    } else {
      this.log('editPaste: unsupported element type');
      return;
    }

    this.scheduleRender();
  }

  /**
   * Handle direct paste text (from terminal bracketed paste).
   */
  private handlePasteText(text: string): void {
    if (!text) return;

    // Check if terminal is focused - route paste there
    if (this.terminalPanelVisible && this.terminalPanel && this.terminalFocused) {
      this.terminalPanel.write(text);
      return;
    }

    // Otherwise paste into focused document editor
    const element = this.window.getFocusedElement();
    if (element instanceof DocumentEditor) {
      element.insertText(text);
      this.scheduleRender();
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
        undoHistory: state.undoHistory,
      });
      debugLog(`[TUIClient]   Document serialized: ${uri.replace(/^file:\/\//, '')}`);
    }

    debugLog(`[TUIClient] Serialized ${documents.length} documents`);

    // Serialize terminals in panes
    const terminals: SessionTerminalState[] = [];
    for (const [elementId, pty] of this.paneTerminals) {
      const pane = this.findPaneForElement(elementId);
      const element = pane?.getElement(elementId);
      if (element instanceof TerminalSession && pane) {
        terminals.push({
          elementId,
          paneId: pane.id,
          tabOrder: tabOrder++,
          isActiveInPane: pane.getActiveElement() === element,
          cwd: pty.getCwd() || this.workingDirectory,
          title: element.getTitle(),
        });
        debugLog(`[TUIClient] Serialized terminal: ${elementId} in pane ${pane.id}`);
      }
    }
    debugLog(`[TUIClient] Serialized ${terminals.length} terminals in panes`);

    // Serialize AI chats in panes
    const aiChats: SessionAIChatState[] = [];
    for (const [elementId, chat] of this.paneAIChats) {
      const pane = this.findPaneForElement(elementId);
      if (pane) {
        const chatState = chat.getState();
        aiChats.push({
          elementId,
          paneId: pane.id,
          tabOrder: tabOrder++,
          isActiveInPane: pane.getActiveElement() === chat,
          provider: chatState.provider,
          sessionId: chatState.sessionId,
          cwd: chatState.cwd,
          title: chat.getTitle(),
        });
        debugLog(`[TUIClient] Serialized AI chat: ${elementId} in pane ${pane.id} (session: ${chatState.sessionId})`);
      }
    }
    debugLog(`[TUIClient] Serialized ${aiChats.length} AI chats in panes`);

    // Serialize SQL editors in panes
    const sqlEditors: SessionSQLEditorState[] = [];
    for (const [elementId, editor] of this.paneSQLEditors) {
      const pane = this.findPaneForElement(elementId);
      if (pane) {
        const state = editor.getState();
        sqlEditors.push({
          elementId,
          paneId: pane.id,
          tabOrder: tabOrder++,
          isActiveInPane: pane.getActiveElement() === editor,
          filePath: state.filePath,
          content: state.content,
          connectionId: state.connectionId,
          cursorLine: state.cursorLine,
          cursorColumn: state.cursorColumn,
          scrollTop: state.scrollTop,
          title: editor.getTitle(),
        });
        debugLog(`[TUIClient] Serialized SQL editor: ${elementId} in pane ${pane.id} (file: ${state.filePath})`);
      }
    }
    debugLog(`[TUIClient] Serialized ${sqlEditors.length} SQL editors in panes`);

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

    // Get sidebar accordion state (save element types, not IDs, since IDs change between sessions)
    let sidebarAccordionExpanded: string[] | undefined;
    if (this.sidebarPaneId) {
      const sidebarPane = this.window.getPaneContainer().getPane(this.sidebarPaneId);
      if (sidebarPane) {
        const paneState = sidebarPane.serialize();
        if (paneState.expandedElementIds && paneState.elements) {
          // Map expanded element IDs to their types for stable persistence
          const expandedIds = new Set(paneState.expandedElementIds);
          sidebarAccordionExpanded = paneState.elements
            .filter(elem => expandedIds.has(elem.id))
            .map(elem => elem.type);
        }
      }
    }

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
      sidebarAccordionExpanded,
    };

    return {
      version: 1,
      timestamp: new Date().toISOString(),
      instanceId: `${Date.now()}-${process.pid}`,
      workspaceRoot: this.workingDirectory,
      documents,
      terminals: terminals.length > 0 ? terminals : undefined,
      aiChats: aiChats.length > 0 ? aiChats : undefined,
      sqlEditors: sqlEditors.length > 0 ? sqlEditors : undefined,
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

    // Collect all pane IDs needed from documents and terminals
    const neededPaneIds = new Set<string>();
    for (const doc of session.documents) {
      neededPaneIds.add(doc.paneId);
    }
    if (session.terminals) {
      for (const term of session.terminals) {
        neededPaneIds.add(term.paneId);
      }
    }
    if (session.aiChats) {
      for (const chat of session.aiChats) {
        neededPaneIds.add(chat.paneId);
      }
    }
    if (session.sqlEditors) {
      for (const sqlEditor of session.sqlEditors) {
        neededPaneIds.add(sqlEditor.paneId);
      }
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

        // Restore undo history
        if (doc.undoHistory) {
          editor.setState({ undoHistory: doc.undoHistory });
        }
      } catch (error) {
        this.log(`Failed to restore document ${doc.filePath}: ${error}`);
      }
    }

    // Restore terminals in panes
    if (session.terminals && session.terminals.length > 0) {
      this.log(`Restoring ${session.terminals.length} terminals in panes`);
      for (const termState of session.terminals) {
        try {
          const targetPane = existingPanes.get(termState.paneId);
          if (targetPane) {
            // Create terminal in the target pane
            await this.createTerminalInPane(targetPane);
            debugLog(`[TUIClient] Restored terminal in pane ${termState.paneId}`);
          } else {
            debugLog(`[TUIClient] Pane ${termState.paneId} not found for terminal`);
          }
        } catch (error) {
          this.log(`Failed to restore terminal: ${error}`);
        }
      }
    }

    // Restore AI chats in panes
    if (session.aiChats && session.aiChats.length > 0) {
      this.log(`Restoring ${session.aiChats.length} AI chats in panes`);
      for (const chatState of session.aiChats) {
        try {
          const targetPane = existingPanes.get(chatState.paneId);
          if (targetPane) {
            // Create AI chat in the target pane with saved session state
            await this.createNewAIChat(targetPane, {
              sessionId: chatState.sessionId ?? undefined,
              cwd: chatState.cwd,
              provider: chatState.provider,
            });
            debugLog(`[TUIClient] Restored AI chat in pane ${chatState.paneId} (session: ${chatState.sessionId})`);
          } else {
            debugLog(`[TUIClient] Pane ${chatState.paneId} not found for AI chat`);
          }
        } catch (error) {
          this.log(`Failed to restore AI chat: ${error}`);
        }
      }
    }

    // Restore SQL editors in panes
    if (session.sqlEditors && session.sqlEditors.length > 0) {
      this.log(`Restoring ${session.sqlEditors.length} SQL editors in panes`);

      // Initialize database service to load saved connections
      await localDatabaseService.init(this.workingDirectory || undefined);

      for (const sqlEditorState of session.sqlEditors) {
        try {
          const targetPane = existingPanes.get(sqlEditorState.paneId);
          if (targetPane) {
            // Create SQL editor in the target pane
            const editorId = targetPane.addElement('SQLEditor', sqlEditorState.title);
            if (editorId) {
              const element = targetPane.getElement(editorId);
              if (element instanceof SQLEditor) {
                this.setupSqlEditorCallbacks(element);
                element.setContent(sqlEditorState.content);
                if (sqlEditorState.filePath) {
                  element.setFilePath(sqlEditorState.filePath);
                }
                // Only restore connection if it still exists
                let validConnectionId: string | null = null;
                if (sqlEditorState.connectionId) {
                  const conn = localDatabaseService.getConnection(sqlEditorState.connectionId);
                  if (conn) {
                    element.setConnection(sqlEditorState.connectionId, conn.name);
                    validConnectionId = sqlEditorState.connectionId;
                  } else {
                    debugLog(`[TUIClient] Connection ${sqlEditorState.connectionId} no longer exists`);
                  }
                }
                element.setState({
                  content: sqlEditorState.content,
                  connectionId: validConnectionId,
                  filePath: sqlEditorState.filePath,
                  cursorLine: sqlEditorState.cursorLine,
                  cursorColumn: sqlEditorState.cursorColumn,
                  scrollTop: sqlEditorState.scrollTop,
                });
                this.paneSQLEditors.set(editorId, element);

                // Create syntax session for SQL highlighting
                try {
                  const uri = element.getVirtualUri();
                  const syntaxSession = await this.syntaxService.createSession(
                    uri,
                    'sql',
                    sqlEditorState.content
                  );
                  this.sqlEditorSyntaxSessions.set(element.id, syntaxSession.sessionId);
                  this.applySyntaxTokens(element.getDocumentEditor(), syntaxSession.sessionId);

                  // Initialize LSP for restored SQL editor
                  await this.lspDocumentOpened(uri, sqlEditorState.content);
                } catch (syntaxError) {
                  this.log(`Failed to create SQL syntax session for restored editor: ${syntaxError}`);
                }

                debugLog(`[TUIClient] Restored SQL editor in pane ${sqlEditorState.paneId} (file: ${sqlEditorState.filePath})`);
              }
            }
          } else {
            debugLog(`[TUIClient] Pane ${sqlEditorState.paneId} not found for SQL editor`);
          }
        } catch (error) {
          this.log(`Failed to restore SQL editor: ${error}`);
        }
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
      // Terminal height comes from config, not session (user preference)
      // Restore terminal visibility
      if (session.ui.terminalVisible) {
        await this.showTerminalPanel();
      }

      // Restore sidebar accordion state
      if (session.ui.sidebarAccordionExpanded && this.sidebarPaneId) {
        const sidebarPane = container.getPane(this.sidebarPaneId);
        if (sidebarPane) {
          const paneState = sidebarPane.serialize();
          if (paneState.elements) {
            const expandedTypes = new Set(session.ui.sidebarAccordionExpanded);
            // Collapse all first, then expand the saved ones
            for (const elem of paneState.elements) {
              if (expandedTypes.has(elem.type)) {
                sidebarPane.expandAccordionSection(elem.id);
              } else {
                sidebarPane.collapseAccordionSection(elem.id);
              }
            }
            debugLog(`[TUIClient] Restored sidebar accordion state: ${session.ui.sidebarAccordionExpanded.join(', ')}`);
          }
        }
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

  // ─────────────────────────────────────────────────────────────────────────
  // LSP Integration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialize LSP integration.
   */
  private initLSPIntegration(): void {
    this.lspIntegration = createLSPIntegration(
      this.window.getOverlayManager(),
      {
        onDirty: () => this.scheduleRender(),
        getThemeColor: (key, fallback) => this.getThemeColor(key, fallback),
        getScreenSize: () => this.getTerminalSize(),
        getSetting: (key) => this.configManager.get(key),
        openFile: async (uri, line, column) => {
          await this.openFile(uri, { focus: true });
          // Navigate to line/column if specified
          if (line !== undefined) {
            const element = this.window.getFocusedElement();
            if (element instanceof DocumentEditor) {
              element.goToLine(line + 1); // Convert 0-indexed to 1-indexed
              if (column !== undefined) {
                element.goToColumn(column);
              }
            }
          }
        },
        showNotification: (message, type) => {
          this.window.showNotification(message, type);
        },
        onDiagnosticsUpdate: (uri, lspDiagnostics) => {
          this.updateEditorDiagnostics(uri, lspDiagnostics);
        },
        onCompletionAccepted: (item, prefix, startColumn) => {
          this.applyCompletion(item, prefix, startColumn);
        },
      },
      this.workingDirectory
    );
  }

  /**
   * Apply a completion item to the current document.
   */
  private applyCompletion(
    item: import('../../../services/lsp/types.ts').LSPCompletionItem,
    prefix: string,
    startColumn: number
  ): void {
    const element = this.window.getFocusedElement();

    // Get the DocumentEditor - either directly or from SQLEditor
    let editor: DocumentEditor | null = null;
    if (element instanceof DocumentEditor) {
      editor = element;
    } else if (element instanceof SQLEditor) {
      editor = element.getDocumentEditor();
    }

    if (!editor) {
      debugLog('[TUIClient] No document editor focused for completion');
      return;
    }

    // Get the text to insert
    const insertText = item.insertText ?? item.label;

    // Get the current cursor position
    const cursors = editor.getCursors();
    if (cursors.length === 0) return;

    const cursor = cursors[0]!;
    const line = cursor.position.line;
    const column = cursor.position.column;

    // Calculate the range to replace (from startColumn to current column)
    const deleteLength = column - startColumn;

    if (deleteLength > 0) {
      // Delete the typed prefix first
      for (let i = 0; i < deleteLength; i++) {
        editor.deleteBackward();
      }
    }

    // Insert the completion text
    editor.insertText(insertText);

    debugLog(`[TUIClient] Applied completion: "${insertText}" (replaced ${deleteLength} chars)`);
    this.scheduleRender();
  }

  /**
   * Get the current document info for LSP.
   * Works with both DocumentEditor and SQLEditor (which embeds a DocumentEditor).
   */
  private getCurrentEditorInfo(): {
    uri: string;
    position: { line: number; character: number };
    screenX: number;
    screenY: number;
    editor: DocumentEditor;
  } | null {
    const element = this.window.getFocusedElement();

    // Get the DocumentEditor - either directly or from SQLEditor
    let editor: DocumentEditor | null = null;
    if (element instanceof DocumentEditor) {
      editor = element;
    } else if (element instanceof SQLEditor) {
      editor = element.getDocumentEditor();
    }

    if (!editor) {
      return null;
    }

    const uri = editor.getUri();
    if (!uri) return null;

    const cursor = editor.getPrimaryCursor();
    const bounds = editor.getBounds();

    // Calculate screen position from cursor
    // The cursor position is relative to the document, not the screen
    const screenX = bounds.x + editor.getGutterWidth() + cursor.position.column - editor.getScrollLeft();
    const screenY = bounds.y + cursor.position.line - editor.getScrollTop();

    return {
      uri,
      position: {
        line: cursor.position.line,
        character: cursor.position.column,
      },
      screenX,
      screenY,
      editor,
    };
  }

  /**
   * Show hover information at current cursor position.
   */
  private async lspShowHover(): Promise<void> {
    this.log('lspShowHover called');

    if (!this.lspIntegration) {
      this.log('lspShowHover: no lspIntegration');
      return;
    }

    const info = this.getCurrentEditorInfo();
    if (!info) {
      this.log('lspShowHover: no editor info');
      this.window.showNotification('No editor focused', 'info');
      return;
    }

    this.log(`lspShowHover: calling showHover with uri=${info.uri}, position=${JSON.stringify(info.position)}, screen=(${info.screenX},${info.screenY})`);
    await this.lspIntegration.showHover(info.uri, info.position, info.screenX, info.screenY);
    this.log('lspShowHover: showHover returned');
  }

  /**
   * Go to definition at current cursor position.
   */
  private async lspGoToDefinition(): Promise<void> {
    if (!this.lspIntegration) return;

    const info = this.getCurrentEditorInfo();
    if (!info) {
      this.window.showNotification('No editor focused', 'info');
      return;
    }

    await this.lspIntegration.goToDefinition(info.uri, info.position);
  }

  /**
   * Trigger completion at current cursor position.
   */
  private async lspTriggerCompletion(): Promise<void> {
    const element = this.window.getFocusedElement();

    // Check if this is a SQL editor - use SQL completion provider
    if (element instanceof SQLEditor) {
      await this.triggerSQLCompletion(element);
      return;
    }

    // Regular LSP completion
    if (!this.lspIntegration) return;

    const info = this.getCurrentEditorInfo();
    if (!info) return;

    // Calculate prefix and startColumn using the editor from info
    const line = info.editor.getLines()[info.position.line];
    let prefix = '';
    let startColumn = info.position.character;

    if (line) {
      for (let i = info.position.character - 1; i >= 0; i--) {
        const ch = line.text[i];
        if (ch && /[\w_$]/.test(ch)) {
          prefix = ch + prefix;
          startColumn = i;
        } else {
          break;
        }
      }
    }

    await this.lspIntegration.triggerCompletion(
      info.uri,
      info.position,
      info.screenX,
      info.screenY,
      prefix,
      startColumn
    );
  }

  /**
   * Trigger SQL-specific completion for a SQL editor.
   * Combines LSP completions (from postgres-language-server) with
   * database-aware completions (tables, columns from connected database).
   */
  private async triggerSQLCompletion(sqlEditor: SQLEditor): Promise<void> {
    if (!this.lspIntegration) return;

    const docEditor = sqlEditor.getDocumentEditor();
    const connectionId = sqlEditor.getConnectionId();
    const uri = sqlEditor.getVirtualUri();

    // Get cursor position and screen coordinates
    const cursor = docEditor.getPrimaryCursor();
    const bounds = docEditor.getBounds();
    const screenX = bounds.x + docEditor.getGutterWidth() + cursor.position.column - docEditor.getScrollLeft();
    const screenY = bounds.y + cursor.position.line - docEditor.getScrollTop();

    // Calculate prefix and startColumn
    const line = docEditor.getLines()[cursor.position.line];
    let prefix = '';
    let startColumn = cursor.position.column;

    if (line) {
      for (let i = cursor.position.column - 1; i >= 0; i--) {
        const ch = line.text[i];
        if (ch && /[\w_$.]/.test(ch)) { // Include . for schema.table
          prefix = ch + prefix;
          startColumn = i;
        } else {
          break;
        }
      }
    }

    const position = { line: cursor.position.line, character: cursor.position.column };
    const allCompletions: import('../../../services/lsp/types.ts').LSPCompletionItem[] = [];

    // Try to get LSP completions from postgres-language-server
    try {
      const lspCompletions = await this.lspIntegration.getLSPService().getCompletions(uri, position);
      if (lspCompletions.length > 0) {
        allCompletions.push(...lspCompletions);
      }
    } catch (error) {
      this.log(`LSP SQL completions failed: ${error}`);
    }

    // Get database-aware SQL completions (tables, columns from connected database)
    if (connectionId) {
      const sqlProvider = getSQLCompletionProvider(localDatabaseService);
      const sqlContent = docEditor.getContent();
      const sqlCompletions = await sqlProvider.getCompletions(
        connectionId,
        sqlContent,
        cursor.position.line,
        cursor.position.column
      );

      // Convert SQL completions to LSP format and add them
      const dbCompletions = sqlCompletions.map((item: SQLCompletionItem) => ({
        label: item.label,
        kind: item.kind,
        detail: item.detail,
        documentation: item.documentation,
        insertText: item.insertText,
        sortText: item.sortText,
        filterText: item.filterText,
      }));

      // Add database completions (they have higher priority due to context)
      allCompletions.push(...dbCompletions);
    }

    if (allCompletions.length === 0) {
      this.lspIntegration.dismissCompletion();
      return;
    }

    // Deduplicate by label (prefer database completions which are added last)
    const seenLabels = new Set<string>();
    const deduped = allCompletions.filter(item => {
      if (seenLabels.has(item.label)) return false;
      seenLabels.add(item.label);
      return true;
    });

    // Show in autocomplete popup
    const popup = this.lspIntegration.getAutocompletePopup();
    popup.showCompletions(deduped, screenX, screenY, prefix, startColumn);
    this.scheduleRender();
  }

  /**
   * Trigger signature help at current cursor position.
   */
  private async lspTriggerSignatureHelp(): Promise<void> {
    if (!this.lspIntegration) return;

    const info = this.getCurrentEditorInfo();
    if (!info) return;

    await this.lspIntegration.triggerSignatureHelp(info.uri, info.position, info.screenX, info.screenY);
  }

  /**
   * Notify LSP that a document was opened.
   */
  private async lspDocumentOpened(uri: string, content: string): Promise<void> {
    if (!this.lspIntegration) return;
    await this.lspIntegration.initForDocument(uri, content);
  }

  /**
   * Notify LSP that a document changed.
   */
  private async lspDocumentChanged(uri: string, content: string): Promise<void> {
    if (!this.lspIntegration) return;
    await this.lspIntegration.documentChanged(uri, content);
  }

  /**
   * Notify LSP that a document was saved.
   */
  private async lspDocumentSaved(uri: string, content: string): Promise<void> {
    if (!this.lspIntegration) return;
    await this.lspIntegration.documentSaved(uri, content);
  }

  /**
   * Notify LSP that a document was closed.
   */
  private async lspDocumentClosed(uri: string): Promise<void> {
    if (!this.lspIntegration) return;
    await this.lspIntegration.documentClosed(uri);
  }

  /**
   * Get diagnostics for a document.
   */
  getLSPDiagnostics(uri: string): import('../../../services/lsp/types.ts').LSPDiagnostic[] {
    if (!this.lspIntegration) return [];
    return this.lspIntegration.getDiagnostics(uri);
  }

  /**
   * Get a DiagnosticsProvider for use with GitDiffBrowser.
   * Returns null if LSP is not available.
   */
  private getDiagnosticsProvider(): DiagnosticsProvider | null {
    if (!this.lspIntegration) return null;
    const lsp = this.lspIntegration;
    return {
      getDiagnostics: (uri: string) => lsp.getDiagnostics(uri),
    };
  }

  /**
   * Get EditCallbacks for use with GitDiffBrowser inline editing.
   * These callbacks handle saving edited hunk content.
   */
  private getEditCallbacks(): EditCallbacks {
    return {
      onSaveEdit: async (filePath, hunkIndex, newLines) => {
        // Stage-modified mode: apply the edit and stage the result
        // For hunk-level staging, we apply the changes and stage the file
        try {
          debugLog(`[TUIClient] Save edit: ${filePath} hunk ${hunkIndex}, ${newLines.length} lines`);

          // Get the diff browser to access the hunk details
          const diffBrowser = this.findGitDiffBrowser();
          if (!diffBrowser) {
            throw new Error('Diff browser not found');
          }

          const artifacts = diffBrowser.getArtifacts();
          const artifact = artifacts.find(a => a.filePath === filePath);
          if (!artifact || !artifact.hunks[hunkIndex]) {
            throw new Error('Hunk not found');
          }

          const hunk = artifact.hunks[hunkIndex];
          const fullPath = `${this.workingDirectory}/${filePath}`;

          // Read current file content
          const fileContent = await Bun.file(fullPath).text();
          const lines = fileContent.split('\n');

          // Calculate the line range for this hunk
          // newStart is 1-based, convert to 0-based
          const startIdx = hunk.newStart - 1;

          // Count original lines (context + added lines from the hunk)
          let originalLineCount = 0;
          for (const line of hunk.lines) {
            if (line.type === 'added' || line.type === 'context') {
              originalLineCount++;
            }
          }

          // Replace the lines
          lines.splice(startIdx, originalLineCount, ...newLines);

          // Write back
          await Bun.write(fullPath, lines.join('\n'));

          // Stage the modified file
          await gitCliService.stage(this.workingDirectory, [filePath]);

          this.window.showNotification(
            `Saved and staged changes to ${filePath}`,
            'info'
          );

          // Trigger refresh of the diff view
          this.refreshGitStatus();
        } catch (error) {
          debugLog(`[TUIClient] Save edit failed: ${error}`);
          this.window.showNotification(
            `Failed to save: ${error}`,
            'error'
          );
        }
      },
      onDirectWrite: async (filePath, startLine, newLines, originalLineCount) => {
        // Direct-write mode: modify the file directly
        try {
          const fullPath = `${this.workingDirectory}/${filePath}`;

          // Read current file content
          const fileContent = await Bun.file(fullPath).text();
          const lines = fileContent.split('\n');

          // Calculate the range to replace
          // startLine is 1-based from git, convert to 0-based
          const startIdx = startLine - 1;

          // Replace the original lines with the new lines
          // originalLineCount tells us how many lines were there before editing
          lines.splice(startIdx, originalLineCount, ...newLines);

          // Write back
          await Bun.write(fullPath, lines.join('\n'));

          this.window.showNotification(
            `Saved changes to ${filePath}`,
            'info'
          );

          debugLog(`[TUIClient] Direct write: ${filePath} replaced ${originalLineCount} lines at ${startLine} with ${newLines.length} lines`);
        } catch (error) {
          debugLog(`[TUIClient] Direct write failed: ${error}`);
          this.window.showNotification(
            `Failed to save: ${error}`,
            'error'
          );
        }
      },
    };
  }

  /**
   * Handle a character being typed in the editor.
   * Triggers autocomplete if the character is a trigger character.
   */
  private handleCharTyped(
    editor: DocumentEditor,
    uri: string,
    char: string,
    position: { line: number; column: number }
  ): void {
    if (!this.lspIntegration) return;

    // Calculate screen coordinates for popup positioning
    const bounds = editor.getBounds();
    const gutterWidth = editor.getGutterWidth();
    const scrollTop = editor.getScrollTop();
    const scrollLeft = editor.getScrollLeft();

    const screenX = bounds.x + gutterWidth + (position.column - scrollLeft);
    const screenY = bounds.y + (position.line - scrollTop) + 1; // +1 to show below cursor

    // Get the current word prefix up to cursor
    const line = editor.getLines()[position.line];
    let prefix = '';
    let startColumn = position.column;

    if (line) {
      for (let i = position.column - 1; i >= 0; i--) {
        const ch = line.text[i];
        if (ch && /[\w_$]/.test(ch)) {
          prefix = ch + prefix;
          startColumn = i;
        } else {
          break;
        }
      }
    }

    // Check if this character should trigger completion
    if (this.lspIntegration.shouldTriggerCompletion(char)) {
      // Trigger completion with debounce
      this.lspIntegration.triggerCompletionDebounced(
        uri,
        { line: position.line, character: position.column },
        screenX,
        screenY,
        prefix,
        startColumn
      );
    } else if (this.lspIntegration.isCompletionVisible()) {
      // Update filter if completion is already visible
      this.lspIntegration.updateCompletionFilter(prefix);
    }
  }

  /**
   * Update diagnostics for a document editor.
   * Converts LSP diagnostics to the DocumentEditor's format.
   */
  private updateEditorDiagnostics(uri: string, lspDiagnostics: import('../../../services/lsp/types.ts').LSPDiagnostic[]): void {
    // Find the editor for this URI
    const docInfo = this.openDocuments.get(uri);
    if (!docInfo) return;

    const editor = this.findEditorById(docInfo.editorId);
    if (!editor || !(editor instanceof DocumentEditor)) return;

    // Convert LSP diagnostics to DocumentEditor format
    const diagnostics: import('../elements/document-editor.ts').DiagnosticInfo[] = lspDiagnostics.map((d) => ({
      startLine: d.range.start.line,
      startColumn: d.range.start.character,
      endLine: d.range.end.line,
      endColumn: d.range.end.character,
      message: d.message,
      severity: (d.severity ?? 1) as import('../elements/document-editor.ts').DiagnosticSeverity,
      source: d.source,
    }));

    editor.setDiagnostics(diagnostics);

    // Also refresh diagnostics in any open GitDiffBrowser
    this.refreshDiffBrowserDiagnostics();
  }

  /**
   * Refresh diagnostics cache in all open GitDiffBrowsers.
   * Called when LSP diagnostics are updated.
   */
  private refreshDiffBrowserDiagnostics(): void {
    const container = this.window.getPaneContainer();
    const panes = container.getPanes();

    for (const pane of panes) {
      for (const element of pane.getElements()) {
        if (element instanceof GitDiffBrowser) {
          element.refreshDiagnosticsCache();
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Database Commands
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Open a new SQL editor tab.
   */
  private async openNewSqlEditor(connectionId?: string): Promise<SQLEditor | null> {
    const activePane = this.window.getFocusedPane();
    if (!activePane) return null;

    // Create SQL editor element using the pane's addElement method
    const editorId = activePane.addElement('SQLEditor', 'New Query');
    if (!editorId) {
      this.window.showNotification('Failed to create SQL editor', 'error');
      return null;
    }

    // Get the created element and set up callbacks
    const element = activePane.getElement(editorId);
    if (element && element instanceof SQLEditor) {
      this.setupSqlEditorCallbacks(element);

      // Track the SQL editor
      this.paneSQLEditors.set(editorId, element);

      // Set connection if provided
      if (connectionId) {
        const conn = localDatabaseService.getConnection(connectionId);
        element.setConnection(connectionId, conn?.name);
      }

      // Initialize LSP for SQL
      await this.lspDocumentOpened(element.getVirtualUri(), element.getContent());

      // Create syntax session for SQL highlighting
      try {
        const syntaxSession = await this.syntaxService.createSession(
          element.getVirtualUri(),
          'sql',
          element.getContent()
        );
        // Track the syntax session
        this.sqlEditorSyntaxSessions.set(element.id, syntaxSession.sessionId);
        // Apply syntax tokens to the embedded DocumentEditor
        this.applySyntaxTokens(element.getDocumentEditor(), syntaxSession.sessionId);
      } catch (error) {
        this.log(`Failed to create SQL syntax session: ${error}`);
      }

      this.markSessionDirty();
      this.scheduleRender();
      return element;
    }

    this.scheduleRender();
    return null;
  }

  /**
   * Open a SQL file in SQLEditor.
   */
  private async openSqlFile(uri: string, options: OpenFileOptions = {}): Promise<SQLEditor | null> {
    const activePane = this.getTargetEditorPane(options.pane);
    if (!activePane) return null;

    const filePath = uri.replace('file://', '');

    // Check if already open - find existing SQLEditor with this file
    const elements = activePane.getElements();
    let existingEditor: SQLEditor | undefined;
    for (const el of elements) {
      if (el instanceof SQLEditor && el.getFilePath() === filePath) {
        existingEditor = el;
        break;
      }
    }
    if (existingEditor) {
      if (options.focus !== false) {
        activePane.setActiveElement(existingEditor.id);
      }
      return existingEditor;
    }

    // Read file content
    let content = '';
    try {
      const fileResult = await this.fileService.read(uri);
      content = fileResult.content;
    } catch {
      // File doesn't exist - will create on save
    }

    // Create SQL editor element
    const filename = uri.split('/').pop() ?? 'query.sql';
    const editorId = activePane.addElement('SQLEditor', filename);
    if (!editorId) {
      this.window.showNotification('Failed to create SQL editor', 'error');
      return null;
    }

    const element = activePane.getElement(editorId);
    if (element && element instanceof SQLEditor) {
      this.setupSqlEditorCallbacks(element);
      element.setContent(content);
      element.setFilePath(filePath);

      // Track the SQL editor
      this.paneSQLEditors.set(editorId, element);

      // Initialize LSP for SQL (use file URI for file-based SQL)
      await this.lspDocumentOpened(uri.startsWith('file://') ? uri : `file://${filePath}`, content);

      // Create syntax session for SQL highlighting
      try {
        const syntaxSession = await this.syntaxService.createSession(
          uri.startsWith('file://') ? uri : `file://${filePath}`,
          'sql',
          content
        );
        // Track the syntax session
        this.sqlEditorSyntaxSessions.set(element.id, syntaxSession.sessionId);
        // Apply syntax tokens to the embedded DocumentEditor
        this.applySyntaxTokens(element.getDocumentEditor(), syntaxSession.sessionId);
      } catch (error) {
        this.log(`Failed to create SQL syntax session: ${error}`);
      }

      if (options.focus !== false) {
        activePane.setActiveElement(element.id);
      }

      this.markSessionDirty();
      this.scheduleRender();
      return element;
    }

    this.scheduleRender();
    return null;
  }

  /**
   * Set up callbacks for a SQL editor.
   */
  private setupSqlEditorCallbacks(editor: SQLEditor): void {
    editor.setCallbacks({
      onExecuteQuery: async (sql: string, connectionId: string): Promise<QueryResult> => {
        const result = await this.executeSqlQuery(sql, connectionId);
        // Show results in a QueryResults element
        this.showQueryResults(result, { sql, connectionId });
        return result;
      },
      onPickConnection: async (): Promise<ConnectionInfo | null> => {
        const connId = await this.showDatabaseConnectionPicker();
        if (!connId) return null;
        return localDatabaseService.getConnection(connId);
      },
      getConnection: (connectionId: string): ConnectionInfo | null => {
        return localDatabaseService.getConnection(connectionId);
      },
      onSave: async (content: string, filePath: string | null): Promise<string | null> => {
        return this.saveSqlFile(content, filePath);
      },
      onContentChange: async (content: string): Promise<void> => {
        // Update syntax highlighting
        const sessionId = this.sqlEditorSyntaxSessions.get(editor.id);
        if (sessionId) {
          try {
            await this.syntaxService.updateSession(sessionId, content);
            this.applySyntaxTokens(editor.getDocumentEditor(), sessionId);
          } catch (error) {
            this.log(`Failed to update SQL syntax: ${error}`);
          }
        }

        // Notify LSP of content change
        const uri = editor.getVirtualUri();
        await this.lspDocumentChanged(uri, content);
      },
      onConnectionChange: (connectionId: string | null): void => {
        // Configure the postgres-language-server with the database connection
        this.configureSQLLanguageServer(connectionId);
      },
    });
  }

  /**
   * Configure the postgres-language-server with database connection info.
   * This enables schema-aware completions and hover for SQL editors.
   */
  private configureSQLLanguageServer(connectionId: string | null): void {
    if (!this.lspIntegration || !connectionId) return;

    // Get full config (includes port and username, unlike ConnectionInfo)
    const config = localDatabaseService.getConnectionConfig(connectionId);
    if (!config) {
      this.log(`Cannot configure SQL LSP: connection ${connectionId} not found`);
      return;
    }

    // Get the cached password (only available while connected)
    // Password is cleared from memory when connection is closed for security
    const password = localDatabaseService.getCachedPassword(connectionId);
    if (!password) {
      this.log(`Cannot configure SQL LSP: no password cached for ${connectionId}`);
      return;
    }

    this.lspIntegration.getLSPService().configureSQLServer({
      host: config.host,
      port: config.port,
      database: config.database,
      username: config.username,
      password: password,
    });

    this.log(`Configured SQL LSP with connection: ${config.name}`);
  }

  /**
   * Save SQL content to a file.
   * If filePath is null, prompts for a location.
   * Returns the saved file path or null if cancelled.
   */
  private async saveSqlFile(content: string, filePath: string | null): Promise<string | null> {
    let targetPath = filePath;

    // If no path, prompt for save location
    if (!targetPath) {
      // Use file picker in save mode
      const result = await this.showSaveFileDialog('.sql');
      if (!result) {
        return null;
      }
      targetPath = result;
    }

    try {
      await Bun.write(targetPath, content);
      this.window.showNotification(`Saved: ${targetPath}`, 'info');
      return targetPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.window.showNotification(`Save failed: ${message}`, 'error');
      return null;
    }
  }

  /**
   * Show a save file dialog.
   */
  private async showSaveFileDialog(defaultExtension: string): Promise<string | null> {
    if (!this.saveAsDialog) {
      // Fallback: generate a default path
      return `${this.workingDirectory || '.'}/query${defaultExtension}`;
    }

    const defaultPath = this.workingDirectory || '.';
    const defaultName = `query${defaultExtension}`;

    const result = await this.saveAsDialog.showSaveAs({
      startPath: defaultPath,
      suggestedFilename: defaultName,
    });
    if (result.confirmed && result.value) {
      return result.value;
    }
    return null;
  }

  /**
   * Show query results in a QueryResults element.
   * Reuses existing QueryResults in the pane, or creates a new one.
   */
  private showQueryResults(
    result: QueryResult,
    options: { tableName?: string; connectionId?: string; sql?: string } = {}
  ): void {
    const activePane = this.window.getFocusedPane();
    if (!activePane) return;

    // Look for existing QueryResults element in this pane
    let resultsElement = activePane.getElements().find(
      (el): el is QueryResults => el instanceof QueryResults
    );

    if (!resultsElement) {
      // Create new QueryResults element
      const newId = activePane.addElement('QueryResults', 'Query Results');
      if (newId) {
        const el = activePane.getElement(newId);
        if (el instanceof QueryResults) {
          resultsElement = el;
        }
      }
    }

    if (resultsElement) {
      resultsElement.setResult(result);

      // Try to determine table name from SQL if not provided
      const tableName = options.tableName || this.parseTableNameFromSql(options.sql || '');
      resultsElement.setTableName(tableName);

      // Store query context for refresh
      if (options.sql && options.connectionId) {
        resultsElement.setQueryContext(options.sql, options.connectionId);
      }

      // Set up row details and refresh callbacks
      this.setupQueryResultsCallbacks(resultsElement, options.connectionId || '', options.sql || '');

      // Focus the results element (both tab and focus manager)
      activePane.setActiveElement(resultsElement.id);
      this.window.focusElement(resultsElement);
    }

    this.scheduleRender();
  }

  /**
   * Set up callbacks for a QueryResults element.
   */
  private setupQueryResultsCallbacks(results: QueryResults, connectionId: string, sql: string): void {
    // Store connection ID and SQL for later use
    const currentConnectionId = connectionId;
    const currentSql = sql;

    // Parse schema and table from SQL for row details
    const { schema: parsedSchema, tableName: parsedTableName } = parseTableInfoFromSql(sql);

    // Set up callbacks (this overrides but that's OK for now)
    (results as any).callbacks = {
      ...(results as any).callbacks,
      onShowRowDetails: (
        row: Record<string, unknown>,
        fields: import('../../../services/database/types.ts').FieldInfo[],
        tableName: string,
        rowIndex: number
      ) => {
        // Use parsed schema, or default to 'public' if parsing failed
        const schemaName = tableName === parsedTableName ? parsedSchema : 'public';
        this.showRowDetailsPanel(row, fields, tableName, schemaName, currentConnectionId, results);
      },
      onRefresh: async () => {
        if (!currentSql || !currentConnectionId) {
          this.window.showNotification('No query context for refresh', 'warning');
          return;
        }
        try {
          this.window.showNotification('Refreshing...', 'info');
          const result = await this.executeSqlQuery(currentSql, currentConnectionId);
          results.setResult(result);
          this.window.showNotification(`Refreshed: ${result.rowCount} rows`, 'info');
          this.scheduleRender();
        } catch (error) {
          this.window.showNotification(`Refresh failed: ${error}`, 'error');
        }
      },
    };
  }

  /**
   * Parse table name from a SQL query (simple heuristic).
   */
  private parseTableNameFromSql(sql: string): string {
    const { tableName } = parseTableInfoFromSql(sql);
    return tableName;
  }

  /**
   * Show the row details panel for a selected row.
   */
  private async showRowDetailsPanel(
    row: Record<string, unknown>,
    fields: import('../../../services/database/types.ts').FieldInfo[],
    tableName: string,
    schemaName: string,
    connectionId: string,
    sourceResults: QueryResults
  ): Promise<void> {
    const activePane = this.window.getFocusedPane();
    if (!activePane) return;

    // Look for existing RowDetailsPanel in this pane
    let detailsPanel = activePane.getElements().find(
      (el): el is RowDetailsPanel => el instanceof RowDetailsPanel
    );

    if (!detailsPanel) {
      // Create new RowDetailsPanel element
      const newId = activePane.addElement('RowDetailsPanel', 'Row Details');
      if (newId) {
        const el = activePane.getElement(newId);
        if (el instanceof RowDetailsPanel) {
          detailsPanel = el;
        }
      }
    }

    if (detailsPanel) {
      // Set up callbacks for the panel
      this.setupRowDetailsPanelCallbacks(detailsPanel, connectionId, sourceResults);

      // Try to get primary key from table schema
      let primaryKey: PrimaryKeyDef | null = null;
      if (connectionId && tableName && tableName !== 'Query Results') {
        try {
          const tableDetails = await localDatabaseService.describeTable(
            connectionId,
            schemaName,
            tableName
          );
          if (tableDetails?.primaryKey) {
            primaryKey = { columns: tableDetails.primaryKey.columns };
          }
        } catch (error) {
          debugLog(`[RowDetails] Could not fetch primary key: ${error}`);
        }
      }

      // Set the row data
      detailsPanel.setRowData(row, fields, tableName, schemaName, primaryKey);

      // Focus the details panel
      activePane.setActiveElement(detailsPanel.id);
      this.window.focusElement(detailsPanel);
    }

    this.scheduleRender();
  }

  /**
   * Set up callbacks for a RowDetailsPanel.
   */
  private setupRowDetailsPanelCallbacks(
    panel: RowDetailsPanel,
    connectionId: string,
    sourceResults: QueryResults
  ): void {
    const callbacks: RowDetailsPanelCallbacks = {
      onSave: async (updates, whereClause) => {
        try {
          // Build UPDATE statement
          const tableName = (panel as any).tableName || 'unknown';
          const schemaName = (panel as any).schemaName || 'public';
          const fullTable = `"${schemaName}"."${tableName}"`;

          const setClauses = Object.entries(updates)
            .map(([col, val]) => `"${col}" = ${this.formatSqlValue(val)}`)
            .join(', ');

          const whereClauses = Object.entries(whereClause)
            .map(([col, val]) => `"${col}" = ${this.formatSqlValue(val)}`)
            .join(' AND ');

          const sql = `UPDATE ${fullTable} SET ${setClauses} WHERE ${whereClauses}`;

          debugLog(`[RowDetails] Executing: ${sql}`);
          await localDatabaseService.executeQuery(connectionId, sql);
          this.window.showNotification('Row updated successfully', 'info');
          return true;
        } catch (error) {
          debugLog(`[RowDetails] Update failed: ${error}`);
          this.window.showNotification(`Update failed: ${error}`, 'error');
          return false;
        }
      },

      onDelete: async (whereClause) => {
        try {
          const tableName = (panel as any).tableName || 'unknown';
          const schemaName = (panel as any).schemaName || 'public';
          const fullTable = `"${schemaName}"."${tableName}"`;

          const whereClauses = Object.entries(whereClause)
            .map(([col, val]) => `"${col}" = ${this.formatSqlValue(val)}`)
            .join(' AND ');

          const sql = `DELETE FROM ${fullTable} WHERE ${whereClauses}`;

          debugLog(`[RowDetails] Executing: ${sql}`);
          await localDatabaseService.executeQuery(connectionId, sql);
          this.window.showNotification('Row deleted successfully', 'info');

          // Close the panel and go back to results
          const pane = this.window.getFocusedPane();
          if (pane) {
            pane.removeElement(panel.id);
            // Focus the results
            pane.setActiveElement(sourceResults.id);
          }
          this.scheduleRender();
          return true;
        } catch (error) {
          debugLog(`[RowDetails] Delete failed: ${error}`);
          this.window.showNotification(`Delete failed: ${error}`, 'error');
          return false;
        }
      },

      onConfirmDelete: async (message: string) => {
        if (!this.dialogManager) {
          this.window.showNotification('Confirmation dialog not available', 'error');
          return false;
        }
        const result = await this.dialogManager.showConfirm({
          title: 'Delete Row',
          message,
          confirmText: 'Delete',
          declineText: 'Cancel',
          destructive: true,
          defaultButton: 'decline',
        });
        return result.value === true;
      },

      onClose: () => {
        const pane = this.window.getFocusedPane();
        if (pane) {
          pane.removeElement(panel.id);
          // Focus the results
          pane.setActiveElement(sourceResults.id);
        }
        this.scheduleRender();
      },
    };

    // Apply callbacks to the panel
    (panel as any).callbacks = callbacks;
  }

  /**
   * Format a value for SQL.
   */
  private formatSqlValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'object') {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  /**
   * Execute a SQL query using the database service.
   */
  private async executeSqlQuery(sql: string, connectionId: string): Promise<QueryResult> {
    try {
      // Initialize database service if needed
      await localDatabaseService.init(this.workingDirectory || undefined);

      // Check if connection exists and auto-connect if needed
      const connection = localDatabaseService.getConnection(connectionId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      if (connection.status === 'disconnected' || connection.status === 'error') {
        await localDatabaseService.connect(connectionId);
        // Now password is cached - configure SQL LSP with database connection
        this.configureSQLLanguageServer(connectionId);
      }

      const result = await localDatabaseService.executeQuery(connectionId, sql);
      return result;
    } catch (error) {
      // Re-throw with a more user-friendly message
      throw new Error(
        error instanceof Error ? error.message : 'Query execution failed'
      );
    }
  }

  /**
   * Show database connection picker.
   * Returns selected connection ID or null if cancelled.
   */
  private async showDatabaseConnectionPicker(): Promise<string | null> {
    if (!this.connectionPickerDialog) {
      this.window.showNotification('Connection picker not available', 'error');
      return null;
    }

    try {
      // Initialize database service if needed
      await localDatabaseService.init(this.workingDirectory || undefined);

      // Loop until user selects a connection or cancels
      while (true) {
        // Get available connections (refreshed each iteration)
        const connections = localDatabaseService.listConnections();

        // Show picker
        const result = await this.connectionPickerDialog.showWithConnections(
          connections,
          null // No current connection selected
        );

        if (!result) {
          return null;
        }

        // Handle each action
        switch (result.action) {
          case 'new':
            await this.showNewDatabaseConnectionDialog();
            // Continue loop to show picker again
            continue;

          case 'edit':
            if (result.connection) {
              await this.showEditConnectionDialog(result.connection.id);
            }
            // Continue loop to show picker again
            continue;

          case 'delete':
            if (result.connection) {
              await this.confirmDeleteConnection(result.connection);
            }
            // Continue loop to show picker again
            continue;

          case 'select':
            if (!result.connection) {
              return null;
            }
            // Connect if not already connected
            if (result.connection.status !== 'connected') {
              try {
                this.window.showNotification(`Connecting to ${result.connection.name}...`, 'info');
                await localDatabaseService.connect(result.connection.id);
                this.window.showNotification(`Connected to ${result.connection.name}`, 'success');
              } catch (error) {
                this.window.showNotification(
                  `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  'error'
                );
                // Continue loop to let user try again
                continue;
              }
            }
            return result.connection.id;

          default:
            return null;
        }
      }
    } catch (error) {
      debugLog(`[TUIClient] Connection picker error: ${error}`);
      this.window.showNotification(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
      return null;
    }
  }

  /**
   * Show edit connection dialog for an existing connection.
   */
  private async showEditConnectionDialog(connectionId: string): Promise<void> {
    if (!this.connectionEditDialog) {
      this.window.showNotification('Connection editor not available', 'error');
      return;
    }

    try {
      // Get the existing connection config
      const existingConfig = localDatabaseService.getConnectionConfig(connectionId);
      if (!existingConfig) {
        this.window.showNotification('Connection not found', 'error');
        return;
      }

      // Get existing password from secret service if set
      let existingPassword: string | undefined;
      if (existingConfig.passwordSecret) {
        existingPassword = await localSecretService.get(existingConfig.passwordSecret) ?? undefined;
      }

      // Get existing Supabase key if set
      let existingSupabaseKey: string | undefined;
      if (existingConfig.supabaseKeySecret) {
        existingSupabaseKey = await localSecretService.get(existingConfig.supabaseKeySecret) ?? undefined;
      }

      // Show the dialog with existing data
      const result = await this.connectionEditDialog.showForConnection({
        existingConnection: existingConfig,
        existingPassword,
        existingSupabaseKey,
        projectPath: this.workingDirectory || undefined,
      });

      if (!result.confirmed || !result.value) {
        return;
      }

      const { config, password, supabaseKey } = result.value;

      // Update password in secret service
      if (password && config.passwordSecret) {
        await localSecretService.set(config.passwordSecret, password);
      } else if (!password && existingConfig.passwordSecret) {
        // Password was cleared, remove secret
        await localSecretService.delete(existingConfig.passwordSecret);
      }

      // Update Supabase key in secret service
      if (supabaseKey && config.supabaseKeySecret) {
        await localSecretService.set(config.supabaseKeySecret, supabaseKey);
      } else if (!supabaseKey && existingConfig.supabaseKeySecret) {
        // Key was cleared, remove secret
        await localSecretService.delete(existingConfig.supabaseKeySecret);
      }

      // Update the connection
      await localDatabaseService.updateConnection(connectionId, config);

      this.window.showNotification(`Connection "${config.name}" updated`, 'success');
    } catch (error) {
      debugLog(`[TUIClient] Edit connection error: ${error}`);
      this.window.showNotification(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    }
  }

  /**
   * Confirm and delete a connection.
   */
  private async confirmDeleteConnection(connection: ConnectionInfo): Promise<void> {
    if (!this.dialogManager) {
      this.window.showNotification('Dialog manager not available', 'error');
      return;
    }

    try {
      const confirmResult = await this.dialogManager.showConfirm({
        title: 'Delete Connection',
        message: `Are you sure you want to delete "${connection.name}"?\n\nThis action cannot be undone.`,
        confirmText: 'Delete',
        declineText: 'Cancel',
      });

      if (!confirmResult.confirmed || !confirmResult.value) {
        return;
      }

      // Get config to check for secrets to delete
      const config = localDatabaseService.getConnectionConfig(connection.id);

      // Delete the connection
      await localDatabaseService.deleteConnection(connection.id);

      // Clean up secrets
      if (config?.passwordSecret) {
        await localSecretService.delete(config.passwordSecret);
      }
      if (config?.supabaseKeySecret) {
        await localSecretService.delete(config.supabaseKeySecret);
      }

      this.window.showNotification(`Connection "${connection.name}" deleted`, 'success');
    } catch (error) {
      debugLog(`[TUIClient] Delete connection error: ${error}`);
      this.window.showNotification(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    }
  }

  /**
   * Show new database connection dialog.
   * Creates a new connection and optionally connects to it.
   */
  private async showNewDatabaseConnectionDialog(): Promise<void> {
    if (!this.connectionEditDialog) {
      this.window.showNotification('Connection editor not available', 'error');
      return;
    }

    try {
      // Show the dialog
      const result = await this.connectionEditDialog.showForConnection({
        projectPath: this.workingDirectory || undefined,
      });

      if (!result.confirmed || !result.value) {
        return;
      }

      const { config, password, supabaseKey } = result.value;

      // Store password in secret service (if provided)
      if (password && config.passwordSecret) {
        await localSecretService.set(config.passwordSecret, password);
      }

      // Store Supabase key if provided
      if (supabaseKey && config.supabaseKeySecret) {
        await localSecretService.set(config.supabaseKeySecret, supabaseKey);
      }

      // Create the connection
      const connectionId = await localDatabaseService.createConnection(config);

      this.window.showNotification(`Connection "${config.name}" created`, 'success');

      // Ask if user wants to connect now
      if (this.dialogManager) {
        const confirmResult = await this.dialogManager.showConfirm({
          title: 'Connect Now?',
          message: `Would you like to connect to "${config.name}" now?`,
          confirmText: 'Connect',
          declineText: 'Later',
        });

        if (confirmResult.confirmed && confirmResult.value) {
          try {
            this.window.showNotification(`Connecting to ${config.name}...`, 'info');
            await localDatabaseService.connect(connectionId);
            this.window.showNotification(`Connected to ${config.name}`, 'success');
          } catch (error) {
            this.window.showNotification(
              `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
              'error'
            );
          }
        }
      }
    } catch (error) {
      debugLog(`[TUIClient] New connection dialog error: ${error}`);
      this.window.showNotification(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    }
  }

  /**
   * Show database query history.
   */
  private async showDatabaseQueryHistory(): Promise<void> {
    // TODO: Implement query history dialog
    this.window.showNotification('Query history coming soon', 'info');
  }

  /**
   * Show database schema browser.
   */
  private async showDatabaseSchemaBrowser(): Promise<void> {
    if (!this.schemaBrowser) return;

    // First, pick a connection
    const connectionId = await this.showDatabaseConnectionPicker();
    if (!connectionId) return;

    // Ensure connected
    const connection = localDatabaseService.getConnection(connectionId);
    if (!connection) {
      this.window.showNotification('Connection not found', 'error');
      return;
    }

    if (connection.status !== 'connected') {
      try {
        await localDatabaseService.connect(connectionId);
      } catch (error) {
        this.window.showNotification(
          `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'error'
        );
        return;
      }
    }

    // Show schema browser
    const result = await this.schemaBrowser.showBrowser({
      connectionId,
      title: `Schema: ${connection.name}`,
    });

    if (result.confirmed && result.value?.action === 'select') {
      const { nodeType, schema, tableName } = result.value;

      if (nodeType === 'table' || nodeType === 'view') {
        // Open SQL editor with SELECT query for the table
        const editor = await this.openNewSqlEditor(connectionId);
        if (editor && tableName && schema) {
          const qualifiedName = schema === 'public' ? tableName : `${schema}.${tableName}`;
          editor.setContent(`SELECT * FROM ${qualifiedName} LIMIT 100;`);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Sidebar Panel Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a panel to the sidebar.
   * If the panel type already exists, shows a notification.
   * New panels are added at the top of the sidebar.
   */
  private addSidebarPanel(
    type: 'FileTree' | 'GitPanel' | 'OutlinePanel' | 'GitTimelinePanel',
    title: string
  ): void {
    if (!this.sidebarPaneId) {
      this.window.showNotification('No sidebar available', 'error');
      return;
    }

    const container = this.window.getPaneContainer();
    const sidePane = container.getPane(this.sidebarPaneId);
    if (!sidePane) {
      this.window.showNotification('Sidebar pane not found', 'error');
      return;
    }

    // Check if this panel type already exists
    const existingElements = sidePane.getElements();
    for (const element of existingElements) {
      if (element.type === type) {
        this.window.showNotification(`${title} already exists in sidebar`, 'info');
        return;
      }
    }

    // Add element to sidebar
    const elementId = sidePane.addElement(type, title);
    if (!elementId) {
      this.window.showNotification(`Failed to add ${title}`, 'error');
      return;
    }

    // Get the element and configure it
    const element = sidePane.getElement(elementId);
    if (element) {
      switch (type) {
        case 'FileTree':
          this.fileTree = element as FileTree;
          this.configureFileTree(this.fileTree);
          break;
        case 'GitPanel':
          this.gitPanel = element as GitPanel;
          this.configureGitPanel(this.gitPanel);
          break;
        case 'OutlinePanel':
          this.outlinePanel = element as OutlinePanel;
          this.configureOutlinePanel(this.outlinePanel);
          break;
        case 'GitTimelinePanel':
          this.gitTimelinePanel = element as GitTimelinePanel;
          this.configureGitTimelinePanel(this.gitTimelinePanel);
          break;
      }
    }

    this.window.showNotification(`Added ${title} to sidebar`, 'info');
    this.scheduleRender();
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
