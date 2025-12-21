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
  registerBuiltinElements,
  type FileNode,
  type DocumentEditorCallbacks,
  type FileTreeCallbacks,
  type GitPanelCallbacks,
  type TerminalSessionCallbacks,
} from '../elements/index.ts';
import type { Pane } from '../layout/pane.ts';

// Debug utilities
import { debugLog, isDebugEnabled } from '../../../debug.ts';

// Config
import { TUIConfigManager, createTUIConfigManager } from '../config/index.ts';
import { defaultThemes } from '../../../config/defaults.ts';

// Services
import { localDocumentService, type DocumentService } from '../../../services/document/index.ts';
import { fileService, type FileService } from '../../../services/file/index.ts';
import { gitCliService } from '../../../services/git/index.ts';

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

  /** Open documents by URI -> editor mapping */
  private openDocuments = new Map<string, { documentId: string; editorId: string }>();

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
      onFocusChange: (_prevElemId, _nextElemId, _prevPaneId, _nextPaneId) => {
        // Look up the focused element and update status bar
        const focusedElement = this.window.getFocusedElement();
        this.handleFocusChange(focusedElement);
      },
    };
    this.window = createWindow(windowConfig);

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

    // Apply theme from config
    const themeName = this.configManager.get('workbench.colorTheme') ?? 'catppuccin-frappe';
    this.theme = this.loadThemeColors(themeName);
    this.log(`Theme: ${themeName}`);

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

    // Stop input handler
    this.inputHandler.stop();

    // Stop window
    this.window.stop();

    // Cleanup renderer
    this.renderer.cleanup();

    // Close all documents
    for (const [, { documentId }] of this.openDocuments) {
      await this.documentService.close(documentId);
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
        this.window.showNotification('Commit dialog not yet implemented', 'info');
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
    const callbacks: DocumentEditorCallbacks = {
      onContentChange: () => {
        // Update status bar (dirty indicator may change)
        this.updateStatusBarFile(editor);
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
      const pane = this.getEditorPane();
      if (pane) {
        const editor = pane.getElement(existing.editorId) as DocumentEditor | null;
        if (editor) {
          // Editor still exists, just focus it
          if (options.focus !== false) {
            this.window.focusElement(editor);
          }
          return editor;
        }
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

      // Get or create editor pane
      const pane = this.getEditorPane();
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

      // Track open document
      this.openDocuments.set(uri, { documentId: result.documentId, editorId });

      // Focus if requested
      if (options.focus !== false) {
        this.window.focusElement(editor);
      }

      // Update status bar with file info
      this.updateStatusBarFile(editor);

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
          this.documentService.close(doc.documentId).catch((err) => {
            this.log(`Failed to close document: ${err}`);
          });
          this.openDocuments.delete(uri);
        }
      }
    }
  }

  /**
   * Get the editor pane.
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
      this.window.handleInput(event);
    });

    // Route mouse events to window
    this.inputHandler.onMouse((event) => {
      this.window.handleInput(event);
    });

    // Handle resize - callback receives width and height separately
    this.inputHandler.onResize((width, height) => {
      this.handleResize({ width, height });
    });
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
    this.commandHandlers.set('workbench.quickOpen', () => {
      this.window.showNotification('Quick open not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('workbench.commandPalette', () => {
      this.window.showNotification('Command palette not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('editor.gotoLine', () => {
      this.window.showNotification('Go to line not yet implemented', 'info');
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
      this.window.showNotification('Terminal toggle not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('workbench.splitEditor', () => {
      this.window.splitPane('vertical');
      this.window.showNotification('Editor split', 'info');
      return true;
    });

    this.commandHandlers.set('workbench.openSettings', () => {
      this.window.showNotification('Settings dialog not yet implemented', 'info');
      return true;
    });

    // Terminal commands
    this.commandHandlers.set('terminal.new', () => {
      this.window.showNotification('New terminal not yet implemented', 'info');
      return true;
    });

    // Git commands
    this.commandHandlers.set('git.focusPanel', () => {
      this.focusGitPanel();
      return true;
    });

    // App commands
    this.commandHandlers.set('workbench.quit', () => {
      this.stop();
      return true;
    });

    // Folding commands
    this.commandHandlers.set('editor.fold', () => {
      this.window.showNotification('Fold not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('editor.unfold', () => {
      this.window.showNotification('Unfold not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('editor.foldAll', () => {
      this.window.showNotification('Fold all not yet implemented', 'info');
      return true;
    });

    this.commandHandlers.set('editor.unfoldAll', () => {
      this.window.showNotification('Unfold all not yet implemented', 'info');
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
