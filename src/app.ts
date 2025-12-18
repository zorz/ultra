/**
 * Main Application Orchestrator
 * 
 * Coordinates all components and handles the main application lifecycle.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Document } from './core/document.ts';
import { type Position } from './core/buffer.ts';
import { hasSelection } from './core/cursor.ts';
import { renderer, type RenderContext } from './ui/renderer.ts';
import { layoutManager } from './ui/layout.ts';
import { mouseManager, type MouseEvent as UltraMouseEvent } from './ui/mouse.ts';
import { paneManager } from './ui/components/pane-manager.ts';
import { statusBar } from './ui/components/status-bar.ts';
import { filePicker } from './ui/components/file-picker.ts';
import { fileBrowser } from './ui/components/file-browser.ts';
import { commandPalette } from './ui/components/command-palette.ts';
import { fileTree } from './ui/components/file-tree.ts';
import { searchWidget } from './ui/components/search-widget.ts';
import { inputDialog } from './ui/components/input-dialog.ts';
import { commitDialog } from './ui/components/commit-dialog.ts';
import { saveBrowser } from './ui/components/save-browser.ts';
import { commandRegistry } from './input/commands.ts';
import { keymap, type ParsedKey } from './input/keymap.ts';
import { settings } from './config/settings.ts';
import { userConfigManager } from './config/user-config.ts';
import { type KeyEvent, type MouseEventData } from './terminal/index.ts';
import { themeLoader } from './ui/themes/theme-loader.ts';
import { shouldAutoPair, shouldSkipClosing, shouldDeletePair } from './core/auto-pair.ts';
import { lspManager, autocompletePopup, hoverTooltip, signatureHelp, diagnosticsRenderer } from './features/lsp/index.ts';
import { terminalPane } from './ui/components/terminal-pane.ts';
import { gitIntegration } from './features/git/git-integration.ts';
import { gitPanel } from './ui/components/git-panel.ts';
// Import boot file content directly (Bun embeds this at build time)
import defaultBootFile from '../config/BOOT.md' with { type: 'text' };
import { setDebugEnabled } from './debug.ts';

// Helper function to ensure boot file exists
async function ensureBootFile(bootFilePath: string): Promise<void> {
  try {
    // Expand ~ to home directory
    const expandedPath = bootFilePath.replace(/^~/, os.homedir());
    const dir = path.dirname(expandedPath);

    // Create ~/.ultra directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create boot file if it doesn't exist
    if (!fs.existsSync(expandedPath)) {
      fs.writeFileSync(expandedPath, defaultBootFile, 'utf-8');
    }
  } catch (error) {
    // Silently fail - we'll fall back to empty file
    console.error('Failed to create boot file:', error);
  }
}

interface OpenDocument {
  id: string;
  document: Document;
}

interface Tab {
  id: string;
  fileName: string;
  filePath: string | null;
  isDirty: boolean;
  isActive: boolean;
}

export class App {
  private documents: OpenDocument[] = [];
  private activeDocumentId: string | null = null;
  private isRunning: boolean = false;
  private clipboard: string = '';
  private lspEnabled: boolean = true;
  private completionTriggerTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  
  // File watching
  private fileWatchers = new Map<string, { watcher: ReturnType<typeof Bun.file>; lastModTime: number }>();
  private fileWatchInterval: ReturnType<typeof setInterval> | null = null;
  
  // Git integration
  private gitStatusInterval: ReturnType<typeof setInterval> | null = null;
  private lastGitBranch: string | null = null;
  
  // External change notification state
  private externalChangeDialog: {
    isOpen: boolean;
    documentId: string | null;
    fileName: string;
  } = { isOpen: false, documentId: null, fileName: '' };
  
  // Close confirmation dialog state
  private closeConfirmDialog: {
    isOpen: boolean;
    documentId: string | null;
    fileName: string;
  } = { isOpen: false, documentId: null, fileName: '' };

  // Debug logging
  private debugEnabled: boolean = false;
  
  private debugLog(msg: string): void {
    if (this.debugEnabled) {
      const fs = require('fs');
      fs.appendFileSync('debug.log', `[${new Date().toISOString()}] ${msg}\n`);
    }
  }

  constructor() {
    this.setupPaneManagerCallbacks();
    this.setupTerminalCallbacks();
  }

  /**
   * Initialize and start the application
   */
  async start(filePath?: string, options?: { debug?: boolean }): Promise<void> {
    try {
      // Enable debug logging if requested
      if (options?.debug) {
        this.debugEnabled = true;
        setDebugEnabled(true);
        lspManager.setDebugEnabled(true);
        // Clear previous debug log
        const fs = require('fs');
        fs.writeFileSync('debug.log', '');
      }

      this.debugLog('Starting Ultra...');

      // Load configuration
      this.debugLog('Loading configuration...');
      await this.loadConfiguration();

      // Initialize renderer
      this.debugLog('Initializing renderer...');
      await renderer.init();

      // Update layout dimensions
      this.debugLog(`Updating layout: ${renderer.width}x${renderer.height}`);
      layoutManager.updateDimensions(renderer.width, renderer.height);

      // Setup event handlers
      this.debugLog('Setting up event handlers...');
      this.setupKeyboardHandler();
      this.setupMouseHandler();
      this.setupRenderCallback();

      // Register commands
      this.debugLog('Registering commands...');
      this.registerCommands();
      
      // Determine workspace root and file to open based on argument
      this.debugLog('Determining workspace root...');
      let workspaceRoot = process.cwd();
      let fileToOpen: string | undefined;
      
      if (filePath) {
        const absolutePath = path.resolve(filePath);
        const fs = await import('fs');
        
        try {
          const stat = fs.statSync(absolutePath);
          if (stat.isDirectory()) {
            // Argument is a directory - use it as workspace root
            workspaceRoot = absolutePath;
          } else if (stat.isFile()) {
            // Argument is a file - use its parent as workspace root
            workspaceRoot = path.dirname(absolutePath);
            fileToOpen = absolutePath;
          }
        } catch {
          // Path doesn't exist yet - treat as new file
          // Use parent directory as workspace root
          workspaceRoot = path.dirname(absolutePath);
          fileToOpen = absolutePath;
        }
      }
      
      // Initialize file tree with workspace root
      this.debugLog(`Loading file tree from: ${workspaceRoot}`);
      await fileTree.loadDirectory(workspaceRoot);
      fileTree.onFileSelect(async (filePath) => {
        await this.openFile(filePath);
        fileTree.setFocused(false);
        renderer.scheduleRender();
      });
      fileTree.onFocus(() => {
        // Unfocus other components when file tree gains focus
        gitPanel.setFocused(false);
        terminalPane.setFocused(false);
      });

      // Set up git panel callbacks
      gitPanel.onFileSelect(async (filePath) => {
        const fullPath = path.join(workspaceRoot, filePath);
        await this.openFile(fullPath);
        gitPanel.setFocused(false);
        renderer.scheduleRender();
      });
      gitPanel.onRefresh(() => {
        renderer.scheduleRender();
      });
      gitPanel.onFocus(() => {
        // Unfocus other components when git panel gains focus
        fileTree.setFocused(false);
        terminalPane.setFocused(false);
      });
      gitPanel.onCommitRequest(() => {
        this.showCommitDialog();
      });

      // Initialize LSP manager with workspace root
      this.debugLog('Initializing LSP...');
      lspManager.setWorkspaceRoot(workspaceRoot);
      await this.initializeLSP();

      // Initialize Git integration with workspace root (must be before applySettings)
      this.debugLog('Initializing Git...');
      gitIntegration.setWorkspaceRoot(workspaceRoot);
      this.startGitStatusPolling();

      // Apply initial settings (sidebar visibility, etc.)
      this.debugLog('Applying settings...');
      this.applySettings();

      // Start file watcher
      this.debugLog('Starting file watcher...');
      this.startFileWatcher();

      // Open file if provided, otherwise check startup setting
      this.debugLog(`Opening: ${fileToOpen || 'checking startup setting'}`);
      if (fileToOpen) {
        // File provided via command line - open it
        await this.openFile(fileToOpen);
      } else {
        // No file provided - check workbench.startupEditor setting
        const startupEditor = settings.get('workbench.startupEditor') || '';
        this.debugLog(`startupEditor setting: "${startupEditor}"`);

        if (startupEditor === '' || startupEditor === 'none') {
          // User wants to start with empty editor
          this.debugLog('Opening empty editor (setting is empty or "none")');
          this.newFile();
        } else {
          // Open the configured startup file
          this.debugLog(`Will try to open startup file: ${startupEditor}`);
          try {
            // Expand ~ to home directory
            const expandedPath = startupEditor.replace(/^~/, os.homedir());
            this.debugLog(`Expanded path: ${expandedPath}`);

            // Ensure boot file exists if it's the default one
            if (startupEditor === '~/.ultra/BOOT.md') {
              this.debugLog('Ensuring boot file exists...');
              await ensureBootFile(startupEditor);
              this.debugLog('Boot file ensured');
            }

            // Open the file
            this.debugLog(`Calling openFile: ${expandedPath}`);
            await this.openFile(expandedPath);

            // Check if a document was actually opened
            if (this.documents.length === 0) {
              this.debugLog('No document opened, falling back to empty');
              this.newFile();
            } else {
              this.debugLog('File opened successfully');
            }
          } catch (error) {
            // Failed to open startup file - fall back to empty document
            this.debugLog(`Failed to open startup file: ${error}`);
            this.newFile();
          }
        }
      }

      this.debugLog('Setting isRunning = true');
      this.isRunning = true;

      // Initial render
      this.debugLog('Scheduling initial render...');
      renderer.scheduleRender();
      
      this.debugLog('Start complete!');

    } catch (error) {
      renderer.cleanup();
      console.error('Failed to start Ultra:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the application
   */
  stop(): void {
    this.isRunning = false;
    userConfigManager.destroy();
    fileTree.destroy();

    // Stop file watcher
    this.stopFileWatcher();

    // Stop git polling
    this.stopGitStatusPolling();

    // Shutdown LSP servers
    lspManager.shutdown();

    renderer.cleanup();
  }

  /** Exit code used to signal restart to wrapper script */
  static readonly RESTART_EXIT_CODE = 75;

  /**
   * Restart the application by cleaning up and exiting with RESTART_EXIT_CODE.
   * The wrapper script should detect this exit code and relaunch the app.
   */
  restart(): void {
    this.stop();
    process.exit(App.RESTART_EXIT_CODE);
  }

  /**
   * Initialize LSP support
   */
  private async initializeLSP(): Promise<void> {
    // Set up diagnostic callback
    lspManager.onDiagnostics((uri, diagnostics) => {
      diagnosticsRenderer.setDiagnostics(uri, diagnostics);
      this.updateStatusBar();
      renderer.scheduleRender();
    });

    // Set up autocomplete callbacks
    autocompletePopup.onSelect(async (item) => {
      const doc = this.getActiveDocument();
      if (!doc) return;

      try {
        // Insert the completion text
        // TODO: Handle more complex completions (snippets, additional edits)
        const textToInsert = item.insertText || item.label;
        
        // Get prefix info before any modifications
        const startColumn = autocompletePopup.getStartColumn();
        const cursor = doc.primaryCursor;
        const currentColumn = cursor.position.column;
        const prefixLength = currentColumn - startColumn;
        
        if (prefixLength > 0 && startColumn >= 0) {
          // Move cursor to start of prefix and delete the prefix
          for (let i = 0; i < prefixLength; i++) {
            doc.moveLeft();
          }
          for (let i = 0; i < prefixLength; i++) {
            doc.delete();
          }
        }
        
        // Insert the completion
        doc.insert(textToInsert);
        paneManager.ensureCursorVisible();
        this.updateStatusBar();
        this.notifyDocumentChange(doc);
        renderer.scheduleRender();
      } catch (error) {
        console.error('Autocomplete error:', error);
        statusBar.setMessage(`Autocomplete error: ${error}`, 3000);
      }
    });

    autocompletePopup.onDismiss(() => {
      renderer.scheduleRender();
    });
  }

  /**
   * Load configuration files
   */
  private async loadConfiguration(): Promise<void> {
    // Initialize user config manager (creates ~/.ultra if needed, loads config, watches for changes)
    await userConfigManager.init();
    
    // Set up hot-reload callback
    userConfigManager.onReload(() => {
      // Re-apply any settings that affect the UI
      this.applySettings();
      renderer.scheduleRender();
    });
  }

  /**
   * Apply current settings to the UI
   */
  private applySettings(): void {
    // Handle sidebar location
    const sidebarLocation = settings.get('workbench.sideBar.location') || 'left';
    layoutManager.setSidebarLocation(sidebarLocation);
    
    // Handle sidebar visibility changes
    const sidebarShouldBeVisible = settings.get('workbench.sideBar.visible');
    const sidebarIsVisible = layoutManager.isSidebarVisible();
    
    if (sidebarShouldBeVisible && !sidebarIsVisible) {
      layoutManager.toggleSidebar(settings.get('ultra.sidebar.width') || 30);
    } else if (!sidebarShouldBeVisible && sidebarIsVisible) {
      layoutManager.toggleSidebar();
    }
    
    // Update sidebar width if visible
    if (layoutManager.isSidebarVisible()) {
      layoutManager.setSidebarWidth(settings.get('ultra.sidebar.width') || 30);
      // Ensure file tree is visible when sidebar is visible
      fileTree.setVisible(true);
    }
    
    // Handle git panel visibility on startup
    if (settings.get('git.panel.openOnStartup')) {
      gitPanel.setVisible(true);
    }
    
    // Handle terminal visibility on startup
    if (settings.get('terminal.integrated.openOnStartup')) {
      if (!layoutManager.isTerminalVisible()) {
        const position = settings.get('terminal.integrated.position') || 'bottom';
        const size = position === 'bottom' || position === 'top' 
          ? settings.get('terminal.integrated.defaultHeight') || 12
          : settings.get('terminal.integrated.defaultWidth') || 40;
        layoutManager.toggleTerminal(size);
      }
      
      // Spawn a terminal shell if configured
      if (settings.get('terminal.integrated.spawnOnStartup')) {
        terminalPane.createTerminal();
      }
    }
  }

  /**
   * Setup keyboard event handler
   */
  private setupKeyboardHandler(): void {
    renderer.onKey(async (event: KeyEvent) => {
      if (!this.isRunning) return;

      // Handle save browser first if it's open
      if (saveBrowser.isOpen()) {
        saveBrowser.handleKey(event.key, event.char, event.ctrl, event.shift);
        renderer.scheduleRender();
        return;
      }

      // Handle external change dialog
      if (this.externalChangeDialog.isOpen) {
        if (this.handleExternalChangeDialog(event.key)) {
          return;
        }
        // Consume all other keys while dialog is open
        renderer.scheduleRender();
        return;
      }

      // Handle close confirmation dialog
      if (this.closeConfirmDialog.isOpen) {
        if (event.key === 'S') {
          await this.handleCloseConfirmResponse('save');
          return;
        }
        if (event.key === 'D') {
          await this.handleCloseConfirmResponse('discard');
          return;
        }
        if (event.key === 'C' || event.key === 'ESCAPE') {
          await this.handleCloseConfirmResponse('cancel');
          return;
        }
        // Consume all other keys while dialog is open
        renderer.scheduleRender();
        return;
      }

      // Handle autocomplete popup
      if (autocompletePopup.isVisible()) {
        if (autocompletePopup.handleKey(event.key, event.ctrl)) {
          renderer.scheduleRender();
          return;
        }
        // Let typing continue through to normal processing
        // Character input and backspace will update the filter
        // Only dismiss on movement keys (not up/down which are handled above)
        if (['LEFT', 'RIGHT', 'HOME', 'END'].includes(event.key)) {
          autocompletePopup.hide();
        }
      }

      // Handle hover tooltip
      if (hoverTooltip.isVisible()) {
        if (hoverTooltip.handleKey(event.key)) {
          renderer.scheduleRender();
          return;
        }
        // Any movement key hides hover
        if (['UP', 'DOWN', 'LEFT', 'RIGHT', 'ESCAPE'].includes(event.key)) {
          hoverTooltip.hide();
        }
      }

      // Handle signature help tooltip
      if (signatureHelp.isVisible()) {
        if (signatureHelp.handleKey(event.key)) {
          renderer.scheduleRender();
          return;
        }
        // Certain keys dismiss signature help
        if (['ESCAPE'].includes(event.key)) {
          signatureHelp.hide();
        }
      }

      // Handle commit dialog first if it's open
      if (commitDialog.isOpen()) {
        if (commitDialog.handleKey(event)) {
          renderer.scheduleRender();
          return;
        }
        // Consume all other keys while dialog is open
        renderer.scheduleRender();
        return;
      }

      // Handle input dialog first if it's open
      if (inputDialog.isOpen()) {
        if (event.key === 'ESCAPE') {
          inputDialog.cancel();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'ENTER') {
          inputDialog.confirm();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'BACKSPACE') {
          inputDialog.backspace();
          renderer.scheduleRender();
          return;
        }
        // Type into input
        if (event.char && event.char.length === 1 && !event.ctrl && !event.meta) {
          inputDialog.appendChar(event.char);
          renderer.scheduleRender();
          return;
        }
        if (event.key.length === 1 && !event.ctrl && !event.meta && !event.alt) {
          inputDialog.appendChar(event.key.toLowerCase());
          renderer.scheduleRender();
          return;
        }
        // Consume all other keys while dialog is open
        renderer.scheduleRender();
        return;
      }

      // Handle file picker input first if it's open
      if (filePicker.isOpen()) {
        if (event.key === 'ESCAPE') {
          filePicker.hide();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'ENTER') {
          filePicker.confirm();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'UP' || (event.ctrl && event.key === 'P')) {
          filePicker.selectPrevious();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'DOWN' || (event.ctrl && event.key === 'N')) {
          filePicker.selectNext();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'BACKSPACE') {
          filePicker.backspaceQuery();
          renderer.scheduleRender();
          return;
        }
        // Type into search
        if (event.char && event.char.length === 1 && !event.ctrl && !event.meta) {
          filePicker.appendToQuery(event.char);
          renderer.scheduleRender();
          return;
        }
        if (event.key.length === 1 && !event.ctrl && !event.meta && !event.alt) {
          filePicker.appendToQuery(event.key.toLowerCase());
          renderer.scheduleRender();
          return;
        }
        // Consume all other keys while picker is open
        renderer.scheduleRender();
        return;
      }

      // Handle command palette input if it's open
      if (commandPalette.isOpen()) {
        if (event.key === 'ESCAPE') {
          commandPalette.hide();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'ENTER') {
          await commandPalette.confirm();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'UP' || (event.ctrl && event.key === 'P')) {
          commandPalette.selectPrevious();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'DOWN' || (event.ctrl && event.key === 'N')) {
          commandPalette.selectNext();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'BACKSPACE') {
          commandPalette.backspaceQuery();
          renderer.scheduleRender();
          return;
        }
        // Type into search
        if (event.char && event.char.length === 1 && !event.ctrl && !event.meta) {
          commandPalette.appendToQuery(event.char);
          renderer.scheduleRender();
          return;
        }
        if (event.key.length === 1 && !event.ctrl && !event.meta && !event.alt) {
          commandPalette.appendToQuery(event.key.toLowerCase());
          renderer.scheduleRender();
          return;
        }
        // Consume all other keys while palette is open
        renderer.scheduleRender();
        return;
      }

      // Handle search widget input if visible
      if (searchWidget.visible) {
        if (searchWidget.handleKey(event)) {
          renderer.scheduleRender();
          return;
        }
      }

      // Handle file browser input if it's open
      if (fileBrowser.isOpen()) {
        if (event.key === 'ESCAPE') {
          fileBrowser.hide();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'ENTER') {
          fileBrowser.enter();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'UP' || (event.ctrl && event.key === 'P')) {
          fileBrowser.selectPrevious();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'DOWN' || (event.ctrl && event.key === 'N')) {
          fileBrowser.selectNext();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'LEFT' || event.key === 'BACKSPACE') {
          fileBrowser.goUp();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'RIGHT') {
          fileBrowser.enter();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'PAGEUP') {
          fileBrowser.pageUp();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'PAGEDOWN') {
          fileBrowser.pageDown();
          renderer.scheduleRender();
          return;
        }
        if (event.key === 'H' || event.key === 'h') {
          fileBrowser.toggleHidden();
          renderer.scheduleRender();
          return;
        }
        // Consume all other keys while browser is open
        renderer.scheduleRender();
        return;
      }

      // Handle inline diff input if visible in active pane
      const activePane = paneManager.getActivePane();
      if (activePane.isInlineDiffVisible()) {
        const handled = activePane.handleInlineDiffKey(event.key, event.ctrl, event.shift);
        if (handled) {
          renderer.scheduleRender();
          return;
        }
      }

      // Handle git panel input if it's focused
      if (gitPanel.getFocused() && gitPanel.isOpen()) {
        // Allow Ctrl+Shift+G to toggle git panel even when focused
        if (event.ctrl && event.shift && event.key === 'G') {
          gitPanel.setVisible(false);
          gitPanel.setFocused(false);
          fileTree.setVisible(true);
          renderer.scheduleRender();
          return;
        }
        
        const handled = await gitPanel.handleKey(event.key, event.ctrl, event.shift, event.char);
        if (handled) {
          renderer.scheduleRender();
          return;
        }
      }

      // Handle file tree input if it's focused
      if (fileTree.getFocused()) {
        const handled = await fileTree.handleKey(event.key, event.ctrl, event.shift, event.char);
        if (handled) {
          renderer.scheduleRender();
          return;
        }
      }

      // Handle terminal input if it's focused
      if (terminalPane.getFocused() && layoutManager.isTerminalVisible()) {
        // Allow Ctrl+` to toggle terminal even when focused
        if (event.ctrl && event.key === '`') {
          layoutManager.toggleTerminal(settings.get('terminal.integrated.defaultHeight'));
          terminalPane.setFocused(false);
          renderer.scheduleRender();
          return;
        }
        
        // Pass key to terminal (with char for proper case)
        const handled = terminalPane.handleKeyEvent(
          event.key,
          event.char,
          event.ctrl,
          event.alt,
          event.shift
        );
        
        renderer.scheduleRender();
        return;
      }

      // Convert our KeyEvent to ParsedKey format
      const parsed: ParsedKey = {
        ctrl: event.ctrl,
        alt: event.alt,
        shift: event.shift,
        meta: event.meta,
        key: event.key.toLowerCase()
      };

      // Check for macOS Option+key characters (our input handler already sets alt)
      const keyStr = keymap.keyToString(parsed);

      // Check for command binding
      const commandId = keymap.getCommand(parsed);
      
      // DEBUG: Show in status bar what key was pressed
      const debugInfo = `${event.ctrl?'C':''}${event.shift?'S':''}${event.alt?'A':''}${event.meta?'M':''}+${event.key}`;
      statusBar.setMessage(`Key: ${debugInfo} | Parsed: ${keyStr} -> ${commandId || 'none'}`, 2000);
      
      if (commandId) {
        await commandRegistry.execute(commandId);
        renderer.scheduleRender();
        return;
      }

      // Handle character input
      if (this.shouldInsertKey(event)) {
        this.insertCharacter(event.char || event.key);
      }
      
      // Always render to show debug message
      renderer.scheduleRender();
    });
  }

  /**
   * Check if a key should be inserted as character
   */
  private shouldInsertKey(event: KeyEvent): boolean {
    // Don't insert control characters
    if (event.ctrl || event.meta) return false;
    
    // Only insert printable characters (have a char property or single key)
    if (event.char && event.char.length === 1) return true;
    if (event.key.length === 1 && !event.alt) return true;
    
    return false;
  }

  /**
   * Insert a character with auto-pairing support
   */
  private insertCharacter(char: string): void {
    const doc = this.getActiveDocument();
    if (!doc) return;

    // Use auto-dedent for closing brackets
    if (char === '}' || char === ']' || char === ')') {
      doc.insertWithAutoDedent(char);
      paneManager.ensureCursorVisible();
      this.updateStatusBar();
      this.notifyDocumentChange(doc);
      return;
    }

    // Simple auto-pairing for opening brackets only
    const pairs: Record<string, string> = {
      '{': '}',
      '[': ']',
      '(': ')',
      '"': '"',
      "'": "'",
      '`': '`',
    };
    
    const closingChar = pairs[char];
    if (closingChar) {
      doc.insert(char + closingChar);
      doc.moveLeft();
    } else {
      doc.insert(char);
    }
    
    paneManager.ensureCursorVisible();
    this.updateStatusBar();
    this.notifyDocumentChange(doc);
    
    // Trigger signature help on ( and ,
    if (char === '(' || char === ',') {
      this.triggerSignatureHelp();
    }
    // Hide signature help on )
    if (char === ')') {
      signatureHelp.hide();
    }
    
    // Trigger completion on certain characters (immediate)
    if (char === '.' || char === ':' || char === '<' || char === '/' || char === '@') {
      this.triggerCompletion();
    } else if (this.isIdentifierChar(char)) {
      // Trigger completion while typing identifiers
      this.triggerIdentifierCompletion();
    } else {
      // Non-identifier character dismisses autocomplete
      autocompletePopup.hide();
    }
  }

  /**
   * Check if character is valid in an identifier
   */
  private isIdentifierChar(char: string): boolean {
    return /[a-zA-Z0-9_$]/.test(char);
  }

  /**
   * Get the word prefix at the current cursor position
   */
  private getWordPrefixAtCursor(doc: Document): { prefix: string; startColumn: number } {
    const cursor = doc.primaryCursor;
    const line = doc.getLine(cursor.position.line);
    const col = cursor.position.column;
    
    // Walk backwards to find the start of the identifier
    let startCol = col;
    while (startCol > 0 && this.isIdentifierChar(line[startCol - 1] ?? '')) {
      startCol--;
    }
    
    const prefix = line.substring(startCol, col);
    return { prefix, startColumn: startCol };
  }

  /**
   * Trigger completion for identifier typing
   */
  private async triggerIdentifierCompletion(): Promise<void> {
    const doc = this.getActiveDocument();
    if (!doc || !doc.filePath) return;

    const { prefix, startColumn } = this.getWordPrefixAtCursor(doc);
    
    // Need at least 1 character to trigger
    if (prefix.length < 1) {
      autocompletePopup.hide();
      return;
    }

    // If autocomplete is already visible, just update the filter
    if (autocompletePopup.isVisible()) {
      autocompletePopup.updatePrefix(prefix);
      renderer.scheduleRender();
      return;
    }

    // Otherwise, trigger a new completion request
    this.triggerCompletion(prefix, startColumn);
  }

  /**
   * Notify LSP of document change
   */
  private notifyDocumentChange(doc: Document): void {
    if (!this.lspEnabled || !doc.filePath) return;
    
    const uri = `file://${doc.filePath}`;
    lspManager.changeDocument(uri, doc.content);
  }

  /**
   * Trigger completion popup
   */
  private async triggerCompletion(prefix: string = '', startColumn?: number): Promise<void> {
    const doc = this.getActiveDocument();
    if (!doc || !doc.filePath) return;

    // Capture filePath for closure
    const filePath = doc.filePath;

    // Clear any pending trigger
    if (this.completionTriggerTimer) {
      clearTimeout(this.completionTriggerTimer);
    }

    // Get prefix info if not provided
    if (startColumn === undefined) {
      const prefixInfo = this.getWordPrefixAtCursor(doc);
      prefix = prefixInfo.prefix;
      startColumn = prefixInfo.startColumn;
    }

    // Small delay to allow typing to settle (250ms to reduce request spam)
    this.completionTriggerTimer = setTimeout(async () => {
      const cursor = doc.primaryCursor;

      try {
        const completions = await lspManager.getCompletions(
          filePath,
          cursor.position.line,
          cursor.position.column
        );

        if (completions && completions.length > 0) {
          // Calculate screen position for popup (at start of prefix)
          const editorRect = layoutManager.getEditorAreaRect();
          const gutterWidth = 5;  // Approximate
          const screenX = editorRect.x + gutterWidth + startColumn - paneManager.getScrollLeft();
          const screenY = editorRect.y + cursor.position.line - paneManager.getScrollTop();
          
          autocompletePopup.show(completions, screenX, screenY, prefix, startColumn);
          renderer.scheduleRender();
        }
      } catch (err) {
        // Silently fail - completion is not critical
      }
    }, 250);
  }

  /**
   * Trigger signature help popup
   */
  private async triggerSignatureHelp(): Promise<void> {
    const doc = this.getActiveDocument();
    if (!doc || !doc.filePath) return;

    const cursor = doc.primaryCursor;
    
    try {
      const help = await lspManager.getSignatureHelp(
        doc.filePath,
        cursor.position.line,
        cursor.position.column
      );

      if (help && help.signatures && help.signatures.length > 0) {
        // Calculate screen position
        const editorRect = layoutManager.getEditorAreaRect();
        const gutterWidth = 5;
        const screenX = editorRect.x + gutterWidth + cursor.position.column - paneManager.getScrollLeft();
        const screenY = editorRect.y + cursor.position.line - paneManager.getScrollTop();
        
        signatureHelp.show(help, screenX, screenY);
        renderer.scheduleRender();
      }
    } catch (err) {
      // Silently fail
    }
  }

  /**
   * Go to definition at cursor
   */
  private async goToDefinition(): Promise<void> {
    const doc = this.getActiveDocument();
    if (!doc || !doc.filePath) return;

    const cursor = doc.primaryCursor;

    try {
      const result = await lspManager.getDefinition(
        doc.filePath,
        cursor.position.line,
        cursor.position.column
      );

      // Normalize to array - LSP can return a single Location or array
      const locations = result ? (Array.isArray(result) ? result : [result]) : [];

      if (locations.length > 0) {
        const location = locations[0]!;
        // Convert URI to file path
        const targetPath = location.uri.replace('file://', '');
        
        // If it's a different file, open it
        if (targetPath !== doc.filePath) {
          await this.openFile(targetPath);
        }
        
        // Move to the position
        const targetDoc = this.getActiveDocument();
        if (targetDoc) {
          targetDoc.cursorManager.setPosition({
            line: location.range.start.line,
            column: location.range.start.character
          });
          paneManager.ensureCursorVisible();
          this.updateStatusBar();
        }
        
        statusBar.setMessage(`Go to definition: ${path.basename(targetPath)}:${location.range.start.line + 1}`, 3000);
      } else {
        statusBar.setMessage('No definition found', 2000);
      }
    } catch (err) {
      statusBar.setMessage('Error finding definition', 2000);
    }
    
    renderer.scheduleRender();
  }

  /**
   * Find all references at cursor
   */
  private async findReferences(): Promise<void> {
    const doc = this.getActiveDocument();
    if (!doc || !doc.filePath) return;

    const cursor = doc.primaryCursor;

    try {
      const locations = await lspManager.getReferences(
        doc.filePath,
        cursor.position.line,
        cursor.position.column
      );

      if (locations && locations.length > 0) {
        // For now, just show count in status bar
        // TODO: Show in a references panel
        statusBar.setMessage(`Found ${locations.length} references`, 3000);
        
        // If only one reference, go to it
        if (locations.length === 1) {
          const location = locations[0]!;
          const targetPath = location.uri.replace('file://', '');
          
          if (targetPath !== doc.filePath) {
            await this.openFile(targetPath);
          }
          
          const targetDoc = this.getActiveDocument();
          if (targetDoc) {
            targetDoc.cursorManager.setPosition({
              line: location.range.start.line,
              column: location.range.start.character
            });
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
          }
        }
      } else {
        statusBar.setMessage('No references found', 2000);
      }
    } catch (err) {
      statusBar.setMessage('Error finding references', 2000);
    }
    
    renderer.scheduleRender();
  }

  /**
   * Show hover information at cursor
   */
  private async showHover(): Promise<void> {
    this.debugLog('[showHover] showHover called');
    
    const doc = this.getActiveDocument();
    if (!doc || !doc.filePath) {
      this.debugLog('[showHover] No document or filePath');
      statusBar.setMessage('No file open', 2000);
      return;
    }

    this.debugLog(`[showHover] Document: ${doc.filePath}, language: ${doc.language}`);
    const cursor = doc.primaryCursor;
    this.debugLog(`[showHover] Cursor: line ${cursor.position.line}, col ${cursor.position.column}`);

    try {
      this.debugLog('[showHover] Calling lspManager.getHover...');
      // Fetch hover and document symbols in parallel
      const [hover, symbols] = await Promise.all([
        lspManager.getHover(
          doc.filePath,
          cursor.position.line,
          cursor.position.column
        ),
        lspManager.getDocumentSymbols(doc.filePath)
      ]);
      this.debugLog(`[showHover] Hover result: ${hover ? JSON.stringify(hover).substring(0, 200) : 'null'}`);
      this.debugLog(`[showHover] Symbols count: ${symbols?.length || 0}`);

      if (hover) {
        // Calculate screen position for tooltip
        const editorRect = layoutManager.getEditorAreaRect();
        const gutterWidth = 5;
        const screenX = editorRect.x + gutterWidth + cursor.position.column - paneManager.getScrollLeft();
        const screenY = editorRect.y + cursor.position.line - paneManager.getScrollTop();
        
        // Pass symbols for additional context
        hoverTooltip.show(hover, screenX, screenY, symbols);
      } else {
        // Show more helpful message about LSP status
        const debugInfo = lspManager.getDebugInfo();
        const hasClient = debugInfo.includes(`${doc.language}:`);
        if (!hasClient) {
          statusBar.setMessage(`No LSP for ${doc.language} (Ctrl+Shift+D for debug)`, 3000);
        } else {
          statusBar.setMessage('No hover information at cursor', 2000);
        }
      }
    } catch (err) {
      this.debugLog(`[showHover] Error: ${err}`);
      statusBar.setMessage(`Hover error: ${err}`, 3000);
    }
    
    renderer.scheduleRender();
  }

  /**
   * Rename symbol at cursor
   */
  private async renameSymbol(): Promise<void> {
    const doc = this.getActiveDocument();
    if (!doc || !doc.filePath) return;

    // Capture filePath for closure
    const filePath = doc.filePath;

    // Get the word under cursor for initial value
    const cursor = doc.primaryCursor;
    const line = doc.getLine(cursor.position.line);
    let start = cursor.position.column;
    let end = cursor.position.column;
    
    // Find word boundaries
    while (start > 0 && this.isWordChar(line[start - 1]!)) start--;
    while (end < line.length && this.isWordChar(line[end]!)) end++;
    
    const currentWord = line.substring(start, end);
    if (!currentWord) {
      statusBar.setMessage('No symbol at cursor', 2000);
      return;
    }

    // Show input dialog for new name
    const editorRect = layoutManager.getEditorAreaRect();
    inputDialog.show({
      title: 'Rename Symbol',
      placeholder: `Enter new name for '${currentWord}'`,
      initialValue: currentWord,
      screenWidth: renderer.width,
      screenHeight: renderer.height,
      editorX: editorRect.x,
      editorWidth: editorRect.width,
      onConfirm: async (newName: string) => {
        if (!newName || newName === currentWord) return;
        
        try {
          const workspaceEdit = await lspManager.rename(
            filePath,
            cursor.position.line,
            cursor.position.column,
            newName
          );

          if (workspaceEdit && workspaceEdit.changes) {
            // Apply edits to each document
            let editCount = 0;
            for (const [editUri, edits] of Object.entries(workspaceEdit.changes)) {
              const editPath = editUri.replace('file://', '');
              
              // Find or open the document
              let targetDoc = this.documents.find(d => d.document.filePath === editPath)?.document;
              if (!targetDoc) {
                await this.openFile(editPath);
                targetDoc = this.getActiveDocument() || undefined;
              }
              
              if (targetDoc) {
                // Apply edits in reverse order to maintain positions
                const sortedEdits = [...edits].sort((a: { range: { start: { line: number; character: number }; end: { line: number; character: number } } }, b: { range: { start: { line: number; character: number }; end: { line: number; character: number } } }) => {
                  if (a.range.start.line !== b.range.start.line) {
                    return b.range.start.line - a.range.start.line;
                  }
                  return b.range.start.character - a.range.start.character;
                });
                
                for (const edit of sortedEdits) {
                  // Select the range
                  targetDoc.cursorManager.setPosition({
                    line: edit.range.start.line,
                    column: edit.range.start.character
                  });
                  targetDoc.cursorManager.setPosition({
                    line: edit.range.end.line,
                    column: edit.range.end.character
                  }, true);
                  
                  // Replace with new text
                  targetDoc.backspace();  // Delete selection
                  targetDoc.insert(edit.newText);
                  editCount++;
                }
              }
            }
            
            statusBar.setMessage(`Renamed ${editCount} occurrences`, 3000);
          } else {
            statusBar.setMessage('No rename edits returned', 2000);
          }
        } catch (err) {
          statusBar.setMessage('Error renaming symbol', 2000);
        }
        
        renderer.scheduleRender();
      }
    });
    
    renderer.scheduleRender();
  }

  /**
   * Smart backspace that deletes both characters of a pair when between them
   */
  private smartBackspace(doc: Document): void {
    // If there's a selection, just do normal backspace (delete selection)
    const cursor = doc.primaryCursor;
    if (cursor.selection && hasSelection(cursor.selection)) {
      doc.backspace();
      return;
    }
    
    const autoClosing = settings.get('editor.autoClosingBrackets');
    if (autoClosing === 'never') {
      doc.backspace();
      return;
    }
    
    // Check if we should delete a pair
    const line = doc.getLine(cursor.position.line);
    const col = cursor.position.column;
    const charBefore = col > 0 ? line[col - 1] : undefined;
    const charAfter = col < line.length ? line[col] : undefined;
    
    if (shouldDeletePair(charBefore, charAfter)) {
      // Delete both the opening and closing character
      doc.backspace();  // Delete char before cursor
      doc.delete();     // Delete char after cursor (now at cursor position)
      return;
    }
    
    doc.backspace();
  }

  /**
   * Setup mouse event handler
   */
  private setupMouseHandler(): void {
    let lastRenderTime = 0;
    let lastEventX = -1;
    let lastEventY = -1;
    let lastEventType = '';
    const MOUSE_THROTTLE_MS = 16; // ~60fps max for continuous mouse events
    
    renderer.onMouse((event: MouseEventData) => {
      if (!this.isRunning) return;

      const now = Date.now();
      
      // For continuous events (move), throttle and skip if position hasn't changed
      if (event.type === 'move') {
        // Skip if position is the same as last event
        if (event.x === lastEventX && event.y === lastEventY && event.type === lastEventType) {
          return;
        }
        // Throttle drag events
        if (now - lastRenderTime < MOUSE_THROTTLE_MS) {
          return;
        }
      }
      
      // Skip duplicate button press events at same position (click & hold artifacts)
      if (event.type === 'press') {
        if (event.x === lastEventX && event.y === lastEventY && event.type === lastEventType &&
            now - lastRenderTime < 100) {
          return;
        }
      }
      
      lastRenderTime = now;
      lastEventX = event.x;
      lastEventY = event.y;
      lastEventType = event.type;

      // Convert to the format expected by mouseManager
      const mouseEventName = this.convertMouseEventType(event);
      
      mouseManager.processEvent(mouseEventName, {
        x: event.x,
        y: event.y,
        shift: event.shift,
        ctrl: event.ctrl,
        alt: event.alt,
        meta: false
      });
      
      // Only render for meaningful events - not pure motion without drag
      const needsRender = event.type === 'press' || 
                          event.type === 'release' || 
                          (event.type === 'move' && event.button !== 'none');  // Only render drag, not pure motion
      if (needsRender) {
        renderer.scheduleRender();
      }
    });

    // Register mouse handlers (order matters - first handlers get priority)
    mouseManager.registerHandler(commitDialog);
    mouseManager.registerHandler(commandPalette);
    mouseManager.registerHandler(fileBrowser);
    mouseManager.registerHandler(filePicker);
    mouseManager.registerHandler(searchWidget);
    mouseManager.registerHandler(terminalPane);  // Terminal pane for embedded terminal
    mouseManager.registerHandler(paneManager);  // Pane manager handles tab bars and editor panes
    mouseManager.registerHandler(gitPanel);     // Git panel for source control
    mouseManager.registerHandler(fileTree);
  }
  
  /**
   * Convert mouse event type to terminal-kit style name for mouseManager
   */
  private convertMouseEventType(event: MouseEventData): string {
    const buttonMap: Record<string, string> = {
      'left': 'LEFT',
      'middle': 'MIDDLE', 
      'right': 'RIGHT'
    };
    
    switch (event.type) {
      case 'press':
        return `MOUSE_${buttonMap[event.button] || 'LEFT'}_BUTTON_PRESSED`;
      case 'release':
        return `MOUSE_${buttonMap[event.button] || 'LEFT'}_BUTTON_RELEASED`;
      case 'move':
        // Check if a button is pressed (drag) vs pure motion
        if (event.button !== 'none') {
          return 'MOUSE_DRAG';
        }
        return 'MOUSE_MOTION';
      case 'wheel':
        return event.button === 'wheelUp' ? 'MOUSE_WHEEL_UP' : 'MOUSE_WHEEL_DOWN';
      default:
        return 'MOUSE_MOTION';
    }
  }

  /**
   * Setup pane manager callbacks
   */
  private setupPaneManagerCallbacks(): void {
    // Handle document selection changes in panes
    paneManager.onActiveDocumentChange((document, pane) => {
      if (document) {
        const docEntry = this.documents.find(d => d.document === document);
        if (docEntry) {
          this.activeDocumentId = docEntry.id;
        }
      }
      this.updateStatusBar();
      renderer.scheduleRender();
    });

    // Handle pane focus changes
    paneManager.onPaneFocus((pane) => {
      const doc = pane.getActiveDocument();
      if (doc) {
        const docEntry = this.documents.find(d => d.document === doc);
        if (docEntry) {
          this.activeDocumentId = docEntry.id;
        }
      }
      this.updateStatusBar();
      renderer.scheduleRender();
    });

    // Handle mouse clicks in documents
    paneManager.onDocumentClick((doc, position, clickCount, event) => {
      // Clicking in editor unfocuses terminal, file tree, and git panel
      terminalPane.setFocused(false);
      fileTree.setFocused(false);
      gitPanel.setFocused(false);
      
      if (event.meta) {
        // Cmd+Click adds cursor
        doc.cursorManager.addCursor(position);
      } else if (event.shift) {
        // Shift+Click extends selection
        doc.cursorManager.setPosition(position, true);
      } else {
        // Normal click - use clickCount from mouse manager
        if (clickCount === 1) {
          doc.cursorManager.setSingle(position);
        } else if (clickCount === 2) {
          // Double click - select word
          this.selectWordAt(position, doc);
        } else if (clickCount === 3) {
          // Triple click - select line
          doc.selectLine();
        }
      }

      paneManager.ensureCursorVisible();
      this.updateStatusBar();
    });

    // Handle document drag
    paneManager.onDocumentDrag((doc, position, event) => {
      // Extend selection while dragging
      if (event.meta) {
        // Cmd+Drag adds selection
        const cursor = doc.primaryCursor;
        if (!cursor.selection) {
          doc.cursorManager.addCursorWithSelection(cursor.position, position);
        }
      } else {
        doc.cursorManager.setPosition(position, true);
      }

      paneManager.ensureCursorVisible();
      this.updateStatusBar();
    });

    // Handle scroll
    paneManager.onDocumentScroll(() => {
      renderer.scheduleRender();
    });

    // Handle tab close requests
    paneManager.onTabCloseRequest((document, pane) => {
      const docEntry = this.documents.find(d => d.document === document);
      if (docEntry) {
        this.requestCloseDocumentInPane(docEntry.id, pane.id);
      }
    });

    // Handle git gutter clicks
    paneManager.onGitGutterClick((line) => {
      this.showGitDiffPopup(line);
    });

    // Handle inline diff stage action
    paneManager.onInlineDiffStage(async (filePath, _line) => {
      const result = await gitIntegration.stageFile(filePath);
      if (result) {
        statusBar.setMessage('Staged file', 2000);
        const pane = paneManager.getActivePane();
        pane.hideInlineDiff();
        await this.updateGitStatus();
        renderer.scheduleRender();
      }
    });

    // Handle inline diff revert action
    paneManager.onInlineDiffRevert(async (filePath, _line) => {
      const result = await gitIntegration.revertFile(filePath);
      if (result) {
        statusBar.setMessage('Reverted changes', 2000);
        const pane = paneManager.getActivePane();
        pane.hideInlineDiff();
        // Reload the file
        const doc = this.getActiveDocument();
        if (doc) {
          await doc.reload();
        }
        await this.updateGitStatus();
        renderer.scheduleRender();
      }
    });
  }

  /**
   * Setup terminal pane callbacks
   */
  private setupTerminalCallbacks(): void {
    // Re-render when terminal output changes
    terminalPane.onUpdate(() => {
      renderer.scheduleRender();
    });
    terminalPane.onFocus(() => {
      // Unfocus other components when terminal gains focus
      fileTree.setFocused(false);
      gitPanel.setFocused(false);
    });
  }

  /**
   * Select word at position
   */
  private selectWordAt(position: Position, doc?: Document): void {
    const document = doc || this.getActiveDocument();
    if (!document) return;

    const line = document.getLine(position.line);
    let start = position.column;
    let end = position.column;

    // Find word boundaries
    while (start > 0 && this.isWordChar(line[start - 1]!)) {
      start--;
    }
    while (end < line.length && this.isWordChar(line[end]!)) {
      end++;
    }

    document.cursorManager.setSelections([{
      anchor: { line: position.line, column: start },
      head: { line: position.line, column: end }
    }]);
  }

  private isWordChar(char: string): boolean {
    return /[\w]/.test(char);
  }

  /**
   * Copy text to system clipboard (macOS)
   */
  private async copyToSystemClipboard(text: string): Promise<void> {
    try {
      const proc = Bun.spawn(['pbcopy'], {
        stdin: 'pipe'
      });
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited;
    } catch {
      // Silently fail - internal clipboard still works
    }
  }

  /**
   * Paste text from system clipboard (macOS)
   */
  private async pasteFromSystemClipboard(): Promise<string | null> {
    try {
      const proc = Bun.spawn(['pbpaste'], {
        stdout: 'pipe'
      });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      return output || null;
    } catch {
      return null;
    }
  }

  /**
   * Setup render callback
   */
  private setupRenderCallback(): void {
    renderer.onRender((ctx) => {
      this.render(ctx);
    });
  }

  /**
   * Main render function
   */
  private render(ctx: RenderContext): void {
    this.debugLog('render() called');
    
    // Hide cursor during render to prevent flickering
    renderer.hideCursor();
    
    // Update layout
    layoutManager.updateDimensions(ctx.width, ctx.height);

    // Get layout rects
    const statusBarRect = layoutManager.getStatusBarRect();
    const editorRect = layoutManager.getEditorAreaRect();
    const sidebarRect = layoutManager.getSidebarRect();
    const terminalRect = layoutManager.getTerminalRect();
    
    this.debugLog(`render: editorRect=${JSON.stringify(editorRect)}, sidebarRect=${sidebarRect ? JSON.stringify(sidebarRect) : 'null'}`);

    // Render file tree sidebar and/or git panel (if visible)
    if (sidebarRect) {
      const fileTreeOpen = fileTree.getVisible();
      const gitPanelOpen = gitPanel.isOpen();
      const gitPanelLocation = settings.get('git.panel.location');
      
      if (fileTreeOpen && gitPanelOpen && gitPanelLocation !== 'panel') {
        // Split sidebar between file tree and git panel
        const splitRatio = 0.5;  // Could make this configurable
        const fileTreeHeight = Math.floor(sidebarRect.height * splitRatio);
        const gitPanelHeight = sidebarRect.height - fileTreeHeight;
        
        if (gitPanelLocation === 'sidebar-bottom') {
          // File tree on top, git panel on bottom
          fileTree.setRect({
            x: sidebarRect.x,
            y: sidebarRect.y,
            width: sidebarRect.width,
            height: fileTreeHeight
          });
          gitPanel.setRect({
            x: sidebarRect.x,
            y: sidebarRect.y + fileTreeHeight,
            width: sidebarRect.width,
            height: gitPanelHeight
          });
        } else {
          // sidebar-top: Git panel on top, file tree on bottom
          gitPanel.setRect({
            x: sidebarRect.x,
            y: sidebarRect.y,
            width: sidebarRect.width,
            height: gitPanelHeight
          });
          fileTree.setRect({
            x: sidebarRect.x,
            y: sidebarRect.y + gitPanelHeight,
            width: sidebarRect.width,
            height: fileTreeHeight
          });
        }
        
        fileTree.render(ctx);
        gitPanel.render(ctx);
      } else if (gitPanelOpen) {
        // Git panel only
        gitPanel.setRect(sidebarRect);
        gitPanel.render(ctx);
      } else {
        // File tree only (or nothing, but sidebar is visible)
        fileTree.setRect(sidebarRect);
        fileTree.setVisible(true);
        fileTree.render(ctx);
      }
    } else {
      fileTree.setVisible(false);
      gitPanel.setVisible(false);
    }

    // Render terminal pane (if visible)
    if (terminalRect) {
      terminalPane.setRect(terminalRect);
      terminalPane.render(ctx);
    }

    // Render panes (each pane has its own tab bar)
    this.debugLog('render: calling paneManager.setRect and render');
    paneManager.setRect(editorRect);
    paneManager.render(ctx);
    this.debugLog('render: paneManager rendered');

    // Render search widget (positioned in editor area)
    if (searchWidget.visible) {
      const searchWidgetWidth = Math.min(60, editorRect.width - 4);
      searchWidget.setPosition(
        editorRect.x + editorRect.width - searchWidgetWidth - 2,
        editorRect.y,
        searchWidgetWidth
      );
      searchWidget.render(ctx);
    }

    // Render status bar
    statusBar.setRect(statusBarRect);
    statusBar.render(ctx);

    // Render file picker (on top of everything)
    filePicker.render(ctx);

    // Render file browser (on top of file picker)
    fileBrowser.render(ctx);

    // Render command palette (on top of everything)
    commandPalette.render(ctx);

    // Render input dialog (on top of everything)
    inputDialog.render(ctx);

    // Render commit dialog (on top of everything)
    commitDialog.render(ctx);

    // Render save browser (on top of everything)
    saveBrowser.render(ctx);

    // Render LSP UI components
    autocompletePopup.render(ctx, ctx.width, ctx.height);
    hoverTooltip.render(ctx, ctx.width, ctx.height);
    signatureHelp.render(ctx, ctx.width, ctx.height);

    // Render dialogs (on top of everything)
    this.renderCloseConfirmDialog(ctx);
    this.renderExternalChangeDialog(ctx);

    // Position cursor at the very end (after all rendering is done)
    // We render our own block cursor in the editor pane, so we just
    // need to move the terminal cursor out of the way
    const doc = this.getActiveDocument();
    if (doc) {
      // Move terminal cursor to a non-disruptive position (bottom right)
      // The visual cursor is rendered by EditorPane.renderCursors()
      ctx.buffer(`\x1b[${ctx.height};${ctx.width}H`);
    }
  }

  /**
   * Get tabs for tab bar
   */
  private getTabs(): Tab[] {
    return this.documents.map(d => ({
      id: d.id,
      fileName: d.document.fileName,
      filePath: d.document.filePath,
      isDirty: d.document.isDirty,
      isActive: d.id === this.activeDocumentId
    }));
  }

  /**
   * Update status bar
   */
  private updateStatusBar(): void {
    const doc = this.getActiveDocument();
    
    // Get diagnostic counts for current document
    let diagnostics: { errors: number; warnings: number } | undefined;
    let lspStatus: 'starting' | 'ready' | 'error' | 'inactive' = 'inactive';
    
    if (doc && doc.filePath) {
      const uri = `file://${doc.filePath}`;
      const counts = diagnosticsRenderer.getCounts(uri);
      if (counts.errors > 0 || counts.warnings > 0) {
        diagnostics = { errors: counts.errors, warnings: counts.warnings };
      }
      
      // Check if LSP is available for this language
      if (this.lspEnabled) {
        // TODO: Get actual LSP status from lspManager
        lspStatus = 'ready';
      }
    }
    
    statusBar.setState({
      document: doc?.getState() || null,
      cursorPosition: doc?.primaryCursor.position || { line: 0, column: 0 },
      cursorCount: doc?.cursorManager.count || 1,
      gitBranch: this.lastGitBranch || undefined,
      diagnostics,
      lspStatus
    });
  }

  /**
   * Register all commands
   */
  private registerCommands(): void {
    commandRegistry.registerAll([
      // File commands
      {
        id: 'ultra.save',
        title: 'Save',
        category: 'File',
        handler: async () => {
          const doc = this.getActiveDocument();
          if (doc) {
            // If no path, show Save As dialog
            if (!doc.filePath) {
              this.showSaveAsDialog(doc);
              return;
            }
            await doc.save();
            // Update file watcher mod time to prevent auto-reload
            await this.updateFileWatcherModTime(doc.filePath);
            this.updateStatusBar();
          }
        }
      },
      {
        id: 'ultra.saveAs',
        title: 'Save As...',
        category: 'File',
        handler: async () => {
          const doc = this.getActiveDocument();
          if (doc) {
            this.showSaveAsDialog(doc);
          }
        }
      },
      {
        id: 'ultra.newFile',
        title: 'New File',
        category: 'File',
        handler: () => this.newFile()
      },
      {
        id: 'ultra.quit',
        title: 'Quit',
        category: 'File',
        handler: () => this.stop()
      },
      {
        id: 'ultra.restart',
        title: 'Restart',
        category: 'File',
        handler: () => this.restart()
      },
      {
        id: 'ultra.closeTab',
        title: 'Close Tab',
        category: 'File',
        handler: () => {
          if (this.activeDocumentId) {
            this.requestCloseDocument(this.activeDocumentId);
          }
        }
      },

      // Edit commands
      {
        id: 'ultra.undo',
        title: 'Undo',
        category: 'Edit',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.undo();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
          }
        }
      },
      {
        id: 'ultra.redo',
        title: 'Redo',
        category: 'Edit',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.redo();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
          }
        }
      },
      {
        id: 'ultra.copy',
        title: 'Copy',
        category: 'Edit',
        handler: async () => {
          const doc = this.getActiveDocument();
          if (doc) {
            const text = doc.getSelectedText();
            if (text) {
              this.clipboard = text;
              await this.copyToSystemClipboard(text);
            }
          }
        }
      },
      {
        id: 'ultra.cut',
        title: 'Cut',
        category: 'Edit',
        handler: async () => {
          const doc = this.getActiveDocument();
          if (doc) {
            const text = doc.getSelectedText();
            if (text) {
              this.clipboard = text;
              await this.copyToSystemClipboard(text);
              doc.backspace();
              paneManager.ensureCursorVisible();
              this.updateStatusBar();
            }
          }
        }
      },
      {
        id: 'ultra.paste',
        title: 'Paste',
        category: 'Edit',
        handler: async () => {
          const doc = this.getActiveDocument();
          if (doc) {
            // Try system clipboard first, fall back to internal
            const text = await this.pasteFromSystemClipboard() || this.clipboard;
            if (text) {
              doc.insert(text);
              paneManager.ensureCursorVisible();
              this.updateStatusBar();
            }
          }
        }
      },
      {
        id: 'ultra.selectAll',
        title: 'Select All',
        category: 'Edit',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.selectAll();
            this.updateStatusBar();
          }
        }
      },
      {
        id: 'ultra.selectLine',
        title: 'Select Line',
        category: 'Edit',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.selectLine();
            this.updateStatusBar();
          }
        }
      },

      // Navigation commands
      {
        id: 'ultra.cursorLeft',
        title: 'Move Cursor Left',
        category: 'Navigation',
        handler: () => this.moveCursor('left')
      },
      {
        id: 'ultra.cursorRight',
        title: 'Move Cursor Right',
        category: 'Navigation',
        handler: () => this.moveCursor('right')
      },
      {
        id: 'ultra.cursorUp',
        title: 'Move Cursor Up',
        category: 'Navigation',
        handler: () => this.moveCursor('up')
      },
      {
        id: 'ultra.cursorDown',
        title: 'Move Cursor Down',
        category: 'Navigation',
        handler: () => this.moveCursor('down')
      },
      {
        id: 'ultra.cursorLineStart',
        title: 'Move to Line Start',
        category: 'Navigation',
        handler: () => this.moveCursor('lineStart')
      },
      {
        id: 'ultra.cursorLineEnd',
        title: 'Move to Line End',
        category: 'Navigation',
        handler: () => this.moveCursor('lineEnd')
      },
      {
        id: 'ultra.cursorFileStart',
        title: 'Move to File Start',
        category: 'Navigation',
        handler: () => this.moveCursor('fileStart')
      },
      {
        id: 'ultra.cursorFileEnd',
        title: 'Move to File End',
        category: 'Navigation',
        handler: () => this.moveCursor('fileEnd')
      },
      {
        id: 'ultra.cursorWordLeft',
        title: 'Move to Previous Word',
        category: 'Navigation',
        handler: () => this.moveCursor('wordLeft')
      },
      {
        id: 'ultra.cursorWordRight',
        title: 'Move to Next Word',
        category: 'Navigation',
        handler: () => this.moveCursor('wordRight')
      },
      {
        id: 'ultra.pageUp',
        title: 'Page Up',
        category: 'Navigation',
        handler: () => this.moveCursor('pageUp')
      },
      {
        id: 'ultra.pageDown',
        title: 'Page Down',
        category: 'Navigation',
        handler: () => this.moveCursor('pageDown')
      },
      {
        id: 'ultra.selectPageUp',
        title: 'Select Page Up',
        category: 'Selection',
        handler: () => this.moveCursor('pageUp', true)
      },
      {
        id: 'ultra.selectPageDown',
        title: 'Select Page Down',
        category: 'Selection',
        handler: () => this.moveCursor('pageDown', true)
      },

      // Selection commands
      {
        id: 'ultra.selectLeft',
        title: 'Select Left',
        category: 'Selection',
        handler: () => this.moveCursor('left', true)
      },
      {
        id: 'ultra.selectRight',
        title: 'Select Right',
        category: 'Selection',
        handler: () => this.moveCursor('right', true)
      },
      {
        id: 'ultra.selectUp',
        title: 'Select Up',
        category: 'Selection',
        handler: () => this.moveCursor('up', true)
      },
      {
        id: 'ultra.selectDown',
        title: 'Select Down',
        category: 'Selection',
        handler: () => this.moveCursor('down', true)
      },
      {
        id: 'ultra.selectLineStart',
        title: 'Select to Line Start',
        category: 'Selection',
        handler: () => this.moveCursor('lineStart', true)
      },
      {
        id: 'ultra.selectLineEnd',
        title: 'Select to Line End',
        category: 'Selection',
        handler: () => this.moveCursor('lineEnd', true)
      },
      {
        id: 'ultra.selectWordLeft',
        title: 'Select Previous Word',
        category: 'Selection',
        handler: () => this.moveCursor('wordLeft', true)
      },
      {
        id: 'ultra.selectWordRight',
        title: 'Select Next Word',
        category: 'Selection',
        handler: () => this.moveCursor('wordRight', true)
      },

      // Input commands
      {
        id: 'ultra.enter',
        title: 'New Line',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.newline();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
          }
        }
      },
      {
        id: 'ultra.backspace',
        title: 'Backspace',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.backspace();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
            this.notifyDocumentChange(doc);
            
            // Update autocomplete filter if visible
            if (autocompletePopup.isVisible()) {
              const { prefix, startColumn } = this.getWordPrefixAtCursor(doc);
              if (prefix.length > 0 && startColumn === autocompletePopup.getStartColumn()) {
                autocompletePopup.updatePrefix(prefix);
              } else {
                autocompletePopup.hide();
              }
              renderer.scheduleRender();
            }
          }
        }
      },
      {
        id: 'ultra.delete',
        title: 'Delete',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.delete();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
          }
        }
      },
      {
        id: 'ultra.tab',
        title: 'Tab',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            const tabChar = settings.get('editor.insertSpaces') 
              ? ' '.repeat(settings.get('editor.tabSize'))
              : '\t';
            doc.insert(tabChar);
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
          }
        }
      },
      {
        id: 'ultra.escape',
        title: 'Escape',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            // Clear secondary cursors and selection
            doc.cursorManager.clearSecondary();
            doc.cursorManager.clearSelections();
            this.updateStatusBar();
          }
        }
      },
      {
        id: 'ultra.copyStatusMessage',
        title: 'Copy Status Message to Clipboard',
        handler: async () => {
          const msg = statusBar.getMessage();
          if (msg) {
            await this.copyToSystemClipboard(msg);
            statusBar.setMessage('Copied to clipboard!', 1500);
          }
        }
      },

      // View commands
      {
        id: 'ultra.toggleSidebar',
        title: 'Toggle Sidebar',
        category: 'View',
        handler: () => {
          layoutManager.toggleSidebar(settings.get('ultra.sidebar.width') || 30);
          fileTree.setVisible(layoutManager.isSidebarVisible());
        }
      },
      {
        id: 'ultra.focusSidebar',
        title: 'Focus Sidebar',
        category: 'View',
        handler: () => {
          // Show sidebar if not visible
          if (!layoutManager.isSidebarVisible()) {
            layoutManager.toggleSidebar(settings.get('ultra.sidebar.width') || 30);
          }
          fileTree.setVisible(true);
          fileTree.setFocused(true);
        }
      },
      {
        id: 'ultra.focusEditor',
        title: 'Focus Editor',
        category: 'View',
        handler: () => {
          fileTree.setFocused(false);
          terminalPane.setFocused(false);
        }
      },
      {
        id: 'ultra.toggleTerminal',
        title: 'Toggle Terminal',
        category: 'View',
        handler: async () => {
          layoutManager.toggleTerminal(settings.get('terminal.integrated.defaultHeight'));
          if (layoutManager.isTerminalVisible()) {
            // Create terminal if none exists
            if (terminalPane.getTerminalCount() === 0) {
              await terminalPane.createTerminal();
            }
            terminalPane.setFocused(true);
            fileTree.setFocused(false);
          } else {
            terminalPane.setFocused(false);
          }
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.newTerminal',
        title: 'New Terminal',
        category: 'Terminal',
        handler: async () => {
          if (!layoutManager.isTerminalVisible()) {
            layoutManager.toggleTerminal(settings.get('terminal.integrated.defaultHeight'));
          }
          await terminalPane.createTerminal();
          terminalPane.setFocused(true);
          fileTree.setFocused(false);
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.focusTerminal',
        title: 'Focus Terminal',
        category: 'Terminal',
        handler: async () => {
          if (!layoutManager.isTerminalVisible()) {
            layoutManager.toggleTerminal(settings.get('terminal.integrated.defaultHeight'));
            if (terminalPane.getTerminalCount() === 0) {
              await terminalPane.createTerminal();
            }
          }
          terminalPane.setFocused(true);
          fileTree.setFocused(false);
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.nextTerminal',
        title: 'Next Terminal',
        category: 'Terminal',
        handler: () => {
          terminalPane.nextTerminal();
        }
      },
      {
        id: 'ultra.previousTerminal',
        title: 'Previous Terminal',
        category: 'Terminal',
        handler: () => {
          terminalPane.previousTerminal();
        }
      },
      {
        id: 'ultra.toggleAIPanel',
        title: 'Toggle AI Panel',
        category: 'View',
        handler: () => layoutManager.toggleAIPanel()
      },

      // Git commands
      {
        id: 'ultra.toggleGitPanel',
        title: 'Toggle Source Control Panel',
        category: 'Git',
        handler: async () => {
          const isVisible = gitPanel.isOpen();
          if (!isVisible) {
            // Show git panel in sidebar area
            if (!layoutManager.isSidebarVisible()) {
              layoutManager.toggleSidebar(settings.get('ultra.sidebar.width') || 30);
            }
            // Don't hide file tree - they can coexist in split sidebar
            gitPanel.setVisible(true);
            gitPanel.setFocused(true);
            await gitPanel.refresh();
          } else {
            gitPanel.setVisible(false);
            gitPanel.setFocused(false);
          }
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.showGitDiff',
        title: 'Git: Show Diff at Cursor',
        category: 'Git',
        handler: async () => {
          const doc = this.getActiveDocument();
          if (doc?.filePath) {
            const line = doc.primaryCursor.position.line + 1;  // 1-based
            await this.showGitDiffPopup(line);
          }
        }
      },
      {
        id: 'ultra.gitStageFile',
        title: 'Git: Stage Current File',
        category: 'Git',
        handler: async () => {
          const doc = this.getActiveDocument();
          if (doc?.filePath) {
            const success = await gitIntegration.add(doc.filePath);
            if (success) {
              statusBar.setMessage('File staged', 2000);
              await this.updateGitStatus();
            } else {
              statusBar.setMessage('Failed to stage file', 3000);
            }
          }
        }
      },
      {
        id: 'ultra.gitUnstageFile',
        title: 'Git: Unstage Current File',
        category: 'Git',
        handler: async () => {
          const doc = this.getActiveDocument();
          if (doc?.filePath) {
            const success = await gitIntegration.reset(doc.filePath);
            if (success) {
              statusBar.setMessage('File unstaged', 2000);
              await this.updateGitStatus();
            } else {
              statusBar.setMessage('Failed to unstage file', 3000);
            }
          }
        }
      },
      {
        id: 'ultra.gitDiscardChanges',
        title: 'Git: Discard Changes in Current File',
        category: 'Git',
        handler: async () => {
          const doc = this.getActiveDocument();
          if (doc?.filePath) {
            const success = await gitIntegration.checkout(doc.filePath);
            if (success) {
              statusBar.setMessage('Changes discarded', 2000);
              // Reload the file
              await doc.reload();
              await this.updateGitStatus();
            } else {
              statusBar.setMessage('Failed to discard changes', 3000);
            }
          }
        }
      },
      {
        id: 'ultra.gitStageAll',
        title: 'Git: Stage All Changes',
        category: 'Git',
        handler: async () => {
          const success = await gitIntegration.addAll();
          if (success) {
            statusBar.setMessage('All changes staged', 2000);
            await this.updateGitStatus();
          } else {
            statusBar.setMessage('Failed to stage changes', 3000);
          }
        }
      },
      {
        id: 'ultra.gitCommit',
        title: 'Git: Commit',
        category: 'Git',
        handler: async () => {
          const editorRect = layoutManager.getEditorAreaRect();
          commitDialog.show({
            screenWidth: renderer.width,
            screenHeight: renderer.height,
            width: 70,
            editorX: editorRect.x,
            editorWidth: editorRect.width,
            onConfirm: async (message: string) => {
              if (message.trim()) {
                const success = await gitIntegration.commit(message);
                if (success) {
                  statusBar.setMessage('Changes committed', 2000);
                  await this.updateGitStatus();
                } else {
                  statusBar.setMessage('Commit failed', 3000);
                }
              }
              renderer.scheduleRender();
            }
          });
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitRefresh',
        title: 'Git: Refresh Status',
        category: 'Git',
        handler: async () => {
          gitIntegration.invalidateCache();
          await this.updateGitStatus();
          statusBar.setMessage('Git status refreshed', 2000);
        }
      },
      {
        id: 'ultra.focusGitPanel',
        title: 'Focus Source Control Panel',
        category: 'Git',
        handler: async () => {
          if (!layoutManager.isSidebarVisible()) {
            layoutManager.toggleSidebar(settings.get('ultra.sidebar.width') || 30);
          }
          // Show git panel (keep file tree visible - they can coexist)
          gitPanel.setVisible(true);
          gitPanel.setFocused(true);
          fileTree.setFocused(false);
          await gitPanel.refresh();
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitPush',
        title: 'Git: Push',
        category: 'Git',
        handler: async () => {
          statusBar.setMessage('Pushing...', 0);
          const success = await gitIntegration.push();
          if (success) {
            statusBar.setMessage('Pushed successfully', 2000);
            await this.updateGitStatus();
          } else {
            statusBar.setMessage('Failed to push', 3000);
          }
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitPushForce',
        title: 'Git: Push (Force with Lease)',
        category: 'Git',
        handler: async () => {
          statusBar.setMessage('Force pushing...', 0);
          const success = await gitIntegration.push('origin', true);
          if (success) {
            statusBar.setMessage('Force pushed successfully', 2000);
            await this.updateGitStatus();
          } else {
            statusBar.setMessage('Failed to force push', 3000);
          }
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitPull',
        title: 'Git: Pull',
        category: 'Git',
        handler: async () => {
          statusBar.setMessage('Pulling...', 0);
          const success = await gitIntegration.pull();
          if (success) {
            statusBar.setMessage('Pulled successfully', 2000);
            await this.updateGitStatus();
            // Reload all open documents
            for (const openDoc of this.documents) {
              if (openDoc.document.filePath) {
                await openDoc.document.reload();
              }
            }
          } else {
            statusBar.setMessage('Failed to pull', 3000);
          }
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitFetch',
        title: 'Git: Fetch',
        category: 'Git',
        handler: async () => {
          statusBar.setMessage('Fetching...', 0);
          const success = await gitIntegration.fetch();
          if (success) {
            statusBar.setMessage('Fetched successfully', 2000);
            await this.updateGitStatus();
          } else {
            statusBar.setMessage('Failed to fetch', 3000);
          }
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitCreateBranch',
        title: 'Git: Create Branch',
        category: 'Git',
        handler: async () => {
          const editorRect = layoutManager.getEditorAreaRect();
          inputDialog.show({
            title: 'Create New Branch',
            placeholder: 'Enter branch name...',
            initialValue: '',
            screenWidth: renderer.width,
            screenHeight: renderer.height,
            editorX: editorRect.x,
            editorWidth: editorRect.width,
            onConfirm: async (branchName: string) => {
              if (branchName) {
                const success = await gitIntegration.createBranch(branchName);
                if (success) {
                  statusBar.setMessage(`Created and switched to branch: ${branchName}`, 2000);
                  await this.updateGitStatus();
                } else {
                  statusBar.setMessage('Failed to create branch', 3000);
                }
              }
              renderer.scheduleRender();
            }
          });
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitSwitchBranch',
        title: 'Git: Switch Branch',
        category: 'Git',
        handler: async () => {
          const branches = await gitIntegration.getBranches();
          if (branches.length === 0) {
            statusBar.setMessage('No branches found', 2000);
            return;
          }

          const currentBranch = branches.find(b => b.current);
          const editorRect = layoutManager.getEditorAreaRect();

          // Create palette items with handlers
          const items = branches.map(b => ({
            id: b.name,
            title: b.name,
            category: b.current ? 'Current' : undefined,
            handler: async () => {
              if (b.current) {
                statusBar.setMessage('Already on this branch', 2000);
                return;
              }
              const success = await gitIntegration.switchBranch(b.name);
              if (success) {
                statusBar.setMessage(`Switched to branch: ${b.name}`, 2000);
                await this.updateGitStatus();
                // Reload all open documents
                for (const openDoc of this.documents) {
                  if (openDoc.document.filePath) {
                    await openDoc.document.reload();
                  }
                }
              } else {
                statusBar.setMessage('Failed to switch branch', 3000);
              }
              renderer.scheduleRender();
            }
          }));

          commandPalette.showWithItems(
            items,
            'Switch to Branch',
            currentBranch?.name || '',
            editorRect.x,
            editorRect.width
          );
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitListBranches',
        title: 'Git: List Branches',
        category: 'Git',
        handler: async () => {
          this.debugLog('Git: List Branches - Starting');
          const branches = await gitIntegration.getBranches();
          this.debugLog(`Git: List Branches - Found ${branches.length} branches: ${JSON.stringify(branches)}`);

          if (branches.length === 0) {
            statusBar.setMessage('No branches found', 2000);
            return;
          }

          const currentBranch = branches.find(b => b.current);
          const editorRect = layoutManager.getEditorAreaRect();
          this.debugLog(`Git: List Branches - editorRect: ${JSON.stringify(editorRect)}, currentBranch: ${currentBranch?.name}`);

          // Create palette items (just for viewing, no action)
          const items = branches.map(b => ({
            id: b.name,
            title: b.name,
            category: b.current ? 'Current' : undefined,
            handler: () => {
              // Just close the palette when selected
              statusBar.setMessage(`Branch: ${b.name}${b.current ? ' (current)' : ''}`, 2000);
            }
          }));

          this.debugLog(`Git: List Branches - Created ${items.length} items, about to call showWithItems`);
          commandPalette.showWithItems(
            items,
            'Branches',
            currentBranch?.name || '',
            editorRect.x,
            editorRect.width
          );
          this.debugLog('Git: List Branches - Called showWithItems, calling scheduleRender');
          renderer.scheduleRender();
          this.debugLog('Git: List Branches - Done');
        }
      },
      {
        id: 'ultra.gitDeleteBranch',
        title: 'Git: Delete Branch',
        category: 'Git',
        handler: async () => {
          const branches = await gitIntegration.getBranches();
          const nonCurrentBranches = branches.filter(b => !b.current);

          if (nonCurrentBranches.length === 0) {
            statusBar.setMessage('No branches to delete', 2000);
            return;
          }

          const editorRect = layoutManager.getEditorAreaRect();

          // Create palette items with handlers
          const items = nonCurrentBranches.map(b => ({
            id: b.name,
            title: b.name,
            category: undefined,
            handler: async () => {
              const success = await gitIntegration.deleteBranch(b.name);
              if (success) {
                statusBar.setMessage(`Deleted branch: ${b.name}`, 2000);
                await this.updateGitStatus();
              } else {
                statusBar.setMessage('Failed to delete branch (use force delete if needed)', 3000);
              }
              renderer.scheduleRender();
            }
          }));

          commandPalette.showWithItems(
            items,
            'Delete Branch',
            '',
            editorRect.x,
            editorRect.width
          );
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitRenameBranch',
        title: 'Git: Rename Current Branch',
        category: 'Git',
        handler: async () => {
          const currentBranch = await gitIntegration.branch();
          const editorRect = layoutManager.getEditorAreaRect();
          inputDialog.show({
            title: 'Rename Branch',
            placeholder: 'Enter new branch name...',
            initialValue: currentBranch || '',
            screenWidth: renderer.width,
            screenHeight: renderer.height,
            editorX: editorRect.x,
            editorWidth: editorRect.width,
            onConfirm: async (newName: string) => {
              if (newName && newName !== currentBranch) {
                const success = await gitIntegration.renameBranch(newName);
                if (success) {
                  statusBar.setMessage(`Renamed branch to: ${newName}`, 2000);
                  await this.updateGitStatus();
                } else {
                  statusBar.setMessage('Failed to rename branch', 3000);
                }
              }
              renderer.scheduleRender();
            }
          });
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.gitAmendCommit',
        title: 'Git: Amend Last Commit',
        category: 'Git',
        handler: async () => {
          const editorRect = layoutManager.getEditorAreaRect();
          inputDialog.show({
            title: 'Amend Commit Message (leave empty to keep current)',
            placeholder: 'Enter new commit message or leave empty...',
            initialValue: '',
            screenWidth: renderer.width,
            screenHeight: renderer.height,
            editorX: editorRect.x,
            editorWidth: editorRect.width,
            onConfirm: async (message: string) => {
              const success = await gitIntegration.amendCommit(message || undefined);
              if (success) {
                statusBar.setMessage('Commit amended', 2000);
                await this.updateGitStatus();
              } else {
                statusBar.setMessage('Failed to amend commit', 3000);
              }
              renderer.scheduleRender();
            }
          });
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.toggleMinimap',
        title: 'Toggle Minimap',
        category: 'View',
        handler: () => {
          paneManager.toggleMinimap();
        }
      },
      
      // Folding commands
      {
        id: 'ultra.toggleFold',
        title: 'Toggle Fold',
        category: 'View',
        handler: () => {
          paneManager.toggleFoldAtCursor();
        }
      },
      {
        id: 'ultra.foldAll',
        title: 'Fold All',
        category: 'View',
        handler: () => {
          paneManager.foldAll();
        }
      },
      {
        id: 'ultra.unfoldAll',
        title: 'Unfold All',
        category: 'View',
        handler: () => {
          paneManager.unfoldAll();
        }
      },

      // Split pane commands
      {
        id: 'ultra.splitVertical',
        title: 'Split Editor Vertically',
        category: 'View',
        handler: (() => {
          let lastExecution = 0;
          return () => {
            const now = Date.now();
            if (now - lastExecution < 100) {
              this.debugLog(`ultra.splitVertical: ignoring duplicate call (${now - lastExecution}ms since last)`);
              return;
            }
            lastExecution = now;
            this.debugLog('ultra.splitVertical command handler called');
            const result = paneManager.splitVertical();
            this.debugLog(`splitVertical returned: ${result?.id ?? 'null'}`);
            renderer.scheduleRender();
          };
        })()
      },
      {
        id: 'ultra.splitHorizontal',
        title: 'Split Editor Horizontally',
        category: 'View',
        handler: (() => {
          let lastExecution = 0;
          return () => {
            const now = Date.now();
            if (now - lastExecution < 100) {
              return;
            }
            lastExecution = now;
            paneManager.splitHorizontal();
            renderer.scheduleRender();
          };
        })()
      },
      {
        id: 'ultra.closePane',
        title: 'Close Editor Pane',
        category: 'View',
        handler: () => {
          paneManager.closeActivePane();
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.focusNextPane',
        title: 'Focus Next Pane',
        category: 'View',
        handler: () => {
          paneManager.focusNextPane();
          this.activeDocumentId = paneManager.getActivePane().getActiveDocumentId();
          this.updateStatusBar();
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.focusPreviousPane',
        title: 'Focus Previous Pane',
        category: 'View',
        handler: () => {
          paneManager.focusPreviousPane();
          this.activeDocumentId = paneManager.getActivePane().getActiveDocumentId();
          this.updateStatusBar();
          renderer.scheduleRender();
        }
      },

      // Tab commands
      {
        id: 'ultra.nextTab',
        title: 'Next Tab',
        category: 'Tabs',
        handler: () => this.switchTab(1)
      },
      {
        id: 'ultra.previousTab',
        title: 'Previous Tab',
        category: 'Tabs',
        handler: () => this.switchTab(-1)
      },
      {
        id: 'ultra.goToTab1',
        title: 'Go to Tab 1',
        category: 'Tabs',
        handler: () => this.goToTab(0)
      },
      {
        id: 'ultra.goToTab2',
        title: 'Go to Tab 2',
        category: 'Tabs',
        handler: () => this.goToTab(1)
      },
      {
        id: 'ultra.goToTab3',
        title: 'Go to Tab 3',
        category: 'Tabs',
        handler: () => this.goToTab(2)
      },
      {
        id: 'ultra.goToTab4',
        title: 'Go to Tab 4',
        category: 'Tabs',
        handler: () => this.goToTab(3)
      },
      {
        id: 'ultra.goToTab5',
        title: 'Go to Tab 5',
        category: 'Tabs',
        handler: () => this.goToTab(4)
      },
      {
        id: 'ultra.goToTab6',
        title: 'Go to Tab 6',
        category: 'Tabs',
        handler: () => this.goToTab(5)
      },
      {
        id: 'ultra.goToTab7',
        title: 'Go to Tab 7',
        category: 'Tabs',
        handler: () => this.goToTab(6)
      },
      {
        id: 'ultra.goToTab8',
        title: 'Go to Tab 8',
        category: 'Tabs',
        handler: () => this.goToTab(7)
      },
      {
        id: 'ultra.goToTab9',
        title: 'Go to Tab 9',
        category: 'Tabs',
        handler: () => this.goToTab(8)
      },
      
      // File operations
      {
        id: 'ultra.openFile',
        title: 'Open File (Browse)',
        category: 'File',
        handler: async () => {
          const workspaceRoot = process.cwd();
          const editorRect = layoutManager.getEditorAreaRect();
          fileBrowser.show(workspaceRoot, renderer.width, renderer.height, editorRect.x, editorRect.width);
          fileBrowser.onSelect(async (path) => {
            await this.openFile(path);
            renderer.scheduleRender();
          });
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.openSettings',
        title: 'Open Settings (JSON)',
        category: 'Preferences',
        handler: async () => {
          await this.openFile(userConfigManager.getSettingsPath());
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.openKeybindings',
        title: 'Open Keyboard Shortcuts (JSON)',
        category: 'Preferences',
        handler: async () => {
          await this.openFile(userConfigManager.getKeybindingsPath());
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.editTheme',
        title: 'Edit Current Theme (JSON)',
        category: 'Preferences',
        handler: async () => {
          await this.openFile(userConfigManager.getCurrentThemePath());
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.changeTheme',
        title: 'Change Color Theme',
        category: 'Preferences',
        handler: async () => {
          const themes = await userConfigManager.getAvailableThemes();
          const currentTheme = settings.get('workbench.colorTheme') || 'catppuccin-frappe';

          // Show theme selector in command palette
          const editorRect = layoutManager.getEditorAreaRect();
          commandPalette.showWithItems(
            themes.map(t => ({
              id: t.name,
              title: t.displayName,
              category: t.isBuiltIn ? 'Built-in' : 'User',
              handler: async () => {
                await userConfigManager.changeTheme(t.name);
              }
            })),
            'Select Color Theme',
            currentTheme,
            editorRect.x,
            editorRect.width
          );
          renderer.scheduleRender();
        }
      },
      
      // Additional editing commands
      {
        id: 'ultra.outdent',
        title: 'Outdent',
        category: 'Edit',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.outdent();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
          }
        }
      },
      {
        id: 'ultra.selectNextOccurrence',
        title: 'Select Next Occurrence',
        category: 'Selection',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.selectNextOccurrence();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
            renderer.scheduleRender();
          }
        }
      },
      {
        id: 'ultra.selectAllOccurrences',
        title: 'Select All Occurrences',
        category: 'Selection',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.selectAllOccurrences();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
            renderer.scheduleRender();
          }
        }
      },
      {
        id: 'ultra.addCursorAbove',
        title: 'Add Cursor Above',
        category: 'Selection',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.addCursorAbove();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
            renderer.scheduleRender();
          }
        }
      },
      {
        id: 'ultra.addCursorBelow',
        title: 'Add Cursor Below',
        category: 'Selection',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.addCursorBelow();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
            renderer.scheduleRender();
          }
        }
      },
      {
        id: 'ultra.splitSelectionIntoLines',
        title: 'Split Selection Into Lines',
        category: 'Selection',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            doc.splitSelectionIntoLines();
            paneManager.ensureCursorVisible();
            this.updateStatusBar();
            renderer.scheduleRender();
          }
        }
      },
      
      // Search/Navigate commands
      {
        id: 'ultra.find',
        title: 'Find',
        category: 'Search',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            searchWidget.setDocument(doc);
            searchWidget.show('find');
            searchWidget.onClose(() => {
              renderer.scheduleRender();
            });
            searchWidget.onNavigate((match) => {
              if (match && doc) {
                doc.cursorManager.setPosition(match.range.start);
                paneManager.ensureCursorVisible();
              }
              renderer.scheduleRender();
            });
            searchWidget.onReplace(() => {
              renderer.scheduleRender();
            });
            renderer.scheduleRender();
          }
        }
      },
      {
        id: 'ultra.findNext',
        title: 'Find Next',
        category: 'Search',
        handler: () => {
          if (searchWidget.visible) {
            searchWidget.findNext();
            renderer.scheduleRender();
          }
        }
      },
      {
        id: 'ultra.findPrevious',
        title: 'Find Previous',
        category: 'Search',
        handler: () => {
          if (searchWidget.visible) {
            searchWidget.findPrevious();
            renderer.scheduleRender();
          }
        }
      },
      {
        id: 'ultra.replace',
        title: 'Find and Replace',
        category: 'Search',
        handler: () => {
          const doc = this.getActiveDocument();
          if (doc) {
            searchWidget.setDocument(doc);
            searchWidget.show('replace');
            searchWidget.onClose(() => {
              renderer.scheduleRender();
            });
            searchWidget.onNavigate((match) => {
              if (match && doc) {
                doc.cursorManager.setPosition(match.range.start);
                paneManager.ensureCursorVisible();
              }
              renderer.scheduleRender();
            });
            searchWidget.onReplace(() => {
              renderer.scheduleRender();
            });
            renderer.scheduleRender();
          }
        }
      },
      {
        id: 'ultra.goToLine',
        title: 'Go to Line',
        category: 'Navigation',
        handler: () => {
          // TODO: Implement go to line UI
        }
      },
      {
        id: 'ultra.projectSearch',
        title: 'Search in Files',
        category: 'Search',
        handler: () => {
          // TODO: Implement project search UI
        }
      },
      {
        id: 'ultra.quickOpen',
        title: 'Quick Open',
        category: 'Navigation',
        handler: async () => {
          const workspaceRoot = process.cwd();
          const editorRect = layoutManager.getEditorAreaRect();
          await filePicker.show(workspaceRoot, renderer.width, renderer.height, editorRect.x, editorRect.width);
          filePicker.onSelect(async (path) => {
            await this.openFile(path);
            renderer.scheduleRender();
          });
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.commandPalette',
        title: 'Command Palette',
        category: 'View',
        handler: () => {
          const commands = commandRegistry.getAll();
          const editorRect = layoutManager.getEditorAreaRect();
          commandPalette.show(commands, renderer.width, renderer.height, editorRect.x, editorRect.width);
          commandPalette.onSelect(async (command) => {
            await commandRegistry.execute(command.id);
          });
          renderer.scheduleRender();
        }
      },

      // LSP commands
      {
        id: 'ultra.goToDefinition',
        title: 'Go to Definition',
        category: 'LSP',
        handler: async () => {
          await this.goToDefinition();
        }
      },
      {
        id: 'ultra.findReferences',
        title: 'Find All References',
        category: 'LSP',
        handler: async () => {
          await this.findReferences();
        }
      },
      {
        id: 'ultra.showHover',
        title: 'Show Hover Information',
        category: 'LSP',
        handler: async () => {
          await this.showHover();
        }
      },
      {
        id: 'ultra.rename',
        title: 'Rename Symbol',
        category: 'LSP',
        handler: async () => {
          await this.renameSymbol();
        }
      },
      {
        id: 'ultra.triggerCompletion',
        title: 'Trigger Suggest',
        category: 'LSP',
        handler: async () => {
          await this.triggerCompletion();
        }
      },
      {
        id: 'ultra.lspDebug',
        title: 'LSP: Show Debug Info',
        category: 'LSP',
        handler: () => {
          lspManager.setDebugEnabled(true);
          const info = lspManager.getDebugInfo();
          // Write to debug.log file
          const timestamp = new Date().toISOString();
          const message = `\n=== LSP Debug Info (${timestamp}) ===\n${info}\n${'='.repeat(50)}\n`;
          try {
            const fs = require('fs');
            fs.appendFileSync('./debug.log', message);
            statusBar.setMessage('LSP debug enabled - see debug.log', 3000);
          } catch {
            statusBar.setMessage('Failed to write debug.log', 3000);
          }
        }
      }
    ]);
  }

  /**
   * Move cursor helper
   */
  private moveCursor(
    direction: 'left' | 'right' | 'up' | 'down' | 'lineStart' | 'lineEnd' | 'fileStart' | 'fileEnd' | 'wordLeft' | 'wordRight' | 'pageUp' | 'pageDown',
    selecting: boolean = false
  ): void {
    const doc = this.getActiveDocument();
    if (!doc) return;

    const pageSize = Math.max(1, paneManager.getVisibleLineCount() - 2);

    switch (direction) {
      case 'left': doc.moveLeft(selecting); break;
      case 'right': doc.moveRight(selecting); break;
      case 'up': doc.moveUp(selecting); break;
      case 'down': doc.moveDown(selecting); break;
      case 'lineStart': doc.moveToLineStart(selecting); break;
      case 'lineEnd': doc.moveToLineEnd(selecting); break;
      case 'fileStart': doc.moveToDocumentStart(selecting); break;
      case 'fileEnd': doc.moveToDocumentEnd(selecting); break;
      case 'wordLeft': doc.moveWordLeft(selecting); break;
      case 'wordRight': doc.moveWordRight(selecting); break;
      case 'pageUp': doc.movePageUp(pageSize, selecting); break;
      case 'pageDown': doc.movePageDown(pageSize, selecting); break;
    }

    paneManager.ensureCursorVisible();
    this.updateStatusBar();
  }

  /**
   * Open a file (in the last focused pane)
   */
  async openFile(filePath: string): Promise<void> {
    try {
      // Resolve to absolute path for LSP compatibility
      const absolutePath = path.resolve(filePath);
      
      // Check if already open as a document
      const existing = this.documents.find(d => d.document.filePath === absolutePath);
      if (existing) {
        // Open in the last focused pane (may already be open there, or adds a new tab)
        paneManager.openDocument(existing.document, existing.id);
        this.activeDocumentId = existing.id;
        return;
      }

      const document = await Document.fromFile(absolutePath);
      const id = this.generateId();
      
      this.documents.push({ id, document });
      
      // Open in the last focused pane
      paneManager.openDocument(document, id);
      this.activeDocumentId = id;

      // Notify LSP of document open
      if (this.lspEnabled && document.filePath) {
        const uri = `file://${document.filePath}`;
        await lspManager.openDocument(uri, document.language, document.content);
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }

  /**
   * Show Save As dialog
   */
  private showSaveAsDialog(doc: Document): void {
    // Get suggested filename and starting directory
    const existingPath = doc.filePath;
    const suggestedName = existingPath 
      ? path.basename(existingPath) 
      : 'untitled.txt';
    const startDir = existingPath 
      ? path.dirname(existingPath) 
      : process.cwd();

    const editorRect = layoutManager.getEditorAreaRect();
    saveBrowser.show({
      startPath: startDir,
      suggestedFilename: suggestedName,
      screenWidth: renderer.width,
      screenHeight: renderer.height,
      editorX: editorRect.x,
      editorWidth: editorRect.width,
      onSave: async (filePath: string) => {
        try {
          await doc.saveAs(filePath);
          this.updateStatusBar();
          statusBar.setMessage(`Saved: ${filePath}`, 3000);
        } catch (error) {
          statusBar.setMessage(`Error saving: ${error}`, 5000);
        }
        renderer.scheduleRender();
      },
      onCancel: () => {
        renderer.scheduleRender();
      }
    });
    renderer.scheduleRender();
  }

  /**
   * Create a new file
   */
  newFile(): void {
    this.debugLog('newFile() called');
    const document = new Document();
    const id = this.generateId();
    
    this.documents.push({ id, document });
    
    // Add to the appropriate pane (last focused, or active)
    const targetPane = paneManager.getLastFocusedPane() || paneManager.getActivePane();
    this.debugLog(`newFile: targetPane=${targetPane?.id || 'null'}`);
    if (targetPane) {
      targetPane.addDocument(id, document);
      targetPane.setActiveDocument(id, document);
      this.activeDocumentId = id;
    }
    
    this.debugLog('newFile: updating status bar');
    this.updateStatusBar();
    this.debugLog('newFile() complete');
  }

  /**
   * Activate a document in the currently active pane
   */
  activateDocument(id: string): void {
    const doc = this.documents.find(d => d.id === id);
    if (!doc) return;

    this.activeDocumentId = id;
    
    // Get active pane and set the document
    const pane = paneManager.getActivePane();
    if (pane) {
      // Check if pane already has this document
      if (!pane.hasDocumentById(id)) {
        pane.addDocument(id, doc.document);
      }
      pane.setActiveDocument(id, doc.document);
    }
    
    this.updateStatusBar();
    
    // Update git gutter indicators for the new document
    this.updateGitGutterIndicators();
  }

  /**
   * Request to close a document (may show confirmation dialog)
   */
  requestCloseDocument(id: string): void {
    const docEntry = this.documents.find(d => d.id === id);
    if (!docEntry) return;
    
    const doc = docEntry.document;
    if (doc.isDirty) {
      // Show confirmation dialog
      this.closeConfirmDialog = {
        isOpen: true,
        documentId: id,
        fileName: doc.fileName
      };
      renderer.scheduleRender();
    } else {
      // No unsaved changes, close directly
      this.closeDocument(id);
    }
  }

  /**
   * Request to close a document from a specific pane
   * If the document is only in this pane, close it globally (with confirm if dirty)
   * If it's open in multiple panes, just remove from this pane
   */
  requestCloseDocumentInPane(id: string, paneId: string): void {
    const docEntry = this.documents.find(d => d.id === id);
    if (!docEntry) return;
    
    const doc = docEntry.document;
    
    // Check how many panes have this document open
    const panesWithDoc = paneManager.getAllPanes().filter(p => p.hasDocumentById(id));
    
    if (panesWithDoc.length > 1) {
      // Document is in multiple panes - just remove from this pane
      const pane = paneManager.getPane(paneId);
      if (pane) {
        pane.removeDocument(id);
        
        // If this was the active pane, update activeDocumentId
        if (paneManager.getActivePane().id === paneId) {
          const newActiveId = pane.getActiveDocumentId();
          this.activeDocumentId = newActiveId;
          this.updateStatusBar();
        }
        
        renderer.scheduleRender();
      }
    } else {
      // Document only in this pane - use normal close flow
      if (doc.isDirty) {
        // Show confirmation dialog
        this.closeConfirmDialog = {
          isOpen: true,
          documentId: id,
          fileName: doc.fileName
        };
        renderer.scheduleRender();
      } else {
        // No unsaved changes, close directly
        this.closeDocument(id);
      }
    }
  }

  /**
   * Close a document (internal - no confirmation)
   */
  closeDocument(id: string): void {
    const index = this.documents.findIndex(d => d.id === id);
    if (index < 0) return;

    const docEntry = this.documents[index]!;
    const doc = docEntry.document;

    // Notify LSP of document close
    if (this.lspEnabled && doc.filePath) {
      const uri = `file://${doc.filePath}`;
      lspManager.closeDocument(uri);
      diagnosticsRenderer.clearDiagnostics(uri);
    }

    // Remove document from all panes that have it
    paneManager.removeDocumentFromAllPanes(id);

    this.documents.splice(index, 1);

    if (this.activeDocumentId === id) {
      // Get the active pane's current document as the new active
      const pane = paneManager.getActivePane();
      const newActiveId = pane?.getActiveDocumentId() || null;
      
      if (newActiveId) {
        this.activeDocumentId = newActiveId;
      } else {
        // Pane is now empty - that's fine, just clear activeDocumentId
        this.activeDocumentId = null;
      }
      this.updateStatusBar();
    }
  }
  
  /**
   * Handle close confirmation dialog response
   */
  private async handleCloseConfirmResponse(response: 'save' | 'discard' | 'cancel'): Promise<void> {
    const docId = this.closeConfirmDialog.documentId;
    this.closeConfirmDialog = { isOpen: false, documentId: null, fileName: '' };
    
    if (!docId) return;
    
    switch (response) {
      case 'save':
        // Save then close
        const docEntry = this.documents.find(d => d.id === docId);
        if (docEntry) {
          const doc = docEntry.document;
          if (doc.filePath) {
            await doc.save();
            // Update file watcher mod time to prevent auto-reload
            await this.updateFileWatcherModTime(doc.filePath);
            this.closeDocument(docId);
          } else {
            // No file path, need save-as first
            const editorRect = layoutManager.getEditorAreaRect();
            saveBrowser.show({
              startPath: process.cwd(),
              suggestedFilename: doc.fileName,
              screenWidth: renderer.width,
              screenHeight: renderer.height,
              editorX: editorRect.x,
              editorWidth: editorRect.width,
              onSave: async (filePath: string) => {
                await doc.saveAs(filePath);
                this.closeDocument(docId);
                renderer.scheduleRender();
              },
              onCancel: () => {
                renderer.scheduleRender();
              }
            });
          }
        }
        break;
      case 'discard':
        // Close without saving
        this.closeDocument(docId);
        break;
      case 'cancel':
        // Do nothing
        break;
    }
    renderer.scheduleRender();
  }

  /**
   * Render close confirmation dialog
   */
  private renderCloseConfirmDialog(ctx: RenderContext): void {
    if (!this.closeConfirmDialog.isOpen) return;
    
    const dialogWidth = 50;
    const dialogHeight = 7;
    const dialogX = Math.floor((renderer.width - dialogWidth) / 2);
    const dialogY = Math.floor((renderer.height - dialogHeight) / 2);

    const bgColor = '#2d2d2d';
    const borderColor = '#e5c07b';

    // Background
    ctx.fill(dialogX, dialogY, dialogWidth, dialogHeight, ' ', undefined, bgColor);

    // Border
    ctx.drawStyled(dialogX, dialogY, '╭' + '─'.repeat(dialogWidth - 2) + '╮', borderColor, bgColor);
    for (let y = dialogY + 1; y < dialogY + dialogHeight - 1; y++) {
      ctx.drawStyled(dialogX, y, '│', borderColor, bgColor);
      ctx.drawStyled(dialogX + dialogWidth - 1, y, '│', borderColor, bgColor);
    }
    ctx.drawStyled(dialogX, dialogY + dialogHeight - 1, '╰' + '─'.repeat(dialogWidth - 2) + '╯', borderColor, bgColor);

    // Title
    const title = ' Unsaved Changes ';
    const titleX = dialogX + Math.floor((dialogWidth - title.length) / 2);
    ctx.drawStyled(titleX, dialogY, title, '#e5c07b', bgColor);

    // Message
    const filename = this.closeConfirmDialog.fileName;
    const truncatedName = filename.length > dialogWidth - 6 ? filename.slice(0, dialogWidth - 9) + '...' : filename;
    const msg = `Save changes to ${truncatedName}?`;
    const msgTruncated = msg.length > dialogWidth - 4 ? msg.slice(0, dialogWidth - 7) + '...' : msg;
    ctx.drawStyled(dialogX + 2, dialogY + 2, msgTruncated, '#d4d4d4', bgColor);

    // Options
    const options = '(S)ave  (D)iscard  (C)ancel';
    const optX = dialogX + Math.floor((dialogWidth - options.length) / 2);
    ctx.drawStyled(optX, dialogY + 4, options, '#98c379', bgColor);
  }

  /**
   * Get active document
   */
  getActiveDocument(): Document | null {
    if (!this.activeDocumentId) return null;
    const doc = this.documents.find(d => d.id === this.activeDocumentId);
    return doc?.document || null;
  }

  /**
   * Switch tabs
   */
  private switchTab(delta: number): void {
    if (this.documents.length === 0) return;
    
    const currentIndex = this.documents.findIndex(d => d.id === this.activeDocumentId);
    let newIndex = (currentIndex + delta) % this.documents.length;
    if (newIndex < 0) newIndex += this.documents.length;
    
    this.activateDocument(this.documents[newIndex]!.id);
  }

  /**
   * Go to specific tab
   */
  private goToTab(index: number): void {
    if (index >= 0 && index < this.documents.length) {
      this.activateDocument(this.documents[index]!.id);
    }
  }

  /**
   * Start file watcher - polls for file changes
   */
  private startFileWatcher(): void {
    // Poll every 1 second for file changes
    this.fileWatchInterval = setInterval(() => {
      this.checkForFileChanges();
    }, 1000);
  }

  /**
   * Stop file watcher
   */
  private stopFileWatcher(): void {
    if (this.fileWatchInterval) {
      clearInterval(this.fileWatchInterval);
      this.fileWatchInterval = null;
    }
    this.fileWatchers.clear();
  }

  /**
   * Start polling for git status updates
   */
  private startGitStatusPolling(): void {
    // Initial check
    this.updateGitStatus();
    
    // Poll at configured interval for responsive git status updates
    const interval = settings.get('git.statusInterval');
    this.gitStatusInterval = setInterval(() => {
      this.updateGitStatus();
    }, interval);
  }

  /**
   * Stop git status polling
   */
  private stopGitStatusPolling(): void {
    if (this.gitStatusInterval) {
      clearInterval(this.gitStatusInterval);
      this.gitStatusInterval = null;
    }
  }

  /**
   * Update git status in status bar and file tree
   */
  private async updateGitStatus(): Promise<void> {
    const [branch, status] = await Promise.all([
      gitIntegration.branch(),
      gitIntegration.status()
    ]);
    
    // Update branch in status bar
    if (branch !== this.lastGitBranch) {
      this.lastGitBranch = branch;
      this.updateStatusBar();
    }
    
    // Update file tree with git status
    if (status) {
      const gitFileStates = new Map<string, 'added' | 'modified' | 'deleted' | 'untracked' | 'conflict' | 'none'>();
      
      // Staged files
      for (const file of status.staged) {
        const state = file.status === 'A' ? 'added' :
                      file.status === 'D' ? 'deleted' :
                      file.status === 'U' ? 'conflict' : 'modified';
        gitFileStates.set(file.path, state);
      }
      
      // Unstaged files (may override staged if both modified)
      for (const file of status.unstaged) {
        const existing = gitFileStates.get(file.path);
        const state = file.status === 'D' ? 'deleted' :
                      file.status === 'U' ? 'conflict' : 'modified';
        // Only override if not already set or new state is more important
        if (!existing || state === 'conflict') {
          gitFileStates.set(file.path, state);
        }
      }
      
      // Untracked files
      for (const filePath of status.untracked) {
        gitFileStates.set(filePath, 'untracked');
      }
      
      fileTree.setGitStatus(gitFileStates);
    }
    
    // Update gutter indicators for active document
    await this.updateGitGutterIndicators();
    
    // Refresh git panel if visible
    if (gitPanel.isOpen()) {
      await gitPanel.refresh();
    }
    
    renderer.scheduleRender();
  }

  /**
   * Update git gutter indicators for the active document
   */
  private async updateGitGutterIndicators(): Promise<void> {
    const doc = this.getActiveDocument();
    if (!doc || !doc.filePath) {
      paneManager.getActivePane().clearGitLineChanges();
      return;
    }
    
    // Compare current buffer content against HEAD (not disk content)
    const bufferContent = doc.content;
    const lineChanges = await gitIntegration.diffBufferLines(doc.filePath, bufferContent);
    this.debugLog(`[Git Gutter] File: ${doc.filePath}, Changes: ${lineChanges.length}, changes: ${JSON.stringify(lineChanges.slice(0, 10))}`);
    const pane = paneManager.getActivePane();
    this.debugLog(`[Git Gutter] Calling setGitLineChanges on pane: ${pane?.id}`);
    pane.setGitLineChanges(lineChanges);
    this.debugLog(`[Git Gutter] setGitLineChanges called`);
  }

  /**
   * Show git diff inline in the editor at the specified line
   */
  private async showGitDiffPopup(line: number): Promise<void> {
    const doc = this.getActiveDocument();
    if (!doc?.filePath) return;

    const pane = paneManager.getActivePane();
    const changes = pane.getGitLineChanges();
    
    if (changes.length === 0) {
      statusBar.setMessage('No changes to show', 2000);
      return;
    }

    // Get the diff content for this line from git
    const contextLines = settings.get('git.diffContextLines') ?? 3;
    const diffContent = await gitIntegration.getLineDiff(doc.filePath, line, contextLines);
    
    if (!diffContent) {
      statusBar.setMessage('No diff available for this line', 2000);
      return;
    }

    // Show inline diff in the pane (line is 1-based from git gutter)
    await pane.showInlineDiff(doc.filePath, line - 1, diffContent);
    renderer.scheduleRender();
  }

  /**
   * Show commit message dialog
   */
  private showCommitDialog(): void {
    const width = renderer.width;
    const height = renderer.height;
    const editorRect = layoutManager.getEditorAreaRect();

    commitDialog.show({
      screenWidth: width,
      screenHeight: height,
      width: 70,  // Good width for commit messages
      editorX: editorRect.x,
      editorWidth: editorRect.width,
      onConfirm: async (message) => {
        const success = await gitPanel.commitWithMessage(message);
        if (success) {
          statusBar.setMessage('Committed successfully', 2000);
          await this.updateGitStatus();
        } else {
          statusBar.setMessage('Commit failed', 2000);
        }
        renderer.scheduleRender();
      },
      onCancel: () => {
        renderer.scheduleRender();
      }
    });
    renderer.scheduleRender();
  }

  /**
   * Watch a file for changes
   */
  private async watchFile(filePath: string): Promise<void> {
    if (!filePath || this.fileWatchers.has(filePath)) return;
    
    try {
      const file = Bun.file(filePath);
      const stat = await file.stat();
      if (stat) {
        this.fileWatchers.set(filePath, {
          watcher: file,
          lastModTime: stat.mtime?.getTime() ?? Date.now()
        });
      }
    } catch {
      // File doesn't exist or can't be watched
    }
  }

  /**
   * Stop watching a file
   */
  private unwatchFile(filePath: string): void {
    this.fileWatchers.delete(filePath);
  }

  /**
   * Update file watcher mod time after saving to prevent auto-reload
   */
  private async updateFileWatcherModTime(filePath: string): Promise<void> {
    const watchInfo = this.fileWatchers.get(filePath);
    if (watchInfo) {
      try {
        const file = Bun.file(filePath);
        const stat = await file.stat();
        if (stat?.mtime) {
          watchInfo.lastModTime = stat.mtime.getTime();
        }
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Check all watched files for changes
   */
  private async checkForFileChanges(): Promise<void> {
    // Skip if a dialog is already open
    if (this.externalChangeDialog.isOpen || this.closeConfirmDialog.isOpen) return;
    
    for (const openDoc of this.documents) {
      const filePath = openDoc.document.filePath;
      if (!filePath) continue;
      
      const watchInfo = this.fileWatchers.get(filePath);
      if (!watchInfo) {
        // Start watching this file
        await this.watchFile(filePath);
        continue;
      }
      
      try {
        const file = Bun.file(filePath);
        const stat = await file.stat();
        if (!stat) continue;
        
        const currentModTime = stat.mtime?.getTime() ?? 0;
        
        if (currentModTime > watchInfo.lastModTime) {
          // File has changed
          watchInfo.lastModTime = currentModTime;
          
          if (openDoc.document.isDirty) {
            // Document has local changes - show conflict dialog
            this.showExternalChangeDialog(openDoc.id, openDoc.document.fileName);
          } else {
            // No local changes - auto-reload
            await this.reloadDocument(openDoc.id);
          }
        }
      } catch {
        // File may have been deleted - ignore
      }
    }
  }

  /**
   * Show dialog for external file change when local changes exist
   */
  private showExternalChangeDialog(documentId: string, fileName: string): void {
    this.externalChangeDialog = {
      isOpen: true,
      documentId,
      fileName
    };
    renderer.scheduleRender();
  }

  /**
   * Handle external change dialog response
   */
  private handleExternalChangeDialog(key: string): boolean {
    if (!this.externalChangeDialog.isOpen) return false;
    
    const docId = this.externalChangeDialog.documentId;
    
    if (key === 'r' || key === 'R') {
      // Reload - discard local changes
      if (docId) {
        this.reloadDocument(docId);
      }
      this.externalChangeDialog.isOpen = false;
      return true;
    } else if (key === 'k' || key === 'K') {
      // Keep local changes
      this.externalChangeDialog.isOpen = false;
      renderer.scheduleRender();
      return true;
    } else if (key === 'ESCAPE') {
      // Cancel - same as keep
      this.externalChangeDialog.isOpen = false;
      renderer.scheduleRender();
      return true;
    }
    
    return false;
  }

  /**
   * Reload a document from disk
   */
  private async reloadDocument(documentId: string): Promise<void> {
    const openDoc = this.documents.find(d => d.id === documentId);
    if (!openDoc) return;
    
    const success = await openDoc.document.reload();
    if (success) {
      // Update file watcher mod time
      if (openDoc.document.filePath) {
        const watchInfo = this.fileWatchers.get(openDoc.document.filePath);
        if (watchInfo) {
          const file = Bun.file(openDoc.document.filePath);
          const stat = await file.stat();
          if (stat?.mtime) {
            watchInfo.lastModTime = stat.mtime.getTime();
          }
        }
        
        // Notify LSP of content change
        if (this.lspEnabled) {
          const uri = `file://${openDoc.document.filePath}`;
          await lspManager.changeDocument(uri, openDoc.document.content);
        }
      }
      
      // Update editor pane if this is the active document
      // Document is shared so all panes viewing it will update automatically
      
      statusBar.setMessage(`Reloaded: ${openDoc.document.fileName}`, 2000);
    } else {
      statusBar.setMessage(`Failed to reload: ${openDoc.document.fileName}`, 3000);
    }
    
    renderer.scheduleRender();
  }

  /**
   * Render external change dialog
   */
  private renderExternalChangeDialog(ctx: RenderContext): void {
    if (!this.externalChangeDialog.isOpen) return;
    
    const dialogWidth = 55;
    const dialogHeight = 8;
    const dialogX = Math.floor((renderer.width - dialogWidth) / 2);
    const dialogY = Math.floor((renderer.height - dialogHeight) / 2);

    const bgColor = '#2d2d2d';
    const borderColor = '#e5c07b';

    // Background
    ctx.fill(dialogX, dialogY, dialogWidth, dialogHeight, ' ', undefined, bgColor);

    // Border
    ctx.drawStyled(dialogX, dialogY, '╭' + '─'.repeat(dialogWidth - 2) + '╮', borderColor, bgColor);
    for (let y = dialogY + 1; y < dialogY + dialogHeight - 1; y++) {
      ctx.drawStyled(dialogX, y, '│', borderColor, bgColor);
      ctx.drawStyled(dialogX + dialogWidth - 1, y, '│', borderColor, bgColor);
    }
    ctx.drawStyled(dialogX, dialogY + dialogHeight - 1, '╰' + '─'.repeat(dialogWidth - 2) + '╯', borderColor, bgColor);

    // Title
    const title = ' File Changed Externally ';
    const titleX = dialogX + Math.floor((dialogWidth - title.length) / 2);
    ctx.drawStyled(titleX, dialogY, title, '#e5c07b', bgColor);

    // Message
    const filename = this.externalChangeDialog.fileName;
    const truncatedName = filename.length > dialogWidth - 6 ? filename.slice(0, dialogWidth - 9) + '...' : filename;
    ctx.drawStyled(dialogX + 2, dialogY + 2, truncatedName, '#d4d4d4', bgColor);
    ctx.drawStyled(dialogX + 2, dialogY + 3, 'has changed. You have unsaved changes.', '#888888', bgColor);

    // Options
    const options = '(R)eload from disk  (K)eep local changes';
    const optX = dialogX + Math.floor((dialogWidth - options.length) / 2);
    ctx.drawStyled(optX, dialogY + 5, options, '#98c379', bgColor);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const app = new App();

export default app;
