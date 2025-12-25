/**
 * NodePtyBackend
 *
 * PTY backend implementation using node-pty.
 * Used for bundled binary where bun-pty native lib doesn't work.
 *
 * NOTE: This requires node-pty to be installed. The implementation uses
 * dynamic import to avoid build errors when node-pty is not available.
 */

import type {
  PTYBackend,
  PTYBackendOptions,
  TerminalCell,
  CursorPosition,
  Unsubscribe,
} from '../pty-backend.ts';
import { ScreenBuffer, AnsiParser } from '../screen-buffer.ts';

// Type for node-pty (avoid import for type checking)
interface IPty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (e: { exitCode: number }) => void): void;
}

/**
 * NodePtyBackend wraps node-pty to implement PTYBackend interface.
 */
export class NodePtyBackend implements PTYBackend {
  private process: IPty | null = null;
  private screenBuffer: ScreenBuffer;
  private ansiParser: AnsiParser;
  private _title: string = 'Terminal';
  private _cwd: string;
  private _cols: number;
  private _rows: number;
  private _running: boolean = false;

  private shell: string;
  private args: string[];
  private env: Record<string, string>;

  // Callback sets
  private dataCallbacks = new Set<(data: string) => void>();
  private updateCallbacks = new Set<() => void>();
  private exitCallbacks = new Set<(code: number) => void>();
  private titleCallbacks = new Set<(title: string) => void>();

  constructor(options: PTYBackendOptions = {}) {
    this._cols = options.cols ?? 80;
    this._rows = options.rows ?? 24;
    this._cwd = options.cwd ?? process.cwd();
    this.shell = options.shell ?? process.env.SHELL ?? '/bin/zsh';
    // Start as interactive login shell by default (like Terminal.app, iTerm2)
    // -i: interactive (sources .zshrc)
    // -l: login (sources .zprofile/.zlogin)
    this.args = options.args ?? ['-il'];
    this.env = options.env ?? {};

    const scrollback = options.scrollback ?? 1000;
    this.screenBuffer = new ScreenBuffer(this._cols, this._rows, scrollback);
    this.ansiParser = new AnsiParser(this.screenBuffer);

    // Set up parser output callback for DSR responses
    this.ansiParser.onOutput((data: string) => {
      if (this.process) {
        this.process.write(data);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    // Dynamic import to avoid bundling issues when node-pty not installed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pty = (await import('node-pty')) as any;

    this.process = pty.spawn(this.shell, this.args, {
      name: 'xterm-256color',
      cols: this._cols,
      rows: this._rows,
      cwd: this._cwd,
      env: {
        ...process.env,
        // Set TERM_PROGRAM so shell prompts know they're in a terminal emulator
        TERM_PROGRAM: 'ultra',
        TERM_PROGRAM_VERSION: '0.5.0',
        ...this.env,
      } as Record<string, string>,
    }) as IPty;

    this._running = true;

    // Handle data output
    this.process.onData((data: string) => {
      // Process through ANSI parser
      this.ansiParser.process(data);

      // Notify data callbacks
      for (const callback of this.dataCallbacks) {
        callback(data);
      }

      // Notify update callbacks
      for (const callback of this.updateCallbacks) {
        callback();
      }
    });

    // Handle exit
    this.process.onExit(({ exitCode }) => {
      this._running = false;
      for (const callback of this.exitCallbacks) {
        callback(exitCode);
      }
    });
  }

  write(data: string): void {
    if (this.process) {
      this.process.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.screenBuffer.resize(cols, rows);

    if (this.process) {
      this.process.resize(cols, rows);
    }
  }

  kill(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this._running = false;
    }
  }

  isRunning(): boolean {
    return this._running;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Screen Buffer
  // ─────────────────────────────────────────────────────────────────────────

  getBuffer(): TerminalCell[][] {
    return this.screenBuffer.getBuffer();
  }

  getCursor(): CursorPosition {
    return this.screenBuffer.getCursor();
  }

  isCursorVisible(): boolean {
    return this.screenBuffer.isCursorVisible();
  }

  getViewOffset(): number {
    return this.screenBuffer.getViewOffset();
  }

  getTotalLines(): number {
    return this.screenBuffer.getTotalLines();
  }

  scrollViewUp(lines: number): boolean {
    return this.screenBuffer.scrollViewUp(lines);
  }

  scrollViewDown(lines: number): boolean {
    return this.screenBuffer.scrollViewDown(lines);
  }

  resetViewOffset(): void {
    this.screenBuffer.resetViewOffset();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Callbacks
  // ─────────────────────────────────────────────────────────────────────────

  onData(callback: (data: string) => void): Unsubscribe {
    this.dataCallbacks.add(callback);
    return () => {
      this.dataCallbacks.delete(callback);
    };
  }

  onUpdate(callback: () => void): Unsubscribe {
    this.updateCallbacks.add(callback);
    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  onExit(callback: (code: number) => void): Unsubscribe {
    this.exitCallbacks.add(callback);
    return () => {
      this.exitCallbacks.delete(callback);
    };
  }

  onTitle(callback: (title: string) => void): Unsubscribe {
    this.titleCallbacks.add(callback);
    return () => {
      this.titleCallbacks.delete(callback);
    };
  }

  onNotification(callback: (message: string) => void): Unsubscribe {
    // Wire up directly to the underlying parser's notification callback
    this.ansiParser.onNotification(callback);
    return () => {
      // Clear the callback by setting a no-op
      this.ansiParser.onNotification(() => {});
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────

  getCwd(): string | null {
    return this._cwd;
  }

  getTitle(): string {
    return this._title;
  }

  getSize(): { cols: number; rows: number } {
    return { cols: this._cols, rows: this._rows };
  }
}

/**
 * Create a NodePtyBackend instance.
 */
export function createNodePtyBackend(options: PTYBackendOptions = {}): PTYBackend {
  return new NodePtyBackend(options);
}
