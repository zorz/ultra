/**
 * PTY (Pseudo-Terminal) Support
 *
 * Uses bun-pty for real PTY support with a simple built-in ANSI parser.
 */

import { spawn } from 'bun-pty';
import { debugLog } from '../debug.ts';

// Re-export screen buffer types and classes from screen-buffer.ts
// These are separated to allow imports without loading bun-pty
export type { TerminalCell } from './screen-buffer.ts';
export {
  createEmptyCell,
  ansiToHex,
  ScreenBuffer,
  AnsiParser,
} from './screen-buffer.ts';

import { ScreenBuffer, AnsiParser, type TerminalCell } from './screen-buffer.ts';

export interface PTYSize {
  cols: number;
  rows: number;
}

export interface PTYOptions {
  shell?: string;
  /** Arguments to pass to the shell (defaults to ['-il'] for bash/zsh/sh) */
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  scrollback?: number;
}

/**
 * PTY Terminal Emulator
 * 
 * Manages a pseudo-terminal session using bun-pty.
 */
export class PTY {
  private ptyProcess: ReturnType<typeof spawn> | null = null;
  private screen: ScreenBuffer;
  private parser: AnsiParser;
  private _cols: number;
  private _rows: number;
  private shell: string;
  private args: string[] | undefined;
  private cwd: string;
  private env: Record<string, string>;
  
  // Callbacks
  private onDataCallback?: (data: string) => void;
  private onExitCallback?: (code: number) => void;
  private onTitleCallback?: (title: string) => void;
  private onUpdateCallback?: () => void;

  constructor(options: PTYOptions = {}) {
    this._cols = options.cols || 80;
    this._rows = options.rows || 24;
    this.shell = options.shell || process.env.SHELL || '/bin/zsh';
    this.args = options.args;
    this.cwd = options.cwd || process.cwd();
    this.env = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Set TERM_PROGRAM so shell prompts know they're in a terminal emulator
      TERM_PROGRAM: 'ultra',
      TERM_PROGRAM_VERSION: '0.5.0',
      ...options.env
    };
    
    // Create screen buffer and ANSI parser
    const scrollbackLimit = options.scrollback || 1000;
    this.screen = new ScreenBuffer(this._cols, this._rows, scrollbackLimit);
    this.parser = new AnsiParser(this.screen);

    // Set up parser output callback for DSR responses
    this.parser.onOutput((data: string) => {
      if (this.ptyProcess) {
        this.ptyProcess.write(data);
      }
    });
  }

  /**
   * Start the PTY process
   */
  async start(): Promise<void> {
    if (this.ptyProcess) {
      return;
    }

    try {
      // Spawn PTY process using bun-pty
      // Only use -il for POSIX shells (bash, zsh, sh) that support it
      // Other shells (fish, nu, etc.) get no args by default
      const shellName = this.shell.split('/').pop() || '';
      const defaultArgs = ['bash', 'zsh', 'sh'].includes(shellName) ? ['-il'] : [];
      const shellArgs = this.args ?? defaultArgs;

      this.ptyProcess = spawn(this.shell, shellArgs, {
        name: 'xterm-256color',
        cols: this._cols,
        rows: this._rows,
        cwd: this.cwd,
        env: this.env,
      });

      // Handle data from PTY
      this.ptyProcess.onData((data: string) => {
        // Parse ANSI sequences and update screen buffer
        this.parser.process(data);
        
        if (this.onDataCallback) {
          this.onDataCallback(data);
        }
        
        if (this.onUpdateCallback) {
          this.onUpdateCallback();
        }
      });

      // Handle exit
      this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        this.ptyProcess = null;
        if (this.onExitCallback) {
          this.onExitCallback(exitCode);
        }
      });

    } catch (error) {
      debugLog(`[PTY] Failed to start PTY: ${error}`);
      throw error;
    }
  }

  /**
   * Write data to the PTY
   */
  write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows);
    }
    this.screen.resize(cols, rows);
  }

  /**
   * Kill the PTY process
   */
  kill(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.ptyProcess !== null;
  }

  /**
   * Get terminal dimensions
   */
  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  /**
   * Get the terminal buffer for rendering
   */
  getBuffer(): TerminalCell[][] {
    return this.screen.getBuffer();
  }

  /**
   * Get cursor position
   */
  getCursor(): { x: number; y: number } {
    return this.screen.getCursor();
  }

  /**
   * Check if cursor is visible (DECTCEM state)
   */
  isCursorVisible(): boolean {
    return this.screen.isCursorVisible();
  }

  /**
   * Scroll view up (into scrollback history)
   * @returns true if scroll position changed
   */
  scrollViewUp(lines: number): boolean {
    return this.screen.scrollViewUp(lines);
  }

  /**
   * Scroll view down (towards current)
   * @returns true if scroll position changed
   */
  scrollViewDown(lines: number): boolean {
    return this.screen.scrollViewDown(lines);
  }

  /**
   * Reset view to bottom (current output)
   */
  resetViewOffset(): void {
    this.screen.resetViewOffset();
  }

  /**
   * Get current view offset
   */
  getViewOffset(): number {
    return this.screen.getViewOffset();
  }

  /**
   * Get total number of lines (scrollback + visible)
   */
  getTotalLines(): number {
    return this.screen.getTotalLines();
  }

  /**
   * Set callback for data events
   */
  onData(callback: (data: string) => void): void {
    this.onDataCallback = callback;
  }

  /**
   * Set callback for exit events
   */
  onExit(callback: (code: number) => void): void {
    this.onExitCallback = callback;
  }

  /**
   * Set callback for title changes
   */
  onTitle(callback: (title: string) => void): void {
    this.onTitleCallback = callback;
  }

  /**
   * Set callback for update events
   */
  onUpdate(callback: () => void): void {
    this.onUpdateCallback = callback;
  }

  /**
   * Set callback for OSC 99 notifications (used by Claude Code, etc.)
   */
  onNotification(callback: (message: string) => void): void {
    this.parser.onNotification(callback);
  }
}
