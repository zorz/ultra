/**
 * AI Terminal Chat Element
 *
 * Abstract base class for AI chat tools running in a terminal PTY.
 * Subclasses implement provider-specific session management.
 *
 * Provider-specific subclasses:
 * - ClaudeTerminalChat: Claude Code with session capture and --resume
 * - CodexTerminalChat: OpenAI Codex CLI
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent, Cell } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { PTYBackend, Unsubscribe } from '../../../terminal/pty-backend.ts';
import { createPtyBackend } from '../../../terminal/pty-factory.ts';
import { debugLog, isDebugEnabled } from '../../../debug.ts';
import { settings } from '../../../config/settings.ts';
import type { AIProvider } from '../../../services/session/types.ts';

// Re-export AIProvider for convenience
export type { AIProvider };

// ============================================
// Types
// ============================================

/**
 * Terminal line with styled cells.
 */
interface TerminalLine {
  cells: Cell[];
}

/**
 * State for session persistence.
 */
export interface AITerminalChatState {
  provider: AIProvider;
  sessionId: string | null;
  cwd: string;
}

/**
 * Callbacks for AI terminal chat events.
 */
export interface AITerminalChatCallbacks {
  /** Called when session ID is captured */
  onSessionIdCaptured?: (sessionId: string) => void;
  /** Called when the AI process exits */
  onExit?: (code: number) => void;
  /** Called when a notification is received (OSC 99) */
  onNotification?: (message: string) => void;
}

// ============================================
// Abstract Base Class: AITerminalChat
// ============================================

/**
 * Abstract base class for AI terminal chat elements.
 * Provides terminal emulation and PTY management.
 * Subclasses implement provider-specific start logic.
 */
export abstract class AITerminalChat extends BaseElement {
  /** Scrollbar width in characters */
  protected static readonly SCROLLBAR_WIDTH = 1;

  /** Terminal lines (scrollback + visible) */
  protected lines: TerminalLine[] = [];

  /** Cursor position */
  protected cursorX = 0;
  protected cursorY = 0;

  /** Scroll offset (for scrollback) */
  protected scrollTop = 0;

  /** Scrollback limit */
  protected scrollbackLimit = 1000;

  /** Current working directory */
  protected cwd: string = '';

  /** Whether terminal has exited */
  protected exited = false;

  /** Exit code (if exited) */
  protected exitCode: number | null = null;

  /** Current text style */
  protected currentFg = '#cccccc';
  protected currentBg = '#1e1e1e';
  protected currentBold = false;

  /** Number of visible rows/cols */
  protected visibleRows = 24;
  protected visibleCols = 80;

  /** PTY Backend */
  protected pty: PTYBackend | null = null;
  protected ptyUnsubscribes: Unsubscribe[] = [];

  /** Session ID for resume support */
  protected sessionId: string | null = null;

  /** Callbacks */
  protected callbacks: AITerminalChatCallbacks;

  /** Whether the process is starting */
  protected starting = false;

  constructor(
    id: string,
    title: string,
    ctx: ElementContext,
    options: {
      sessionId?: string | null;
      cwd?: string;
      callbacks?: AITerminalChatCallbacks;
    } = {}
  ) {
    super('AgentChat', id, title, ctx);
    this.sessionId = options.sessionId ?? null;
    this.cwd = options.cwd ?? process.cwd();
    this.callbacks = options.callbacks ?? {};
    this.initializeBuffer();
  }

  protected debugLog(msg: string): void {
    if (isDebugEnabled()) {
      debugLog(`[${this.constructor.name}:${this.id}] ${msg}`);
    }
  }

  /**
   * Set or update callbacks after construction.
   */
  setCallbacks(callbacks: AITerminalChatCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Abstract Methods (to be implemented by subclasses)
  // ─────────────────────────────────────────────────────────────────────────

  /** Get the AI provider type */
  abstract getProvider(): AIProvider;

  /** Get the command to run */
  abstract getCommand(): string;

  /** Get command arguments */
  abstract getArgs(): string[];

  /** Get environment variables */
  abstract getEnv(): Record<string, string>;

  /** Get display name for the provider */
  abstract getProviderName(): string;

  /**
   * Called before starting interactive session.
   * Subclasses can override to capture session ID or perform setup.
   * @returns Promise that resolves when ready to start interactive session
   */
  protected async beforeStart(): Promise<void> {
    // Default: no-op
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Session Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the current session ID.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Set the session ID.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    this.debugLog(`Session ID set to: ${sessionId}`);
    this.callbacks.onSessionIdCaptured?.(sessionId);
  }

  /**
   * Check if the AI process is running.
   */
  isRunning(): boolean {
    return this.pty?.isRunning() ?? false;
  }

  /**
   * Start the AI chat process.
   */
  async start(): Promise<void> {
    if (this.starting || this.pty?.isRunning()) {
      this.debugLog('Already starting or running');
      return;
    }

    this.starting = true;
    this.debugLog('Starting AI chat process');

    try {
      // Allow subclass to perform setup (e.g., capture session ID)
      await this.beforeStart();

      // Start interactive session
      await this.startInteractive();
    } finally {
      this.starting = false;
    }
  }

  /**
   * Start the interactive PTY session.
   */
  protected async startInteractive(): Promise<void> {
    this.debugLog(`Starting interactive session`);

    const command = this.getCommand();
    const args = this.getArgs();
    const env = this.getEnv();

    // Create PTY with AI command
    this.pty = await createPtyBackend({
      shell: command,
      args,
      cwd: this.cwd,
      env: {
        ...process.env,
        ...env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
      cols: this.visibleCols,
      rows: this.visibleRows,
    });

    // Wire up PTY callbacks
    this.ptyUnsubscribes.push(
      this.pty.onUpdate(() => {
        this.ctx.markDirty();
      })
    );

    this.ptyUnsubscribes.push(
      this.pty.onTitle((title) => {
        this.setTitle(title || this.getProviderName());
      })
    );

    this.ptyUnsubscribes.push(
      this.pty.onExit((code) => {
        this.exited = true;
        this.exitCode = code;
        this.debugLog(`AI process exited with code ${code}`);
        this.callbacks.onExit?.(code);
        this.ctx.markDirty();
      })
    );

    // Wire up notification callback (OSC 99 messages from Claude Code, etc.)
    this.ptyUnsubscribes.push(
      this.pty.onNotification((message) => {
        this.debugLog(`Notification received: ${message}`);
        this.callbacks.onNotification?.(message);
      })
    );

    // Start the PTY
    await this.pty.start();
    this.setTitle(this.getProviderName());
    this.debugLog('Interactive session started');
  }

  /**
   * Stop the AI chat process.
   */
  stop(): void {
    if (this.pty) {
      this.debugLog('Stopping AI chat process');
      this.pty.kill();
      this.detachPty();
    }
  }

  /**
   * Detach the PTY backend.
   */
  protected detachPty(): void {
    for (const unsub of this.ptyUnsubscribes) {
      unsub();
    }
    this.ptyUnsubscribes = [];
    this.pty = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Terminal Buffer Management
  // ─────────────────────────────────────────────────────────────────────────

  protected initializeBuffer(): void {
    this.lines = [];
    for (let i = 0; i < this.visibleRows; i++) {
      this.lines.push(this.createEmptyLine());
    }
  }

  protected createEmptyLine(): TerminalLine {
    const cells: Cell[] = [];
    for (let i = 0; i < this.visibleCols; i++) {
      cells.push({ char: ' ', fg: this.currentFg, bg: this.currentBg });
    }
    return { cells };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  override onMount(): void {
    this.debugLog('Mounted');
  }

  override onUnmount(): void {
    this.debugLog('Unmounting');
    this.stop();
  }

  override onResize(size: { width: number; height: number }): void {
    super.onResize(size);
    this.visibleCols = Math.max(1, size.width - AITerminalChat.SCROLLBAR_WIDTH);
    this.visibleRows = Math.max(1, size.height);

    if (this.pty) {
      this.pty.resize(this.visibleCols, this.visibleRows);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    // Get theme colors for terminal
    const defaultBg = this.ctx.getThemeColor('terminal.background', '#1e1e1e');
    const defaultFg = this.ctx.getThemeColor('terminal.foreground', '#cccccc');
    const cursorBg = this.ctx.getThemeColor('terminalCursor.foreground', '#ffffff');

    // Use PTY buffer if available
    if (this.pty) {
      const ptyBuffer = this.pty.getBuffer();
      const cursor = this.pty.getCursor();
      const viewOffset = this.pty.getViewOffset();
      const cursorVisible = this.pty.isCursorVisible();

      for (let row = 0; row < height && row < ptyBuffer.length; row++) {
        const line = ptyBuffer[row];
        if (!line) continue;

        for (let col = 0; col < width - AITerminalChat.SCROLLBAR_WIDTH && col < line.length; col++) {
          const cell = line[col];
          if (!cell) continue;

          buffer.set(x + col, y + row, {
            char: cell.char,
            fg: cell.fg ?? defaultFg,
            bg: cell.bg ?? defaultBg,
            bold: cell.bold,
          });
        }

        // Fill rest of line
        for (let col = line.length; col < width - AITerminalChat.SCROLLBAR_WIDTH; col++) {
          buffer.set(x + col, y + row, { char: ' ', fg: defaultFg, bg: defaultBg });
        }
      }

      // Draw cursor if:
      // - Element is focused
      // - Not scrolled back (viewOffset === 0)
      // - Cursor visibility is enabled (DECTCEM)
      // - Cursor position is within visible bounds
      if (this.focused && viewOffset === 0 && cursorVisible &&
          cursor.y < height && cursor.x < width - AITerminalChat.SCROLLBAR_WIDTH) {
        const cursorCell = buffer.get(x + cursor.x, y + cursor.y);
        if (cursorCell) {
          buffer.set(x + cursor.x, y + cursor.y, {
            ...cursorCell,
            bg: cursorBg,
            fg: defaultBg,
          });
        }
      }
    } else {
      // Fill with background when no PTY
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width - AITerminalChat.SCROLLBAR_WIDTH; col++) {
          buffer.set(x + col, y + row, { char: ' ', fg: defaultFg, bg: defaultBg });
        }
      }
    }

    // Draw scrollbar
    this.renderScrollbar(buffer, defaultBg);

    // Show status if not running
    if (!this.pty?.isRunning() && !this.starting) {
      const statusMsg = this.exited
        ? `${this.getProviderName()} exited (code ${this.exitCode}). Press Enter to restart.`
        : `Press Enter to start ${this.getProviderName()}.`;
      const msgX = x + Math.floor((width - statusMsg.length) / 2);
      const msgY = y + Math.floor(height / 2);

      const statusFg = this.ctx.getThemeColor('descriptionForeground', '#888888');
      buffer.writeString(msgX, msgY, statusMsg, statusFg, defaultBg);
    }
  }

  protected renderScrollbar(buffer: ScreenBuffer, trackBg: string): void {
    const { x, y, width, height } = this.bounds;
    const scrollbarX = x + width - 1;

    const totalLines = this.pty ? this.pty.getTotalLines() : this.visibleRows;
    const viewOffset = this.pty ? this.pty.getViewOffset() : 0;

    const scrollbarBg = this.ctx.getThemeColor('scrollbarSlider.background', '#4a4a4a');

    // Calculate thumb position and size
    const thumbSize = Math.max(1, Math.floor((height / Math.max(1, totalLines)) * height));
    const thumbPosition = totalLines > height
      ? Math.floor(((totalLines - viewOffset - height) / Math.max(1, totalLines)) * (height - thumbSize))
      : 0;

    for (let row = 0; row < height; row++) {
      const isThumb = row >= thumbPosition && row < thumbPosition + thumbSize;
      buffer.set(scrollbarX, y + row, {
        char: ' ',
        fg: trackBg,
        bg: isThumb ? scrollbarBg : trackBg,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    // Start/restart on Enter if not running
    if (event.key === 'Enter' && !this.pty?.isRunning() && !this.starting) {
      this.start().catch((err) => {
        this.debugLog(`Failed to start: ${err}`);
      });
      return true;
    }

    // Forward input to PTY
    if (this.pty?.isRunning()) {
      const input = this.keyEventToInput(event);
      if (input) {
        this.pty.write(input);
        return true;
      }
    }

    return false;
  }

  protected keyEventToInput(event: KeyEvent): string | null {
    // Handle special keys
    if (event.ctrl) {
      if (event.key === 'c') return '\x03';
      if (event.key === 'd') return '\x04';
      if (event.key === 'z') return '\x1a';
      if (event.key === 'l') return '\x0c';
      if (event.key.length === 1) {
        return String.fromCharCode(event.key.toLowerCase().charCodeAt(0) - 96);
      }
    }

    // Handle arrow keys
    if (event.key === 'ArrowUp') return '\x1b[A';
    if (event.key === 'ArrowDown') return '\x1b[B';
    if (event.key === 'ArrowRight') return '\x1b[C';
    if (event.key === 'ArrowLeft') return '\x1b[D';
    if (event.key === 'Home') return '\x1b[H';
    if (event.key === 'End') return '\x1b[F';
    if (event.key === 'PageUp') return '\x1b[5~';
    if (event.key === 'PageDown') return '\x1b[6~';
    if (event.key === 'Delete') return '\x1b[3~';

    // Handle other special keys
    if (event.key === 'Enter') return '\r';
    if (event.key === 'Backspace') return '\x7f';
    if (event.key === 'Tab') return '\t';
    if (event.key === 'Escape') return '\x1b';

    // Regular characters
    if (event.key.length === 1) {
      return event.key;
    }

    return null;
  }

  override handleMouse(event: MouseEvent): boolean {
    // Handle scroll
    if (event.type === 'scroll' && event.scrollDirection) {
      if (this.pty) {
        let scrolled = false;
        if (event.scrollDirection === -1) {
          scrolled = this.pty.scrollViewUp(3);
        } else {
          scrolled = this.pty.scrollViewDown(3);
        }
        if (scrolled) {
          this.ctx.markDirty();
        }
        return true;
      }
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): AITerminalChatState {
    return {
      provider: this.getProvider(),
      sessionId: this.sessionId,
      cwd: this.cwd,
    };
  }

  override setState(state: unknown): void {
    if (state && typeof state === 'object') {
      const s = state as Partial<AITerminalChatState>;
      if (s.sessionId) this.sessionId = s.sessionId;
      if (s.cwd) this.cwd = s.cwd;
    }
  }
}

// ============================================
// Claude Terminal Chat
// ============================================

/**
 * Claude Code terminal chat.
 * Implements session capture and --resume support.
 */
export class ClaudeTerminalChat extends AITerminalChat {
  /** Initial prompt for new sessions */
  private initialPrompt: string;

  constructor(
    id: string,
    title: string,
    ctx: ElementContext,
    options: {
      sessionId?: string | null;
      cwd?: string;
      callbacks?: AITerminalChatCallbacks;
      initialPrompt?: string;
    } = {}
  ) {
    super(id, title || 'Claude', ctx, options);
    this.initialPrompt = options.initialPrompt ??
      settings.get('ai.panel.initialPrompt') ??
      'You are a helpful software engineer working with another software engineer on a coding project using the Ultra IDE';
  }

  getProvider(): AIProvider {
    return 'claude-code';
  }

  getCommand(): string {
    return 'claude';
  }

  getArgs(): string[] {
    const args: string[] = [];
    // Add --resume if we have a session ID
    if (this.sessionId) {
      args.push('--resume', this.sessionId);
      this.debugLog(`Using --resume ${this.sessionId}`);
    }
    return args;
  }

  getEnv(): Record<string, string> {
    return {};
  }

  getProviderName(): string {
    return 'Claude';
  }

  /**
   * Before starting, capture session ID if we don't have one.
   * Claude outputs session ID in JSON mode that we can capture.
   */
  protected override async beforeStart(): Promise<void> {
    if (this.sessionId) {
      this.debugLog(`Session ID already set: ${this.sessionId}`);
      return;
    }

    this.debugLog('No session ID, capturing one first...');
    await this.captureSessionId();
  }

  /**
   * Capture session ID by running Claude in non-interactive mode.
   * Claude outputs JSON with session_id that we parse.
   */
  private async captureSessionId(): Promise<void> {
    this.debugLog('Starting Claude in non-interactive mode to capture session ID');

    // Run claude with initial prompt in JSON mode to get session ID
    const proc = Bun.spawn(
      ['claude', '-p', this.initialPrompt, '--output-format', 'stream-json', '--verbose'],
      {
        cwd: this.cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
      }
    );

    let output = '';
    let capturedSessionId: string | null = null;
    let responseComplete = false;

    // Read all stdout
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        output += chunk;

        // Try to parse each line as JSON
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const json = JSON.parse(line);

              // Capture session_id when we see it
              if (json.session_id && !capturedSessionId) {
                capturedSessionId = json.session_id;
                this.debugLog(`Found session ID: ${capturedSessionId}`);
              }

              // Wait for the result message to confirm session is persisted
              if (json.type === 'result' && json.subtype === 'success') {
                this.debugLog('Received success result, session should be persisted');
                responseComplete = true;
              }
            } catch {
              // Not valid JSON yet, continue
            }
          }
        }

        // Once we have both session ID and success result, we're done
        if (capturedSessionId && responseComplete) {
          this.sessionId = capturedSessionId;
          this.debugLog(`Session ID captured and persisted: ${this.sessionId}`);
          this.callbacks.onSessionIdCaptured?.(capturedSessionId);
          proc.kill();
          return;
        }
      }
    } catch (error) {
      this.debugLog(`Error reading output: ${error}`);
    }

    // Wait for process to exit
    await proc.exited;

    // If we got a session ID but didn't see success, still use it
    if (capturedSessionId) {
      this.sessionId = capturedSessionId;
      this.debugLog(`Session ID captured (process exited): ${this.sessionId}`);
      this.callbacks.onSessionIdCaptured?.(capturedSessionId);
    } else {
      this.debugLog(`Failed to capture session ID. Full output: ${output.substring(0, 500)}`);
    }
  }
}

// ============================================
// Codex Terminal Chat
// ============================================

/**
 * OpenAI Codex terminal chat.
 *
 * Codex uses ink (React terminal library) which queries for cursor position
 * on startup. In embedded PTYs, we need to auto-respond to these queries.
 */
export class CodexTerminalChat extends AITerminalChat {
  constructor(
    id: string,
    title: string,
    ctx: ElementContext,
    options: {
      sessionId?: string | null;
      cwd?: string;
      callbacks?: AITerminalChatCallbacks;
    } = {}
  ) {
    super(id, title || 'Codex', ctx, options);
  }

  getProvider(): AIProvider {
    return 'codex';
  }

  getCommand(): string {
    return 'codex';
  }

  getArgs(): string[] {
    return [];
  }

  getEnv(): Record<string, string> {
    // Use xterm-256color for proper color support
    // The cursor position query is handled in startInteractive()
    return {};
  }

  getProviderName(): string {
    return 'Codex';
  }

  /**
   * Override to add cursor position query response handler.
   * Codex/ink sends CSI 6n (cursor position query) and expects a response.
   * We auto-respond with a safe default position.
   */
  protected override async startInteractive(): Promise<void> {
    await super.startInteractive();

    // Add handler to auto-respond to cursor position queries (CSI 6n = \x1b[6n)
    // Response format: CSI <row>;<col>R = \x1b[<row>;<col>R
    if (this.pty) {
      const cursorQueryHandler = this.pty.onData((data) => {
        // Check for cursor position query: ESC [ 6 n
        if (data.includes('\x1b[6n')) {
          this.debugLog('Detected cursor position query, responding with default position');
          // Respond with cursor at position (1, 1) - a safe default
          this.pty?.write('\x1b[1;1R');
        }
      });
      this.ptyUnsubscribes.push(cursorQueryHandler);
    }
  }
}

// ============================================
// Gemini Terminal Chat
// ============================================

/**
 * Google Gemini terminal chat.
 */
export class GeminiTerminalChat extends AITerminalChat {
  constructor(
    id: string,
    title: string,
    ctx: ElementContext,
    options: {
      sessionId?: string | null;
      cwd?: string;
      callbacks?: AITerminalChatCallbacks;
    } = {}
  ) {
    super(id, title || 'Gemini', ctx, options);
  }

  getProvider(): AIProvider {
    return 'gemini';
  }

  getCommand(): string {
    return 'gemini';
  }

  getArgs(): string[] {
    return [];
  }

  getEnv(): Record<string, string> {
    return {};
  }

  getProviderName(): string {
    return 'Gemini';
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create an AI terminal chat element for the given provider.
 */
export function createAITerminalChat(
  id: string,
  title: string,
  ctx: ElementContext,
  options: {
    provider?: AIProvider;
    sessionId?: string | null;
    cwd?: string;
    callbacks?: AITerminalChatCallbacks;
    initialPrompt?: string;
  } = {}
): AITerminalChat {
  const provider = options.provider ?? 'claude-code';

  switch (provider) {
    case 'claude-code':
      return new ClaudeTerminalChat(id, title, ctx, options);
    case 'codex':
      return new CodexTerminalChat(id, title, ctx, options);
    case 'gemini':
      return new GeminiTerminalChat(id, title, ctx, options);
    default:
      // Default to Claude
      return new ClaudeTerminalChat(id, title, ctx, options);
  }
}

/**
 * Create a Claude terminal chat element.
 */
export function createClaudeTerminalChat(
  id: string,
  title: string,
  ctx: ElementContext,
  options: {
    sessionId?: string | null;
    cwd?: string;
    callbacks?: AITerminalChatCallbacks;
    initialPrompt?: string;
  } = {}
): ClaudeTerminalChat {
  return new ClaudeTerminalChat(id, title, ctx, options);
}

/**
 * Create a Codex terminal chat element.
 */
export function createCodexTerminalChat(
  id: string,
  title: string,
  ctx: ElementContext,
  options: {
    sessionId?: string | null;
    cwd?: string;
    callbacks?: AITerminalChatCallbacks;
  } = {}
): CodexTerminalChat {
  return new CodexTerminalChat(id, title, ctx, options);
}

/**
 * Create a Gemini terminal chat element.
 */
export function createGeminiTerminalChat(
  id: string,
  title: string,
  ctx: ElementContext,
  options: {
    sessionId?: string | null;
    cwd?: string;
    callbacks?: AITerminalChatCallbacks;
  } = {}
): GeminiTerminalChat {
  return new GeminiTerminalChat(id, title, ctx, options);
}
