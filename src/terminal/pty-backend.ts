/**
 * PTY Backend Interface
 *
 * Abstraction layer for PTY implementations to support both
 * bun-pty (development) and node-pty (bundled binary).
 */

// ============================================
// Types
// ============================================

/**
 * Unsubscribe function returned by callback registrations.
 */
export type Unsubscribe = () => void;

/**
 * Terminal cell with character and attributes.
 */
export interface TerminalCell {
  char: string;
  fg: string | null; // Hex color or null for default
  bg: string | null; // Hex color or null for default
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  inverse: boolean;
}

/**
 * Cursor position in the terminal.
 */
export interface CursorPosition {
  x: number;
  y: number;
}

/**
 * Options for creating a PTY backend.
 */
export interface PTYBackendOptions {
  /** Shell to run (defaults to $SHELL or /bin/zsh) */
  shell?: string;
  /** Arguments to pass to the shell */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Number of columns */
  cols?: number;
  /** Number of rows */
  rows?: number;
  /** Scrollback buffer size */
  scrollback?: number;
}

// ============================================
// PTY Backend Interface
// ============================================

/**
 * PTY Backend interface.
 *
 * Provides a unified API for terminal emulation regardless of
 * the underlying PTY implementation (bun-pty or node-pty).
 */
export interface PTYBackend {
  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the PTY process.
   */
  start(): Promise<void>;

  /**
   * Write data to the PTY.
   * @param data - Data to write (typically user input)
   */
  write(data: string): void;

  /**
   * Resize the PTY.
   * @param cols - Number of columns
   * @param rows - Number of rows
   */
  resize(cols: number, rows: number): void;

  /**
   * Kill the PTY process.
   */
  kill(): void;

  /**
   * Check if the PTY is running.
   */
  isRunning(): boolean;

  // ─────────────────────────────────────────────────────────────────────────
  // Screen Buffer
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the current screen buffer.
   * Returns a 2D array of terminal cells [row][col].
   */
  getBuffer(): TerminalCell[][];

  /**
   * Get the cursor position.
   */
  getCursor(): CursorPosition;

  /**
   * Check if cursor is visible (DECTCEM state).
   * Returns true if cursor should be displayed.
   */
  isCursorVisible(): boolean;

  /**
   * Get the current view offset (for scrollback).
   * 0 means viewing the current screen, positive values mean scrolled back.
   */
  getViewOffset(): number;

  /**
   * Get the total number of lines (scrollback + visible).
   * Used for scrollbar calculations.
   */
  getTotalLines(): number;

  /**
   * Scroll the view up (into history).
   * @param lines - Number of lines to scroll
   * @returns true if scroll position changed
   */
  scrollViewUp(lines: number): boolean;

  /**
   * Scroll the view down (toward current).
   * @param lines - Number of lines to scroll
   * @returns true if scroll position changed
   */
  scrollViewDown(lines: number): boolean;

  /**
   * Reset view offset to show current screen.
   */
  resetViewOffset(): void;

  // ─────────────────────────────────────────────────────────────────────────
  // Callbacks
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register callback for raw data output.
   * @param callback - Called with raw output data
   * @returns Unsubscribe function
   */
  onData(callback: (data: string) => void): Unsubscribe;

  /**
   * Register callback for screen buffer updates.
   * Called after the buffer has been updated with new content.
   * @param callback - Called when buffer is updated
   * @returns Unsubscribe function
   */
  onUpdate(callback: () => void): Unsubscribe;

  /**
   * Register callback for process exit.
   * @param callback - Called with exit code when process exits
   * @returns Unsubscribe function
   */
  onExit(callback: (code: number) => void): Unsubscribe;

  /**
   * Register callback for title changes.
   * @param callback - Called with new title
   * @returns Unsubscribe function
   */
  onTitle(callback: (title: string) => void): Unsubscribe;

  /**
   * Register callback for OSC 99 notifications.
   * Used by applications like Claude Code to send status messages.
   * @param callback - Called with notification message
   * @returns Unsubscribe function
   */
  onNotification(callback: (message: string) => void): Unsubscribe;

  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the current working directory (if available).
   */
  getCwd(): string | null;

  /**
   * Get the current title.
   */
  getTitle(): string;

  /**
   * Get terminal dimensions.
   */
  getSize(): { cols: number; rows: number };
}

// ============================================
// Factory
// ============================================

/**
 * Factory function type for creating PTY backends.
 */
export type PTYBackendFactory = (options: PTYBackendOptions) => PTYBackend;
