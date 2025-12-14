/**
 * Main Application Orchestrator
 * 
 * Coordinates all components and handles the main application lifecycle.
 */

import { Document } from './core/document.ts';
import { type Position } from './core/buffer.ts';
import { clonePosition, hasSelection, getSelectionRange } from './core/cursor.ts';
import { renderer, type RenderContext } from './ui/renderer.ts';
import { layoutManager } from './ui/layout.ts';
import { mouseManager, type MouseEvent as UltraMouseEvent } from './ui/mouse.ts';
import { EditorPane } from './ui/components/editor-pane.ts';
import { statusBar } from './ui/components/status-bar.ts';
import { tabBar, type Tab } from './ui/components/tab-bar.ts';
import { filePicker } from './ui/components/file-picker.ts';
import { fileBrowser } from './ui/components/file-browser.ts';
import { commandPalette } from './ui/components/command-palette.ts';
import { commandRegistry } from './input/commands.ts';
import { keymap, type ParsedKey } from './input/keymap.ts';
import { keybindingsLoader } from './input/keybindings-loader.ts';
import { settings } from './config/settings.ts';
import { settingsLoader } from './config/settings-loader.ts';
import { defaultKeybindings, defaultSettings } from './config/defaults.ts';
import { type KeyEvent, type MouseEventData } from './terminal/index.ts';

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
  private lastClickPosition: Position | null = null;
  private lastClickTime: number = 0;
  private clickCount: number = 0;

  constructor() {
    this.editorPane = new EditorPane();
    this.setupEditorCallbacks();
  }

  /**
   * Initialize and start the application
   */
  async start(filePath?: string): Promise<void> {
    try {
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
    renderer.cleanup();
  }

  /**
   * Load configuration files
   */
  private async loadConfiguration(): Promise<void> {
    // Load embedded default keybindings
    keymap.loadBindings(defaultKeybindings);

    // Load embedded default settings
    settings.update(defaultSettings);

    // Try to load user overrides from config files (optional, won't fail if missing)
    try {
      const userBindings = await keybindingsLoader.loadFromFile(
        new URL('../config/default-keybindings.json', import.meta.url).pathname
      );
      if (userBindings.length > 0) {
        keymap.loadBindings(userBindings);
      }
    } catch {
      // Use embedded defaults
    }

    try {
      const userSettings = await settingsLoader.loadFromFile(
        new URL('../config/default-settings.json', import.meta.url).pathname
      );
      if (userSettings && Object.keys(userSettings).length > 0) {
        settings.update(userSettings);
      }
    } catch {
      // Use embedded defaults
    }
  }

  /**
   * Setup keyboard event handler
   */
  private setupKeyboardHandler(): void {
    renderer.onKey(async (event: KeyEvent) => {
      if (!this.isRunning) return;

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
          commandPalette.confirm();
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
      statusBar.setMessage(`Key: ${event.key} | Parsed: ${keyStr} -> ${commandId || 'none'}`, 2000);
      
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
   * Insert a character
   */
  private insertCharacter(char: string): void {
    const doc = this.getActiveDocument();
    if (!doc) return;

    doc.insert(char);
    this.editorPane.ensureCursorVisible();
    this.updateStatusBar();
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
    mouseManager.registerHandler(this.editorPane);
    mouseManager.registerHandler(tabBar);
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
    this.editorPane.onClick((position, _clickCount, event) => {
      const doc = this.getActiveDocument();
      if (!doc) return;

      // Handle click counting for double/triple click
      const now = Date.now();
      const isSamePosition = this.lastClickPosition &&
        this.lastClickPosition.line === position.line &&
        Math.abs(this.lastClickPosition.column - position.column) <= 1;

      if (now - this.lastClickTime < 300 && isSamePosition) {
        this.clickCount = (this.clickCount % 3) + 1;
      } else {
        this.clickCount = 1;
      }

      this.lastClickTime = now;
      this.lastClickPosition = clonePosition(position);

      if (event.meta) {
        // Cmd+Click adds cursor
        doc.cursorManager.addCursor(position);
      } else if (event.shift) {
        // Shift+Click extends selection
        doc.cursorManager.setPosition(position, true);
      } else {
        // Normal click
        if (this.clickCount === 1) {
          doc.cursorManager.setSingle(position);
        } else if (this.clickCount === 2) {
          // Double click - select word
          this.selectWordAt(position);
        } else if (this.clickCount === 3) {
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
      this.closeDocument(tabId);
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

    // Render tab bar
    tabBar.setRect(tabBarRect);
    tabBar.setTabs(this.getTabs());
    tabBar.render(ctx);

    // Render editor pane
    this.editorPane.setRect(editorRect);
    this.editorPane.render(ctx);

    // Render status bar
    statusBar.setRect(statusBarRect);
    statusBar.render(ctx);

    // Render file picker (on top of everything)
    filePicker.render(ctx);

    // Render file browser (on top of file picker)
    fileBrowser.render(ctx);

    // Render command palette (on top of everything)
    commandPalette.render(ctx);

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
    
    statusBar.setState({
      document: doc?.getState() || null,
      cursorPosition: doc?.primaryCursor.position || { line: 0, column: 0 },
      cursorCount: doc?.cursorManager.count || 1
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
            await doc.save();
            this.updateStatusBar();
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
            this.closeDocument(this.activeDocumentId);
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
        handler: () => layoutManager.toggleSidebar()
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
      
      // Search/Navigate placeholders
      {
        id: 'ultra.find',
        title: 'Find',
        category: 'Search',
        handler: () => {
          // TODO: Implement find UI
        }
      },
      {
        id: 'ultra.findNext',
        title: 'Find Next',
        category: 'Search',
        handler: () => {
          // TODO: Implement find next
        }
      },
      {
        id: 'ultra.findPrevious',
        title: 'Find Previous',
        category: 'Search',
        handler: () => {
          // TODO: Implement find previous
        }
      },
      {
        id: 'ultra.replace',
        title: 'Replace',
        category: 'Search',
        handler: () => {
          // TODO: Implement replace UI
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
      }
    ]);
  }

  /**
   * Move cursor helper
   */
  private moveCursor(
    direction: 'left' | 'right' | 'up' | 'down' | 'lineStart' | 'lineEnd' | 'fileStart' | 'fileEnd' | 'wordLeft' | 'wordRight',
    selecting: boolean = false
  ): void {
    const doc = this.getActiveDocument();
    if (!doc) return;

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
    }

    this.editorPane.ensureCursorVisible();
    this.updateStatusBar();
  }

  /**
   * Open a file
   */
  async openFile(filePath: string): Promise<void> {
    try {
      // Check if already open
      const existing = this.documents.find(d => d.document.filePath === filePath);
      if (existing) {
        this.activateDocument(existing.id);
        return;
      }

      const document = await Document.fromFile(filePath);
      const id = this.generateId();
      
      this.documents.push({ id, document });
      this.activateDocument(id);
    } catch (error) {
      console.error('Failed to open file:', error);
    }
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
   * Close a document
   */
  closeDocument(id: string): void {
    const index = this.documents.findIndex(d => d.id === id);
    if (index < 0) return;

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
