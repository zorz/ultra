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
  AITerminalChat,
  createTerminalPanel,
  createAITerminalChat,
  createTestContext,
  registerBuiltinElements,
  type FileNode,
  type DocumentEditorCallbacks,
  type FileTreeCallbacks,
  type GitPanelCallbacks,
  type TerminalSessionCallbacks,
  type AITerminalChatState,
  type AIProvider,
} from '../elements/index.ts';
import type { Pane } from '../layout/pane.ts';

// Dialog system
import {
  DialogManager,
  createDialogManager,
  FileBrowserDialog,
  SaveAsDialog,
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
import { fileService, type FileService, type WatchHandle } from '../../../services/file/index.ts';
import { gitCliService } from '../../../services/git/index.ts';
import { localSyntaxService, type SyntaxService, type HighlightToken } from '../../../services/syntax/index.ts';
import {
  localSessionService,
  type SessionState,
  type SessionDocumentState,
  type SessionTerminalState,
  type SessionAIChatState,
  type SessionLayoutNode,
  type SessionUIState,
} from '../../../services/session/index.ts';

// Terminal
import { createPtyBackend } from '../../../terminal/pty-factory.ts';
import type { PTYBackend } from '../../../terminal/pty-backend.ts';

// LSP
import { createLSPIntegration, type LSPIntegration } from './lsp-integration.ts';

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

  /** LSP integration */
  private lspIntegration: LSPIntegration | null = null;

  /** File tree element reference */
  private fileTree: FileTree | null = null;

  /** Workspace directory watcher */
  private workspaceWatcher: WatchHandle | null = null;

  /** Debounce timer for workspace refresh */
  private workspaceRefreshTimer: ReturnType<typeof setTimeout> | null = null;

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
      getSetting: (key, defaultValue) => this.configManager.getWithDefault(key as any, defaultValue),
      onDirty: () => this.scheduleRender(),
      onElementCloseRequest: (elementId, element) => this.handleElementCloseRequest(elementId, element),
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
      // Start watching workspace for file changes
      this.startWorkspaceWatcher();
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
      onOpenFile: async (path) => {
        await this.openFile(`file://${this.workingDirectory}/${path}`);
      },
    };
    gitPanel.setCallbacks(callbacks);
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

      // Update git line changes (saved content is now committed baseline)
      this.updateGitLineChanges(editor, uri);

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
    const editor = this.window.getFocusedElement();
    if (!(editor instanceof DocumentEditor)) {
      return false;
    }

    // Check for unsaved changes
    const isUntitled = editor.getUri() === null;
    const hasChanges = editor.isModified() || isUntitled;

    if (hasChanges) {
      if (!this.dialogManager) {
        return false;
      }
      const filename = editor.getTitle();
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

    const uri = editor.getUri();
    if (uri) {
      const doc = this.openDocuments.get(uri);
      if (doc) {
        await this.documentService.close(doc.documentId);
        this.openDocuments.delete(uri);
      }
      // Notify LSP of document close
      await this.lspDocumentClosed(uri);
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
      default:
        // Unknown when clause - return false to be safe (don't activate binding)
        return false;
    }
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
   * Terminal panel aligns with editor area (excludes sidebar).
   */
  private layoutTerminalPanel(): void {
    if (!this.terminalPanel) return;

    const size = this.getTerminalSize();
    const panelHeight = this.terminalPanelVisible ? this.terminalPanelHeight : 0;

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

      // Apply sidebar width from updated config
      this.applySidebarWidth();

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
   */
  private applySidebarWidth(): void {
    if (this.sidebarPaneId === null) return;

    const container = this.window.getPaneContainer();
    if (!container) return;

    const sidebarWidth = this.configManager.getWithDefault('tui.sidebar.width', 24);
    const totalWidth = this.window.getSize().width;
    const sidebarRatio = Math.min(0.3, sidebarWidth / totalWidth);

    // Find and update the sidebar split
    container.adjustRatios('split-1', [sidebarRatio, 1 - sidebarRatio]);
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
    // Search
    'search.find': { label: 'Find', category: 'Search' },
    'search.replace': { label: 'Find and Replace', category: 'Search' },
    'search.findInFiles': { label: 'Find in Files', category: 'Search' },
    // Editor
    'editor.gotoLine': { label: 'Go to Line...', category: 'Editor' },
    'editor.gotoSymbol': { label: 'Go to Symbol...', category: 'Editor' },
    'editor.fold': { label: 'Fold Region', category: 'Editor' },
    'editor.unfold': { label: 'Unfold Region', category: 'Editor' },
    'editor.foldAll': { label: 'Fold All Regions', category: 'Editor' },
    'editor.unfoldAll': { label: 'Unfold All Regions', category: 'Editor' },
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
      await proc.exited;
    } catch {
      // Silently fail - internal clipboard still works
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
      await proc.exited;
      return output;
    } catch {
      return null;
    }
  }

  /**
   * Cut selected text to clipboard.
   */
  private async editCut(): Promise<void> {
    const element = this.window.getFocusedElement();
    if (!(element instanceof DocumentEditor)) return;

    const text = element.getSelectedText();
    if (!text) return;

    // Copy to clipboard
    this.clipboard = text;
    await this.copyToSystemClipboard(text);

    // Delete the selection - deleteBackward handles this when there's a selection
    element.deleteBackward();
    this.scheduleRender();
  }

  /**
   * Copy selected text to clipboard.
   */
  private async editCopy(): Promise<void> {
    const element = this.window.getFocusedElement();
    if (!(element instanceof DocumentEditor)) return;

    const text = element.getSelectedText();
    if (!text) return;

    // Copy to clipboard
    this.clipboard = text;
    await this.copyToSystemClipboard(text);
  }

  /**
   * Paste text from clipboard.
   */
  private async editPaste(): Promise<void> {
    const element = this.window.getFocusedElement();
    if (!(element instanceof DocumentEditor)) return;

    // Try system clipboard first, fall back to internal
    const text = await this.pasteFromSystemClipboard() || this.clipboard;
    if (!text) return;

    element.insertText(text);
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
      terminals: terminals.length > 0 ? terminals : undefined,
      aiChats: aiChats.length > 0 ? aiChats : undefined,
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
    if (!(element instanceof DocumentEditor)) {
      debugLog('[TUIClient] No document editor focused for completion');
      return;
    }

    // Get the text to insert
    const insertText = item.insertText ?? item.label;

    // Get the current cursor position
    const cursors = element.getCursors();
    if (cursors.length === 0) return;

    const cursor = cursors[0]!;
    const line = cursor.position.line;
    const column = cursor.position.column;

    // Calculate the range to replace (from startColumn to current column)
    const deleteLength = column - startColumn;

    if (deleteLength > 0) {
      // Delete the typed prefix first
      for (let i = 0; i < deleteLength; i++) {
        element.deleteBackward();
      }
    }

    // Insert the completion text
    element.insertText(insertText);

    debugLog(`[TUIClient] Applied completion: "${insertText}" (replaced ${deleteLength} chars)`);
    this.scheduleRender();
  }

  /**
   * Get the current document info for LSP.
   */
  private getCurrentEditorInfo(): {
    uri: string;
    position: { line: number; character: number };
    screenX: number;
    screenY: number;
  } | null {
    const element = this.window.getFocusedElement();
    if (!(element instanceof DocumentEditor)) {
      return null;
    }

    const uri = element.getUri();
    if (!uri) return null;

    const cursor = element.getPrimaryCursor();
    const bounds = element.getBounds();

    // Calculate screen position from cursor
    // The cursor position is relative to the document, not the screen
    const screenX = bounds.x + element.getGutterWidth() + cursor.position.column - element.getScrollLeft();
    const screenY = bounds.y + cursor.position.line - element.getScrollTop();

    return {
      uri,
      position: {
        line: cursor.position.line,
        character: cursor.position.column,
      },
      screenX,
      screenY,
    };
  }

  /**
   * Show hover information at current cursor position.
   */
  private async lspShowHover(): Promise<void> {
    if (!this.lspIntegration) return;

    const info = this.getCurrentEditorInfo();
    if (!info) {
      this.window.showNotification('No editor focused', 'info');
      return;
    }

    await this.lspIntegration.showHover(info.uri, info.position, info.screenX, info.screenY);
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
    if (!this.lspIntegration) return;

    const element = this.window.getFocusedElement();
    if (!(element instanceof DocumentEditor)) return;

    const info = this.getCurrentEditorInfo();
    if (!info) return;

    // Calculate prefix and startColumn
    const line = element.getLines()[info.position.line];
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
