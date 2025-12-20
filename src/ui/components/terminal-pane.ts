/**
 * Terminal Pane Component
 * 
 * Embedded terminal with full PTY support.
 * Supports multiple terminal instances and split layouts.
 */

import { PTY, type TerminalCell } from '../../terminal/pty.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { settings } from '../../config/settings.ts';
import { hexToRgb } from '../colors.ts';

interface TerminalInstance {
  id: string;
  pty: PTY;
  title: string;
}

export class TerminalPane implements MouseHandler {
  private rect: Rect = { x: 1, y: 1, width: 80, height: 10 };
  private isFocused: boolean = false;
  private terminals: TerminalInstance[] = [];
  private activeTerminalIndex: number = 0;
  private terminalIdCounter: number = 0;
  private tabPositions: { index: number; startX: number; endX: number; closeX: number }[] = [];
  
  // Theme colors
  private bgColor: string = '#1e1e1e';
  private fgColor: string = '#cccccc';
  private cursorColor: string = '#ffffff';
  private titleBgColor: string = '#333333';
  private titleFgColor: string = '#cccccc';
  private activeTitleBgColor: string = '#007acc';
  
  // Callbacks
  private onUpdateCallback?: () => void;
  private onFocusCallback?: () => void;

  constructor() {
    this.loadThemeColors();
  }

  /**
   * Load colors from theme
   */
  private loadThemeColors(): void {
    this.bgColor = themeLoader.getColor('terminal.background') || 
                   themeLoader.getColor('editor.background') || '#1e1e1e';
    this.fgColor = themeLoader.getColor('terminal.foreground') || 
                   themeLoader.getColor('editor.foreground') || '#cccccc';
    this.cursorColor = themeLoader.getColor('terminalCursor.foreground') || '#ffffff';
    this.titleBgColor = themeLoader.getColor('tab.inactiveBackground') || '#333333';
    this.titleFgColor = themeLoader.getColor('tab.inactiveForeground') || '#cccccc';
    this.activeTitleBgColor = themeLoader.getColor('tab.activeBackground') || '#007acc';
  }

  /**
   * Set the terminal pane rectangle
   */
  setRect(rect: Rect): void {
    this.rect = rect;
    
    // Resize all terminal instances
    const terminalRect = this.getTerminalContentRect();
    for (const terminal of this.terminals) {
      terminal.pty.resize(terminalRect.width, terminalRect.height);
    }
  }

  /**
   * Get the content area rect (excluding title bar)
   */
  private getTerminalContentRect(): Rect {
    return {
      x: this.rect.x,
      y: this.rect.y + 1,  // Account for title bar
      width: this.rect.width,
      height: this.rect.height - 1
    };
  }

  /**
   * Set focus state
   */
  setFocused(focused: boolean): void {
    this.isFocused = focused;
    if (focused && this.onFocusCallback) {
      this.onFocusCallback();
    }
  }

  /**
   * Check if focused
   */
  getFocused(): boolean {
    return this.isFocused;
  }

  /**
   * Create a new terminal instance
   */
  async createTerminal(cwd?: string): Promise<string> {
    const id = `terminal-${++this.terminalIdCounter}`;
    // Get shell from settings, fall back to env or /bin/zsh
    const shellSetting = settings.get('terminal.integrated.shell');
    const shell = shellSetting && shellSetting.length > 0 
      ? shellSetting 
      : (process.env.SHELL || '/bin/zsh');
    
    const contentRect = this.getTerminalContentRect();
    const scrollback = settings.get('terminal.integrated.scrollback') || 1000;
    const pty = new PTY({
      shell,
      cwd: cwd || process.cwd(),
      cols: Math.max(1, contentRect.width),
      rows: Math.max(1, contentRect.height),
      scrollback
    });
    
    const terminal: TerminalInstance = {
      id,
      pty,
      title: shell.split('/').pop() || 'Terminal'
    };
    
    // Set up callbacks
    pty.onUpdate(() => {
      if (this.onUpdateCallback) {
        this.onUpdateCallback();
      }
    });
    
    pty.onTitle((title) => {
      terminal.title = title;
      if (this.onUpdateCallback) {
        this.onUpdateCallback();
      }
    });
    
    pty.onExit(() => {
      this.closeTerminal(id);
    });
    
    this.terminals.push(terminal);
    this.activeTerminalIndex = this.terminals.length - 1;
    
    // Start the PTY
    await pty.start();
    
    return id;
  }

  /**
   * Close a terminal instance
   */
  closeTerminal(id: string): void {
    const index = this.terminals.findIndex(t => t.id === id);
    if (index === -1) return;
    
    const terminal = this.terminals[index]!;
    terminal.pty.kill();
    this.terminals.splice(index, 1);
    
    // Adjust active index
    if (this.activeTerminalIndex >= this.terminals.length) {
      this.activeTerminalIndex = Math.max(0, this.terminals.length - 1);
    }
    
    if (this.onUpdateCallback) {
      this.onUpdateCallback();
    }
  }

  /**
   * Get the active terminal
   */
  getActiveTerminal(): TerminalInstance | null {
    return this.terminals[this.activeTerminalIndex] || null;
  }

  /**
   * Switch to a specific terminal by index
   */
  setActiveTerminal(index: number): void {
    if (index >= 0 && index < this.terminals.length) {
      this.activeTerminalIndex = index;
      if (this.onUpdateCallback) {
        this.onUpdateCallback();
      }
    }
  }

  /**
   * Cycle to next terminal
   */
  nextTerminal(): void {
    if (this.terminals.length > 1) {
      this.activeTerminalIndex = (this.activeTerminalIndex + 1) % this.terminals.length;
      if (this.onUpdateCallback) {
        this.onUpdateCallback();
      }
    }
  }

  /**
   * Cycle to previous terminal
   */
  previousTerminal(): void {
    if (this.terminals.length > 1) {
      this.activeTerminalIndex = (this.activeTerminalIndex - 1 + this.terminals.length) % this.terminals.length;
      if (this.onUpdateCallback) {
        this.onUpdateCallback();
      }
    }
  }

  /**
   * Get terminal count
   */
  getTerminalCount(): number {
    return this.terminals.length;
  }

  /**
   * Close a terminal by index
   */
  closeTerminal(index: number): void {
    if (index < 0 || index >= this.terminals.length) return;
    
    const terminal = this.terminals[index];
    if (terminal) {
      terminal.pty.kill();
      this.terminals.splice(index, 1);
      
      // Adjust active index if needed
      if (this.terminals.length === 0) {
        this.activeTerminalIndex = 0;
      } else if (this.activeTerminalIndex >= this.terminals.length) {
        this.activeTerminalIndex = this.terminals.length - 1;
      } else if (index < this.activeTerminalIndex) {
        this.activeTerminalIndex--;
      }
      
      if (this.onUpdateCallback) {
        this.onUpdateCallback();
      }
    }
  }

  /**
   * Write to the active terminal
   */
  write(data: string): void {
    const terminal = this.getActiveTerminal();
    if (terminal) {
      terminal.pty.write(data);
    }
  }

  /**
   * Handle a key event
   * @param key - The key name (uppercase, e.g., 'A', 'ENTER', 'BACKSPACE')
   * @param char - The actual character typed (with proper case)
   */
  handleKeyEvent(key: string, char: string | undefined, ctrl: boolean, alt: boolean, shift: boolean): boolean {
    const terminal = this.getActiveTerminal();
    if (!terminal) return false;
    
    // Handle special keys
    if (ctrl) {
      // Ctrl+C, Ctrl+D, etc. should be passed through
      if (key.length === 1) {
        const code = key.toUpperCase().charCodeAt(0) - 64;
        if (code >= 0 && code <= 31) {
          terminal.pty.write(String.fromCharCode(code));
          return true;
        }
      }
    }
    
    // Map special keys to escape sequences
    // Key names come from InputHandler which uses UPPERCASE
    const keyMap: Record<string, string> = {
      'UP': '\x1b[A',
      'DOWN': '\x1b[B',
      'RIGHT': '\x1b[C',
      'LEFT': '\x1b[D',
      'HOME': '\x1b[H',
      'END': '\x1b[F',
      'PAGEUP': '\x1b[5~',
      'PAGEDOWN': '\x1b[6~',
      'INSERT': '\x1b[2~',
      'DELETE': '\x1b[3~',
      'BACKSPACE': '\x7f',
      'TAB': '\t',
      'ENTER': '\r',
      'ESCAPE': '\x1b',
      'F1': '\x1bOP',
      'F2': '\x1bOQ',
      'F3': '\x1bOR',
      'F4': '\x1bOS',
      'F5': '\x1b[15~',
      'F6': '\x1b[17~',
      'F7': '\x1b[18~',
      'F8': '\x1b[19~',
      'F9': '\x1b[20~',
      'F10': '\x1b[21~',
      'F11': '\x1b[23~',
      'F12': '\x1b[24~',
    };
    
    if (keyMap[key]) {
      terminal.pty.write(keyMap[key]!);
      return true;
    }
    
    // Regular characters - use char for proper case
    if (char && char.length === 1 && !ctrl && !alt) {
      terminal.pty.write(char);
      return true;
    }
    
    return false;
  }

  /**
   * Render the terminal pane
   */
  render(ctx: RenderContext): void {
    this.loadThemeColors();
    
    // Render title bar with terminal tabs
    this.renderTitleBar(ctx);
    
    // Render terminal content
    const terminal = this.getActiveTerminal();
    if (terminal) {
      this.renderTerminalContent(ctx, terminal);
    } else {
      this.renderEmptyState(ctx);
    }
  }

  /**
   * Render the title bar
   */
  private renderTitleBar(ctx: RenderContext): void {
    // Adjust background brightness when focused (same as file-tree/git-panel/tab-bar)
    const bgColor = this.isFocused ? themeLoader.getFocusedBackground(this.titleBgColor) : this.titleBgColor;
    const bgRgb = hexToRgb(bgColor);
    const fgRgb = hexToRgb(this.titleFgColor);

    // Background
    let output = `\x1b[${this.rect.y};${this.rect.x}H`;
    if (bgRgb) output += `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
    if (fgRgb) output += `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m`;
    output += ' '.repeat(this.rect.width);

    // Terminal tabs
    this.tabPositions = [];
    let x = this.rect.x;
    for (let i = 0; i < this.terminals.length; i++) {
      const terminal = this.terminals[i]!;
      const isActive = i === this.activeTerminalIndex;
      const titleText = `${i + 1}: ${terminal.title.substring(0, 12)}`;
      // Layout: space + title + space + × + space = titleText.length + 4
      const tabWidth = titleText.length + 4;
      
      if (x + tabWidth > this.rect.x + this.rect.width - 10) break;
      
      // Track tab position for click handling
      // × is at position: x + 1 + titleText.length + 1 = x + titleText.length + 2
      const closeButtonX = x + titleText.length + 2;
      this.tabPositions.push({
        index: i,
        startX: x,
        endX: x + tabWidth,
        closeX: closeButtonX
      });
      
      output += `\x1b[${this.rect.y};${x}H`;
      
      if (isActive) {
        const activeBg = hexToRgb(this.activeTitleBgColor);
        if (activeBg) output += `\x1b[48;2;${activeBg.r};${activeBg.g};${activeBg.b}m`;
      } else {
        if (bgRgb) output += `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
      }
      if (fgRgb) output += `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m`;
      
      // Tab content: space + title + space
      output += ` ${titleText} `;
      
      // Close button (dimmer color)
      const closeFg = isActive 
        ? { r: Math.floor((fgRgb?.r || 200) * 0.7), g: Math.floor((fgRgb?.g || 200) * 0.7), b: Math.floor((fgRgb?.b || 200) * 0.7) }
        : { r: Math.floor((fgRgb?.r || 200) * 0.5), g: Math.floor((fgRgb?.g || 200) * 0.5), b: Math.floor((fgRgb?.b || 200) * 0.5) };
      output += `\x1b[38;2;${closeFg.r};${closeFg.g};${closeFg.b}m×\x1b[38;2;${fgRgb?.r || 200};${fgRgb?.g || 200};${fgRgb?.b || 200}m `;
      
      x += tabWidth;
    }
    
    // New terminal button
    const newBtn = ' + ';
    output += `\x1b[${this.rect.y};${this.rect.x + this.rect.width - newBtn.length}H`;
    if (bgRgb) output += `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
    if (fgRgb) output += `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m`;
    output += newBtn;
    
    output += '\x1b[0m';
    ctx.buffer(output);
  }

  /**
   * Render terminal content
   */
  private renderTerminalContent(ctx: RenderContext, terminal: TerminalInstance): void {
    const contentRect = this.getTerminalContentRect();
    const buffer = terminal.pty.getBuffer();
    const cursor = terminal.pty.getCursor();
    const viewOffset = terminal.pty.getViewOffset();

    // Adjust background brightness when focused (same as file-tree/git-panel)
    const bgColor = this.isFocused ? themeLoader.getFocusedBackground(this.bgColor) : this.bgColor;
    const defaultBg = hexToRgb(bgColor);
    const defaultFg = hexToRgb(this.fgColor);
    
    for (let y = 0; y < contentRect.height; y++) {
      const line = buffer[y];
      if (!line) {
        // Empty line
        let output = `\x1b[${contentRect.y + y};${contentRect.x}H`;
        if (defaultBg) output += `\x1b[48;2;${defaultBg.r};${defaultBg.g};${defaultBg.b}m`;
        output += ' '.repeat(contentRect.width);
        output += '\x1b[0m';
        ctx.buffer(output);
        continue;
      }
      
      let output = `\x1b[${contentRect.y + y};${contentRect.x}H`;
      
      for (let x = 0; x < Math.min(line.length, contentRect.width); x++) {
        const cell = line[x]!;
        // Only show cursor when not scrolled back
        const isCursor = this.isFocused && viewOffset === 0 && y === cursor.y && x === cursor.x;
        
        // Determine colors
        let fg = cell.fg ? hexToRgb(cell.fg) : defaultFg;
        let bg = cell.bg ? hexToRgb(cell.bg) : defaultBg;
        
        // Handle inverse
        if (cell.inverse) {
          [fg, bg] = [bg, fg];
        }
        
        // Cursor rendering
        if (isCursor) {
          const cursorRgb = hexToRgb(this.cursorColor);
          bg = cursorRgb;
          fg = defaultBg;  // Invert text color at cursor
        }
        
        // Apply colors
        if (bg) output += `\x1b[48;2;${bg.r};${bg.g};${bg.b}m`;
        if (fg) output += `\x1b[38;2;${fg.r};${fg.g};${fg.b}m`;
        
        // Apply attributes
        if (cell.bold) output += '\x1b[1m';
        if (cell.dim) output += '\x1b[2m';
        if (cell.italic) output += '\x1b[3m';
        if (cell.underline) output += '\x1b[4m';
        
        output += cell.char;
        output += '\x1b[0m';  // Reset after each cell for simplicity
      }
      
      // Fill remaining width
      const remaining = contentRect.width - Math.min(line.length, contentRect.width);
      if (remaining > 0) {
        if (defaultBg) output += `\x1b[48;2;${defaultBg.r};${defaultBg.g};${defaultBg.b}m`;
        output += ' '.repeat(remaining);
        output += '\x1b[0m';
      }
      
      ctx.buffer(output);
    }
  }

  /**
   * Render empty state (no terminals)
   */
  private renderEmptyState(ctx: RenderContext): void {
    const contentRect = this.getTerminalContentRect();
    // Adjust background brightness when focused (same as file-tree/git-panel)
    const bgColor = this.isFocused ? themeLoader.getFocusedBackground(this.bgColor) : this.bgColor;
    const bg = hexToRgb(bgColor);
    const fg = hexToRgb(this.fgColor);

    // Fill background
    for (let y = 0; y < contentRect.height; y++) {
      let output = `\x1b[${contentRect.y + y};${contentRect.x}H`;
      if (bg) output += `\x1b[48;2;${bg.r};${bg.g};${bg.b}m`;
      output += ' '.repeat(contentRect.width);
      output += '\x1b[0m';
      ctx.buffer(output);
    }

    // Center message
    const message = 'Press Ctrl+Shift+` to create a new terminal';
    const x = contentRect.x + Math.floor((contentRect.width - message.length) / 2);
    const y = contentRect.y + Math.floor(contentRect.height / 2);

    let output = `\x1b[${y};${x}H`;
    if (bg) output += `\x1b[48;2;${bg.r};${bg.g};${bg.b}m`;
    if (fg) output += `\x1b[38;2;${fg.r};${fg.g};${fg.b}m`;
    output += message;
    output += '\x1b[0m';
    ctx.buffer(output);
  }

  /**
   * Check if point is in the terminal pane
   */
  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  /**
   * Handle mouse events
   */
  onMouseEvent(event: MouseEvent): boolean {
    if (!this.containsPoint(event.x, event.y)) {
      return false;
    }
    
    // Focus on click
    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      if (!this.isFocused) {
        this.setFocused(true);
      }
      
      // Check if clicking on title bar
      if (event.y === this.rect.y) {
        // Check for new terminal button
        if (event.x >= this.rect.x + this.rect.width - 3) {
          this.createTerminal();
          return true;
        }
        
        // Check for terminal tab click using tracked positions
        for (const tabPos of this.tabPositions) {
          if (event.x >= tabPos.startX && event.x < tabPos.endX) {
            // Check if clicking on close button
            if (event.x >= tabPos.closeX) {
              this.closeTerminal(tabPos.index);
            } else {
              this.setActiveTerminal(tabPos.index);
            }
            return true;
          }
        }
      }
      
      return true;
    }
    
    // Scroll
    if (event.name === 'MOUSE_WHEEL_UP') {
      const terminal = this.getActiveTerminal();
      if (terminal) {
        terminal.pty.scrollViewUp(3);
        if (this.onUpdateCallback) this.onUpdateCallback();
      }
      return true;
    }
    
    if (event.name === 'MOUSE_WHEEL_DOWN') {
      const terminal = this.getActiveTerminal();
      if (terminal) {
        terminal.pty.scrollViewDown(3);
        if (this.onUpdateCallback) this.onUpdateCallback();
      }
      return true;
    }
    
    return true;
  }

  /**
   * Register update callback
   */
  onUpdate(callback: () => void): () => void {
    this.onUpdateCallback = callback;
    return () => { this.onUpdateCallback = undefined; };
  }

  /**
   * Register focus callback
   */
  onFocus(callback: () => void): () => void {
    this.onFocusCallback = callback;
    return () => { this.onFocusCallback = undefined; };
  }

  /**
   * Clean up all terminals
   */
  dispose(): void {
    for (const terminal of this.terminals) {
      terminal.pty.kill();
    }
    this.terminals = [];
  }
}

export const terminalPane = new TerminalPane();

export default terminalPane;
