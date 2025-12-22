/**
 * BunPtyBackend
 *
 * PTY backend implementation using bun-pty.
 * Wraps the existing PTY class to implement the PTYBackend interface.
 */

import { PTY, type PTYOptions, type TerminalCell } from '../pty.ts';
import type {
  PTYBackend,
  PTYBackendOptions,
  CursorPosition,
  Unsubscribe,
} from '../pty-backend.ts';

// Re-export TerminalCell for convenience
export type { TerminalCell };

/**
 * BunPtyBackend wraps the existing bun-pty based PTY class.
 */
export class BunPtyBackend implements PTYBackend {
  private pty: PTY;
  private _title: string = 'Terminal';
  private _cwd: string;

  // Multiple callback support
  private dataCallbacks = new Set<(data: string) => void>();
  private updateCallbacks = new Set<() => void>();
  private exitCallbacks = new Set<(code: number) => void>();
  private titleCallbacks = new Set<(title: string) => void>();

  constructor(options: PTYBackendOptions = {}) {
    this._cwd = options.cwd || process.cwd();

    // Convert PTYBackendOptions to PTYOptions
    const ptyOptions: PTYOptions = {
      shell: options.shell,
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows,
      scrollback: options.scrollback,
    };

    this.pty = new PTY(ptyOptions);

    // Wire up PTY callbacks to our multi-callback system
    this.pty.onData((data) => {
      for (const callback of this.dataCallbacks) {
        callback(data);
      }
    });

    this.pty.onUpdate(() => {
      for (const callback of this.updateCallbacks) {
        callback();
      }
    });

    this.pty.onExit((code) => {
      for (const callback of this.exitCallbacks) {
        callback(code);
      }
    });

    this.pty.onTitle((title) => {
      this._title = title;
      for (const callback of this.titleCallbacks) {
        callback(title);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.pty.start();
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(): void {
    this.pty.kill();
  }

  isRunning(): boolean {
    return this.pty.isRunning();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Screen Buffer
  // ─────────────────────────────────────────────────────────────────────────

  getBuffer(): TerminalCell[][] {
    return this.pty.getBuffer();
  }

  getCursor(): CursorPosition {
    return this.pty.getCursor();
  }

  isCursorVisible(): boolean {
    return this.pty.isCursorVisible();
  }

  getViewOffset(): number {
    return this.pty.getViewOffset();
  }

  getTotalLines(): number {
    return this.pty.getTotalLines();
  }

  scrollViewUp(lines: number): boolean {
    return this.pty.scrollViewUp(lines);
  }

  scrollViewDown(lines: number): boolean {
    return this.pty.scrollViewDown(lines);
  }

  resetViewOffset(): void {
    this.pty.resetViewOffset();
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
    // Wire up directly to the underlying PTY's notification callback
    this.pty.onNotification(callback);
    return () => {
      // Clear the callback by setting a no-op
      this.pty.onNotification(() => {});
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
    return {
      cols: this.pty.cols,
      rows: this.pty.rows,
    };
  }
}

/**
 * Create a BunPtyBackend instance.
 */
export function createBunPtyBackend(options: PTYBackendOptions = {}): PTYBackend {
  return new BunPtyBackend(options);
}
