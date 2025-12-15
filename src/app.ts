/**
 * Main Application Orchestrator
 * 
 * Coordinates all components and handles the main application lifecycle.
 */

import * as path from 'path';
import { Document } from './core/document.ts';
import { type Position } from './core/buffer.ts';
import { hasSelection } from './core/cursor.ts';
import { renderer, type RenderContext } from './ui/renderer.ts';
import { layoutManager } from './ui/layout.ts';
import { mouseManager, type MouseEvent as UltraMouseEvent } from './ui/mouse.ts';
import { EditorPane } from './ui/components/editor-pane.ts';
import { statusBar } from './ui/components/status-bar.ts';
import { tabBar, type Tab } from './ui/components/tab-bar.ts';
import { filePicker } from './ui/components/file-picker.ts';
import { fileBrowser } from './ui/components/file-browser.ts';
import { commandPalette } from './ui/components/command-palette.ts';
import { fileTree } from './ui/components/file-tree.ts';
import { searchWidget } from './ui/components/search-widget.ts';
import { inputDialog } from './ui/components/input-dialog.ts';
import { saveBrowser } from './ui/components/save-browser.ts';
import { commandRegistry } from './input/commands.ts';
import { keymap, type ParsedKey } from './input/keymap.ts';
import { settings } from './config/settings.ts';
import { userConfigManager } from './config/user-config.ts';
import { type KeyEvent, type MouseEventData } from './terminal/index.ts';
import { themeLoader } from './ui/themes/theme-loader.ts';
import { shouldAutoPair, shouldSkipClosing, shouldDeletePair } from './core/auto-pair.ts';
import { lspManager, autocompletePopup, hoverTooltip, signatureHelp, diagnosticsRenderer } from './features/lsp/index.ts';

interface OpenDocument {
  id: string;
  document: Document;
}

export class App {
  private documents: OpenDocument[] = [];
  private activeDocumentId: string | null = null;
  private editorPane: EditorPane;
  private isRunning: boolean = false;
  private clipboard: string = '';
  private lspEnabled: boolean = true;
  private completionTriggerTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Close confirmation dialog state
  private closeConfirmDialog: {
    isOpen: boolean;
    documentId: string | null;
    fileName: string;
  } = { isOpen: false, documentId: null, fileName: '' };

  constructor() {
    this.editorPane = new EditorPane();
    this.setupEditorCallbacks();
  }

  /**
   * Initialize and start the application
   */
  async start(filePath?: string, options?: { debug?: boolean }): Promise<void> {
    try {
      // Enable debug logging if requested
      if (options?.debug) {
        lspManager.setDebugEnabled(true);
      }

      // Load configuration
      await this.loadConfiguration();

      // Initialize renderer
      await renderer.init();

      // Update layout dimensions
      layoutManager.updateDimensions(renderer.width, renderer.height);

      // Setup event handlers
      this.setupKeyboardHandler();
      this.setupMouseHandler();
      this.setupRenderCallback();

      // Register commands
      this.registerCommands();
      
      // Initialize file tree with workspace root
      const workspaceRoot = process.cwd();
      await fileTree.loadDirectory(workspaceRoot);
      fileTree.onFileSelect(async (path) => {
        await this.openFile(path);
        fileTree.setFocused(false);
        renderer.scheduleRender();
      });

      // Apply initial settings (sidebar visibility, etc.)
      this.applySettings();

      // Initialize LSP manager with workspace root
      lspManager.setWorkspaceRoot(workspaceRoot);
      await this.initializeLSP();

      // Open file if provided
      if (filePath) {
        await this.openFile(filePath);
      } else {
        // Create empty document
        this.newFile();
      }

      this.isRunning = true;

      // Initial render
      renderer.scheduleRender();

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
    
    // Shutdown LSP servers
    lspManager.shutdown();
    
    renderer.cleanup();
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
        this.editorPane.ensureCursorVisible();
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

      // Handle file tree input if it's focused
      if (fileTree.getFocused()) {
        const handled = await fileTree.handleKey(event.key, event.ctrl, event.shift, event.char);
        if (handled) {
          renderer.scheduleRender();
          return;
        }
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
      this.editorPane.ensureCursorVisible();
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
    
    this.editorPane.ensureCursorVisible();
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
    while (startCol > 0 && this.isIdentifierChar(line[startCol - 1])) {
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
          doc.filePath,
          cursor.position.line,
          cursor.position.column
        );

        if (completions && completions.length > 0) {
          // Calculate screen position for popup (at start of prefix)
          const editorRect = layoutManager.getEditorAreaRect();
          const gutterWidth = 5;  // Approximate
          const screenX = editorRect.x + gutterWidth + startColumn - this.editorPane.getScrollLeft();
          const screenY = editorRect.y + cursor.position.line - this.editorPane.getScrollTop();
          
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
        const screenX = editorRect.x + gutterWidth + cursor.position.column - this.editorPane.getScrollLeft();
        const screenY = editorRect.y + cursor.position.line - this.editorPane.getScrollTop();
        
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
          this.editorPane.ensureCursorVisible();
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
            this.editorPane.ensureCursorVisible();
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
    const fs = require('fs');
    const logDebug = (msg: string) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync('./debug.log', `[${timestamp}] [showHover] ${msg}\n`);
    };
    
    logDebug('showHover called');
    
    const doc = this.getActiveDocument();
    if (!doc || !doc.filePath) {
      logDebug('No document or filePath');
      statusBar.setMessage('No file open', 2000);
      return;
    }

    logDebug(`Document: ${doc.filePath}, language: ${doc.language}`);
    const cursor = doc.primaryCursor;
    logDebug(`Cursor: line ${cursor.position.line}, col ${cursor.position.column}`);

    try {
      logDebug('Calling lspManager.getHover...');
      // Fetch hover and document symbols in parallel
      const [hover, symbols] = await Promise.all([
        lspManager.getHover(
          doc.filePath,
          cursor.position.line,
          cursor.position.column
        ),
        lspManager.getDocumentSymbols(doc.filePath)
      ]);
      logDebug(`Hover result: ${hover ? JSON.stringify(hover).substring(0, 200) : 'null'}`);
      logDebug(`Symbols count: ${symbols?.length || 0}`);

      if (hover) {
        // Calculate screen position for tooltip
        const editorRect = layoutManager.getEditorAreaRect();
        const gutterWidth = 5;
        const screenX = editorRect.x + gutterWidth + cursor.position.column - this.editorPane.getScrollLeft();
        const screenY = editorRect.y + cursor.position.line - this.editorPane.getScrollTop();
        
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
      logDebug(`Error: ${err}`);
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
    inputDialog.show({
      title: 'Rename Symbol',
      placeholder: `Enter new name for '${currentWord}'`,
      initialValue: currentWord,
      screenWidth: renderer.width,
      screenHeight: renderer.height,
      onConfirm: async (newName: string) => {
        if (!newName || newName === currentWord) return;
        
        try {
          const workspaceEdit = await lspManager.rename(
            doc.filePath,
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
      
      // Only render for meaningful events
      if (event.type !== 'wheel') {
        renderer.scheduleRender();
      }
    });

    // Register editor pane as mouse handler
    mouseManager.registerHandler(commandPalette);
    mouseManager.registerHandler(fileBrowser);
    mouseManager.registerHandler(filePicker);
    mouseManager.registerHandler(searchWidget);
    mouseManager.registerHandler(tabBar);
    mouseManager.registerHandler(this.editorPane);
    mouseManager.registerHandler(this.editorPane.getMinimap());
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
   * Setup editor pane callbacks
   */
  private setupEditorCallbacks(): void {
    this.editorPane.onClick((position, clickCount, event) => {
      const doc = this.getActiveDocument();
      if (!doc) return;

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
          this.selectWordAt(position);
        } else if (clickCount === 3) {
          // Triple click - select line
          doc.selectLine();
        }
      }

      this.editorPane.ensureCursorVisible();
      this.updateStatusBar();
    });

    this.editorPane.onDrag((position, event) => {
      const doc = this.getActiveDocument();
      if (!doc) return;

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

      this.editorPane.ensureCursorVisible();
      this.updateStatusBar();
    });

    this.editorPane.onScroll(() => {
      renderer.scheduleRender();
    });

    // Tab bar callbacks
    tabBar.onTabClick((tabId) => {
      this.activateDocument(tabId);
      renderer.scheduleRender();
    });

    tabBar.onTabClose((tabId) => {
      this.requestCloseDocument(tabId);
      renderer.scheduleRender();
    });
  }

  /**
   * Select word at position
   */
  private selectWordAt(position: Position): void {
    const doc = this.getActiveDocument();
    if (!doc) return;

    const line = doc.getLine(position.line);
    let start = position.column;
    let end = position.column;

    // Find word boundaries
    while (start > 0 && this.isWordChar(line[start - 1]!)) {
      start--;
    }
    while (end < line.length && this.isWordChar(line[end]!)) {
      end++;
    }

    doc.cursorManager.setSelections([{
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
    // Hide cursor during render to prevent flickering
    renderer.hideCursor();
    
    // Update layout
    layoutManager.updateDimensions(ctx.width, ctx.height);

    // Get layout rects
    const tabBarRect = layoutManager.getTabBarRect();
    const statusBarRect = layoutManager.getStatusBarRect();
    const editorRect = layoutManager.getEditorAreaRect();
    const sidebarRect = layoutManager.getSidebarRect();

    // Render file tree sidebar (if visible)
    if (sidebarRect) {
      fileTree.setRect(sidebarRect);
      fileTree.setVisible(true);
      fileTree.render(ctx);
    } else {
      fileTree.setVisible(false);
    }

    // Render tab bar
    tabBar.setRect(tabBarRect);
    tabBar.setTabs(this.getTabs());
    tabBar.render(ctx);

    // Render editor pane
    this.editorPane.setRect(editorRect);
    this.editorPane.render(ctx);

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

    // Render save browser (on top of everything)
    saveBrowser.render(ctx);

    // Render LSP UI components
    autocompletePopup.render(ctx, ctx.width, ctx.height);
    hoverTooltip.render(ctx, ctx.width, ctx.height);
    signatureHelp.render(ctx, ctx.width, ctx.height);

    // Render close confirmation dialog (on top of everything)
    this.renderCloseConfirmDialog(ctx);

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
            this.editorPane.ensureCursorVisible();
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
            this.editorPane.ensureCursorVisible();
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
              this.editorPane.ensureCursorVisible();
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
              this.editorPane.ensureCursorVisible();
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
            this.editorPane.ensureCursorVisible();
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
            this.editorPane.ensureCursorVisible();
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
            this.editorPane.ensureCursorVisible();
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
            this.editorPane.ensureCursorVisible();
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
        }
      },
      {
        id: 'ultra.toggleTerminal',
        title: 'Toggle Terminal',
        category: 'View',
        handler: () => layoutManager.toggleTerminal()
      },
      {
        id: 'ultra.toggleAIPanel',
        title: 'Toggle AI Panel',
        category: 'View',
        handler: () => layoutManager.toggleAIPanel()
      },
      {
        id: 'ultra.toggleMinimap',
        title: 'Toggle Minimap',
        category: 'View',
        handler: () => {
          this.editorPane.toggleMinimap();
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
          fileBrowser.show(workspaceRoot, renderer.width, renderer.height);
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
            currentTheme
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
            this.editorPane.ensureCursorVisible();
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
            this.editorPane.ensureCursorVisible();
            this.updateStatusBar();
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
            this.editorPane.ensureCursorVisible();
            this.updateStatusBar();
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
            this.editorPane.ensureCursorVisible();
            this.updateStatusBar();
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
            this.editorPane.ensureCursorVisible();
            this.updateStatusBar();
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
            this.editorPane.ensureCursorVisible();
            this.updateStatusBar();
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
                this.editorPane.ensureCursorVisible();
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
                this.editorPane.ensureCursorVisible();
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
          await filePicker.show(workspaceRoot, renderer.width, renderer.height);
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
          commandPalette.show(commands, renderer.width, renderer.height);
          commandPalette.onSelect(async (command) => {
            await commandRegistry.execute(command.id);
          });
          renderer.scheduleRender();
        }
      },
      {
        id: 'ultra.splitVertical',
        title: 'Split Editor Vertical',
        category: 'View',
        handler: () => {
          // TODO: Implement split view
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
          lspManager.setDebug(true);
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

    const pageSize = Math.max(1, this.editorPane.getVisibleLineCount() - 2);

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

    this.editorPane.ensureCursorVisible();
    this.updateStatusBar();
  }

  /**
   * Open a file
   */
  async openFile(filePath: string): Promise<void> {
    try {
      // Resolve to absolute path for LSP compatibility
      const absolutePath = path.resolve(filePath);
      
      // Check if already open
      const existing = this.documents.find(d => d.document.filePath === absolutePath);
      if (existing) {
        this.activateDocument(existing.id);
        return;
      }

      const document = await Document.fromFile(absolutePath);
      const id = this.generateId();
      
      this.documents.push({ id, document });
      this.activateDocument(id);

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

    saveBrowser.show({
      startPath: startDir,
      suggestedFilename: suggestedName,
      screenWidth: renderer.width,
      screenHeight: renderer.height,
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
    const document = new Document();
    const id = this.generateId();
    
    this.documents.push({ id, document });
    this.activateDocument(id);
  }

  /**
   * Activate a document
   */
  activateDocument(id: string): void {
    const doc = this.documents.find(d => d.id === id);
    if (!doc) return;

    this.activeDocumentId = id;
    this.editorPane.setDocument(doc.document);
    this.updateStatusBar();
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

    this.documents.splice(index, 1);

    if (this.activeDocumentId === id) {
      if (this.documents.length > 0) {
        const newIndex = Math.min(index, this.documents.length - 1);
        this.activateDocument(this.documents[newIndex]!.id);
      } else {
        this.activeDocumentId = null;
        this.editorPane.setDocument(null);
        this.updateStatusBar();
      }
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
            this.closeDocument(docId);
          } else {
            // No file path, need save-as first
            saveBrowser.show({
              startPath: process.cwd(),
              suggestedFilename: doc.fileName,
              screenWidth: renderer.width,
              screenHeight: renderer.height,
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
   * Generate unique ID
   */
  private generateId(): string {
    return `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const app = new App();

export default app;
