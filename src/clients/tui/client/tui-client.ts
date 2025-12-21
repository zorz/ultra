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

    // Split for main editor area
    const editorPaneId = container.split('horizontal', sidePane.id);
    this.editorPaneId = editorPaneId;

    // Load file tree
    if (fileTree) {
      await this.loadFileTree(fileTree);
    }

    // Load git status
    if (gitPanel) {
      await this.loadGitStatus(gitPanel);
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
      onExpand: async (path, expanded) => {
        if (expanded) {
          // Load children when expanding - would reload from service
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
      onContentChange: async () => {
        // Sync changes to document service
        // Note: In a full implementation, we'd use incremental edits
      },
      onSave: () => {
        this.saveCurrentDocument();
      },
    };
    editor.setCallbacks(callbacks);
    editor.setUri(uri);
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
        if (editor && options.focus !== false) {
          this.window.focusElement(editor);
        }
        return editor;
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
      const status = await gitCliService.status(this.workingDirectory);

      // Map service GitStatus to GitPanel's GitState
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
