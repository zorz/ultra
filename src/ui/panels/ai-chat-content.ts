/**
 * AI Chat Content
 *
 * PanelContent implementation that embeds an AI terminal (Claude Code, Codex, etc.)
 * via PTY. Supports MCP server connection for Ultra integration.
 */

import type { Rect } from '../layout.ts';
import type { RenderContext } from '../renderer.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { MouseEvent } from '../mouse.ts';
import type {
  PanelContent,
  ScrollablePanelContent,
  FocusablePanelContent,
  ContentState,
} from './panel-content.interface.ts';
import { PTY, type TerminalCell } from '../../terminal/pty.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { hexToRgb } from '../colors.ts';
import { debugLog, isDebugEnabled } from '../../debug.ts';
import { settings } from '../../config/settings.ts';

// ==================== Types ====================

export type AIProvider = 'claude-code' | 'codex' | 'custom';

export interface AIProviderConfig {
  provider: AIProvider;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AIChatContentOptions {
  provider?: AIProvider;
  customCommand?: string;
  customArgs?: string[];
  cwd?: string;
  mcpServerPort?: number;
  /** Session ID for Claude --resume support */
  sessionId?: string;
}

// ==================== Provider Configurations ====================

const DEFAULT_PROVIDERS: Record<AIProvider, Omit<AIProviderConfig, 'provider'>> = {
  'claude-code': {
    command: 'claude',
    args: [],
  },
  'codex': {
    command: 'codex',
    args: [],
  },
  'custom': {
    command: '',
    args: [],
  },
};

// ==================== AI Chat Content Class ====================

/**
 * AI Chat content that embeds an AI CLI tool in a PTY.
 *
 * Features:
 * - Embeds Claude Code, Codex, or custom AI CLI
 * - Full terminal emulation with ANSI colors
 * - Scrollback support
 * - MCP server configuration for Ultra integration
 * - Session persistence (detach/reattach)
 */
export class AIChatContent implements ScrollablePanelContent, FocusablePanelContent {
  readonly contentType = 'ai-chat' as const;
  readonly contentId: string;

  private _debugName = 'AIChatContent';
  private _rect: Rect = { x: 1, y: 1, width: 80, height: 24 };
  private _visible: boolean = false;
  private _focused: boolean = false;

  // PTY and AI state
  private _pty: PTY | null = null;
  private _provider: AIProvider;
  private _providerConfig: AIProviderConfig;
  private _cwd: string;
  private _mcpServerPort: number | null = null;
  private _isRunning: boolean = false;
  private _exitCode: number | null = null;
  private _title: string = 'AI Chat';

  // Session ID for Claude --resume support (captured from Claude output)
  private _sessionId: string | null = null;

  // Flag to prevent concurrent start attempts
  private _starting: boolean = false;

  // Theme colors
  private _bgColor: string = '#1a1a2e';
  private _fgColor: string = '#e0e0e0';
  private _cursorColor: string = '#00d4ff';
  private _headerBgColor: string = '#16213e';
  private _headerFgColor: string = '#e0e0e0';
  private _focusBorderColor: string = '#00d4ff';
  private _unfocusedBorderColor: string = '#444444';

  // Callbacks
  private _onUpdateCallback?: () => void;
  private _onFocusCallback?: () => void;
  private _onBlurCallback?: () => void;
  private _onExitCallback?: (code: number) => void;

  // Throttling for updates
  private _updatePending = false;
  private _lastUpdateTime = 0;
  private static readonly UPDATE_THROTTLE_MS = 16; // ~60fps max

  constructor(contentId: string, options: AIChatContentOptions = {}) {
    this.contentId = contentId;
    this._provider = options.provider || 'claude-code';
    this._cwd = options.cwd || process.cwd();
    this._mcpServerPort = options.mcpServerPort || null;

    // Configure provider
    if (this._provider === 'custom' && options.customCommand) {
      this._providerConfig = {
        provider: 'custom',
        command: options.customCommand,
        args: options.customArgs || [],
      };
    } else {
      const defaultConfig = DEFAULT_PROVIDERS[this._provider];
      this._providerConfig = {
        provider: this._provider,
        ...defaultConfig,
      };
    }

    // Session ID is only set if restored from a previous session
    this._sessionId = options.sessionId || null;

    this.loadThemeColors();
    this.debugLog(`Created with provider: ${this._provider}, sessionId: ${this._sessionId || 'none'}`);
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this._sessionId;
  }

  /**
   * Set the session ID (for restoring from session state or capturing from Claude)
   */
  setSessionId(sessionId: string): void {
    this._sessionId = sessionId;
    this.debugLog(`Session ID set to: ${sessionId}`);
  }

  // ==================== Debug ====================

  protected debugLog(msg: string): void {
    if (isDebugEnabled()) {
      debugLog(`[${this._debugName}:${this.contentId}] ${msg}`);
    }
  }

  // ==================== Theme ====================

  private loadThemeColors(): void {
    // Use terminal colors with AI-specific overrides
    this._bgColor =
      themeLoader.getColor('terminal.background') ||
      themeLoader.getColor('editor.background') ||
      '#1a1a2e';
    this._fgColor =
      themeLoader.getColor('terminal.foreground') ||
      themeLoader.getColor('editor.foreground') ||
      '#e0e0e0';
    this._cursorColor = themeLoader.getColor('terminalCursor.foreground') || '#00d4ff';
    this._headerBgColor = themeLoader.getColor('tab.activeBackground') || '#16213e';
    this._headerFgColor = themeLoader.getColor('tab.activeForeground') || '#e0e0e0';
    this._focusBorderColor = themeLoader.getColor('focusBorder') || '#00d4ff';
    this._unfocusedBorderColor = themeLoader.getColor('tab.inactiveBackground') || '#444444';
  }

  // ==================== PanelContent Interface ====================

  getTitle(): string {
    if (this._isRunning) {
      return this._title;
    }
    if (this._exitCode !== null) {
      return `${this._title} (exited: ${this._exitCode})`;
    }
    return `${this._title} (not started)`;
  }

  getIcon(): string {
    return '🤖';
  }

  getRect(): Rect {
    return { ...this._rect };
  }

  setRect(rect: Rect): void {
    this._rect = { ...rect };
    // Resize PTY if running
    if (this._pty && this._isRunning) {
      const contentRect = this.getContentRect();
      this._pty.resize(contentRect.width, contentRect.height);
    }
  }

  isDirty(): boolean {
    // AI chat is never "dirty" in the save sense
    return false;
  }

  isVisible(): boolean {
    return this._visible;
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
  }

  // ==================== FocusablePanelContent ====================

  isFocused(): boolean {
    return this._focused;
  }

  setFocused(focused: boolean): void {
    const wasFocused = this._focused;
    this._focused = focused;

    if (focused && !wasFocused) {
      this._onFocusCallback?.();
    } else if (!focused && wasFocused) {
      this._onBlurCallback?.();
    }
  }

  onFocus(callback: () => void): () => void {
    this._onFocusCallback = callback;
    return () => {
      this._onFocusCallback = undefined;
    };
  }

  onBlur(callback: () => void): () => void {
    this._onBlurCallback = callback;
    return () => {
      this._onBlurCallback = undefined;
    };
  }

  // ==================== ScrollablePanelContent ====================

  getScrollTop(): number {
    return this._pty?.getViewOffset() || 0;
  }

  setScrollTop(top: number): void {
    // View offset works inversely - higher = more scrolled back
    if (this._pty) {
      // This is a simplification - would need proper implementation
      this._pty.resetViewOffset();
    }
  }

  getScrollLeft(): number {
    return 0; // Terminal doesn't scroll horizontally
  }

  setScrollLeft(_left: number): void {
    // No-op for terminal
  }

  getContentHeight(): number {
    // Total lines including scrollback
    return this._rect.height + (this._pty?.getViewOffset() || 0);
  }

  getContentWidth(): number {
    return this._rect.width;
  }

  scrollBy(deltaX: number, deltaY: number): void {
    if (!this._pty) return;

    if (deltaY < 0) {
      this._pty.scrollViewUp(Math.abs(deltaY));
    } else if (deltaY > 0) {
      this._pty.scrollViewDown(deltaY);
    }
    this._onUpdateCallback?.();
  }

  // ==================== Update Throttling ====================

  /**
   * Throttle updates to prevent excessive rendering during rapid terminal output
   */
  private throttledUpdate(): void {
    const now = Date.now();
    const elapsed = now - this._lastUpdateTime;

    if (elapsed >= AIChatContent.UPDATE_THROTTLE_MS) {
      // Enough time has passed, update immediately
      this._lastUpdateTime = now;
      this._updatePending = false;
      this._onUpdateCallback?.();
    } else if (!this._updatePending) {
      // Schedule an update for later
      this._updatePending = true;
      const delay = AIChatContent.UPDATE_THROTTLE_MS - elapsed;
      setTimeout(() => {
        if (this._updatePending) {
          this._updatePending = false;
          this._lastUpdateTime = Date.now();
          this._onUpdateCallback?.();
        }
      }, delay);
    }
    // If update is already pending, skip (it will fire soon)
  }

  // ==================== AI Control ====================

  /**
   * Start the AI session
   * If no session ID exists, first captures one via non-interactive mode,
   * then restarts in interactive mode with --resume
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      this.debugLog('Already running, ignoring start');
      return;
    }

    if (this._starting) {
      this.debugLog('Already starting, ignoring duplicate start');
      return;
    }

    this._starting = true;
    try {
      // For Claude Code without a session ID, first capture one
      if (this._provider === 'claude-code' && !this._sessionId) {
        this.debugLog('No session ID, capturing one first...');
        await this.captureSessionId();
      }

      await this.startInteractive();
    } finally {
      this._starting = false;
    }
  }

  /**
   * Capture session ID by running Claude in non-interactive mode
   * Waits for Claude to complete its response before returning so the session is persisted
   */
  private async captureSessionId(): Promise<void> {
    this.debugLog('Starting Claude in non-interactive mode to capture session ID');

    // Get initial prompt from settings
    const initialPrompt = settings.get('ai.panel.initialPrompt' as any) as string ||
      'You are a helpful software engineer working with another software engineer on a coding project using the Ultra IDE';

    // Run claude with initial prompt in JSON mode to get session ID
    const proc = Bun.spawn(['claude', '-p', initialPrompt, '--output-format', 'stream-json', '--verbose'], {
      cwd: this._cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

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
          this._sessionId = capturedSessionId;
          this.debugLog(`Session ID captured and persisted: ${this._sessionId}`);
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
      this._sessionId = capturedSessionId;
      this.debugLog(`Session ID captured (process exited): ${this._sessionId}`);
    } else {
      this.debugLog(`Failed to capture session ID. Full output: ${output.substring(0, 500)}`);
    }
  }

  /**
   * Start Claude in interactive mode (with --resume if we have a session ID)
   */
  private async startInteractive(): Promise<void> {
    this.debugLog(`Starting interactive session with sessionId: ${this._sessionId || 'none'}`);
    const contentRect = this.getContentRect();

    // Build command args
    const args = [...this._providerConfig.args];

    // Add --resume flag for Claude Code to continue the session
    if (this._provider === 'claude-code' && this._sessionId) {
      args.push('--resume', this._sessionId);
      this.debugLog(`Using --resume ${this._sessionId}`);
    }

    // Build environment
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      ...this._providerConfig.env,
    };

    // If MCP server is configured, add to environment
    if (this._mcpServerPort) {
      env.ULTRA_MCP_PORT = String(this._mcpServerPort);
      this.debugLog(`MCP server port configured: ${this._mcpServerPort}`);
    }

    // Build the full command with args for Claude
    let shellCommand = this._providerConfig.command;
    if (args.length > 0) {
      shellCommand = `${this._providerConfig.command} ${args.join(' ')}`;
    }

    // Create PTY
    const scrollback = 1000;
    this._pty = new PTY({
      shell: shellCommand,
      cwd: this._cwd,
      cols: Math.max(1, contentRect.width),
      rows: Math.max(1, contentRect.height),
      scrollback,
      env,
    });

    // Set up callbacks with throttling
    this._pty.onUpdate(() => {
      this.throttledUpdate();
    });

    this._pty.onTitle((title) => {
      this._title = title || this.getProviderName();
      this.throttledUpdate();
    });

    this._pty.onExit((code) => {
      this._isRunning = false;
      this._exitCode = code;
      this.debugLog(`AI exited with code: ${code}`);
      this._onExitCallback?.(code);
      this._onUpdateCallback?.();
    });

    try {
      await this._pty.start();
      this._isRunning = true;
      this._exitCode = null;
      this._title = this.getProviderName();
      this.debugLog('Interactive session started');
    } catch (error) {
      this.debugLog(`Failed to start AI: ${error}`);
      this._isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the AI session
   */
  stop(): void {
    if (this._pty) {
      this.debugLog('Stopping AI session');
      this._pty.kill();
      this._pty = null;
      this._isRunning = false;
    }
  }

  /**
   * Check if AI is running or starting
   */
  isRunning(): boolean {
    return this._isRunning || this._starting;
  }

  /**
   * Get the provider display name
   */
  getProviderName(): string {
    switch (this._provider) {
      case 'claude-code':
        return 'Claude Code';
      case 'codex':
        return 'Codex';
      case 'custom':
        return this._providerConfig.command || 'Custom AI';
      default:
        return 'AI';
    }
  }

  /**
   * Write input to the AI terminal
   */
  write(data: string): void {
    if (this._pty && this._isRunning) {
      this._pty.write(data);
    }
  }

  /**
   * Set MCP server port for Ultra integration
   */
  setMCPServerPort(port: number): void {
    this._mcpServerPort = port;
    this.debugLog(`MCP server port set to: ${port}`);
  }

  // ==================== Input Handling ====================

  handleKey(event: KeyEvent): boolean {
    if (!this._pty || !this._isRunning) {
      return false;
    }

    const { key, ctrl, alt, shift, char } = event;

    // Handle Ctrl+C, Ctrl+D, etc.
    if (ctrl && !alt && !shift) {
      if (key.length === 1) {
        const code = key.toUpperCase().charCodeAt(0) - 64;
        if (code >= 0 && code <= 31) {
          this._pty.write(String.fromCharCode(code));
          return true;
        }
      }
    }

    // Map special keys to escape sequences
    const keyMap: Record<string, string> = {
      UP: '\x1b[A',
      DOWN: '\x1b[B',
      RIGHT: '\x1b[C',
      LEFT: '\x1b[D',
      HOME: '\x1b[H',
      END: '\x1b[F',
      PAGEUP: '\x1b[5~',
      PAGEDOWN: '\x1b[6~',
      INSERT: '\x1b[2~',
      DELETE: '\x1b[3~',
      BACKSPACE: '\x7f',
      TAB: '\t',
      ENTER: '\r',
      ESCAPE: '\x1b',
      F1: '\x1bOP',
      F2: '\x1bOQ',
      F3: '\x1bOR',
      F4: '\x1bOS',
      F5: '\x1b[15~',
      F6: '\x1b[17~',
      F7: '\x1b[18~',
      F8: '\x1b[19~',
      F9: '\x1b[20~',
      F10: '\x1b[21~',
      F11: '\x1b[23~',
      F12: '\x1b[24~',
    };

    if (keyMap[key]) {
      this._pty.write(keyMap[key]!);
      return true;
    }

    // Regular characters
    if (char && char.length === 1 && !ctrl && !alt) {
      this._pty.write(char);
      return true;
    }

    return false;
  }

  handleMouse(event: MouseEvent): boolean {
    if (!this.containsPoint(event.x, event.y)) {
      return false;
    }

    // Focus on click
    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      if (!this._focused) {
        this.setFocused(true);
      }
      return true;
    }

    // Scroll
    if (event.name === 'MOUSE_WHEEL_UP') {
      this.scrollBy(0, -3);
      return true;
    }

    if (event.name === 'MOUSE_WHEEL_DOWN') {
      this.scrollBy(0, 3);
      return true;
    }

    return true;
  }

  containsPoint(x: number, y: number): boolean {
    return (
      x >= this._rect.x &&
      x < this._rect.x + this._rect.width &&
      y >= this._rect.y &&
      y < this._rect.y + this._rect.height
    );
  }

  // ==================== Rendering ====================

  /**
   * Get content area rect (excluding header)
   */
  private getContentRect(): Rect {
    return {
      x: this._rect.x,
      y: this._rect.y + 1, // Account for header
      width: this._rect.width,
      height: Math.max(1, this._rect.height - 1),
    };
  }

  render(ctx: RenderContext): void {
    this.loadThemeColors();
    this.renderHeader(ctx);
    this.renderContent(ctx);
  }

  private renderHeader(ctx: RenderContext): void {
    const bgRgb = hexToRgb(this._headerBgColor);
    const fgRgb = hexToRgb(this._headerFgColor);
    const borderColor = this._focused ? this._focusBorderColor : this._unfocusedBorderColor;
    const borderRgb = hexToRgb(borderColor);

    let output = `\x1b[${this._rect.y};${this._rect.x}H`;

    // Focus indicator - left border character
    if (borderRgb) output += `\x1b[38;2;${borderRgb.r};${borderRgb.g};${borderRgb.b}m`;
    if (bgRgb) output += `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
    output += this._focused ? '▐' : '│';

    // Background for rest of header
    if (bgRgb) output += `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
    if (fgRgb) output += `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m`;
    output += ' '.repeat(this._rect.width - 1);

    // Title
    output += `\x1b[${this._rect.y};${this._rect.x + 1}H`;
    if (bgRgb) output += `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
    if (fgRgb) output += `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m`;

    const icon = this.getIcon();
    const title = this.getTitle();
    const status = this._isRunning ? '●' : '○';
    const statusColor = this._isRunning ? '32' : '31'; // Green or red

    output += ` ${icon} `;
    output += `\x1b[${statusColor}m${status}\x1b[0m`;
    if (bgRgb) output += `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
    if (fgRgb) output += `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m`;
    output += ` ${title}`;

    // Focus indicator text
    if (this._focused) {
      output += `\x1b[1m FOCUSED\x1b[22m`;
    }

    // Controls on right side
    const controls = this._isRunning ? '[Ctrl+C: interrupt]' : '[Enter: start]';
    const controlsX = this._rect.x + this._rect.width - controls.length - 1;
    if (controlsX > this._rect.x + title.length + 15) {
      output += `\x1b[${this._rect.y};${controlsX}H`;
      output += `\x1b[2m${controls}\x1b[22m`; // Dim
    }

    output += '\x1b[0m';
    ctx.buffer(output);
  }

  // Color cache for performance
  private _colorCache = new Map<string, { r: number; g: number; b: number } | null>();

  private getCachedRgb(hex: string | undefined): { r: number; g: number; b: number } | null {
    if (!hex) return null;
    let result = this._colorCache.get(hex);
    if (result === undefined) {
      result = hexToRgb(hex);
      this._colorCache.set(hex, result);
    }
    return result;
  }

  private renderContent(ctx: RenderContext): void {
    const contentRect = this.getContentRect();

    if (!this._pty || !this._isRunning) {
      this.renderEmptyState(ctx, contentRect);
      return;
    }

    const buffer = this._pty.getBuffer();
    const cursor = this._pty.getCursor();
    const viewOffset = this._pty.getViewOffset();

    const defaultBg = this.getCachedRgb(this._bgColor);
    const defaultFg = this.getCachedRgb(this._fgColor);
    const cursorRgb = this.getCachedRgb(this._cursorColor);

    // Pre-calculate default background escape sequence
    const defaultBgEsc = defaultBg ? `\x1b[48;2;${defaultBg.r};${defaultBg.g};${defaultBg.b}m` : '';

    for (let y = 0; y < contentRect.height; y++) {
      const line = buffer[y];
      if (!line) {
        // Empty line - use pre-calculated escape
        ctx.buffer(`\x1b[${contentRect.y + y};${contentRect.x}H${defaultBgEsc}${' '.repeat(contentRect.width)}\x1b[0m`);
        continue;
      }

      let output = `\x1b[${contentRect.y + y};${contentRect.x}H`;

      // Track current state to avoid redundant escape codes
      let currentFg: string | null = null;
      let currentBg: string | null = null;
      let currentBold = false;
      let currentDim = false;
      let currentItalic = false;
      let currentUnderline = false;

      const lineLen = Math.min(line.length, contentRect.width);
      for (let x = 0; x < lineLen; x++) {
        const cell = line[x]!;
        const isCursor = this._focused && viewOffset === 0 && y === cursor.y && x === cursor.x;

        // Determine colors using cache
        let fg = cell.fg ? this.getCachedRgb(cell.fg) : defaultFg;
        let bg = cell.bg ? this.getCachedRgb(cell.bg) : defaultBg;

        // Handle inverse
        if (cell.inverse) {
          [fg, bg] = [bg, fg];
        }

        // Cursor rendering
        if (isCursor) {
          bg = cursorRgb;
          fg = defaultBg;
        }

        // Build escape codes only when needed
        const fgKey = fg ? `${fg.r},${fg.g},${fg.b}` : '';
        const bgKey = bg ? `${bg.r},${bg.g},${bg.b}` : '';

        if (bgKey !== currentBg) {
          if (bg) output += `\x1b[48;2;${bg.r};${bg.g};${bg.b}m`;
          currentBg = bgKey;
        }
        if (fgKey !== currentFg) {
          if (fg) output += `\x1b[38;2;${fg.r};${fg.g};${fg.b}m`;
          currentFg = fgKey;
        }

        // Apply attributes only when they change
        if (cell.bold !== currentBold) {
          output += cell.bold ? '\x1b[1m' : '\x1b[22m';
          currentBold = cell.bold;
        }
        if (cell.dim !== currentDim) {
          output += cell.dim ? '\x1b[2m' : '\x1b[22m';
          currentDim = cell.dim;
        }
        if (cell.italic !== currentItalic) {
          output += cell.italic ? '\x1b[3m' : '\x1b[23m';
          currentItalic = cell.italic;
        }
        if (cell.underline !== currentUnderline) {
          output += cell.underline ? '\x1b[4m' : '\x1b[24m';
          currentUnderline = cell.underline;
        }

        output += cell.char;
      }

      // Fill remaining width
      const remaining = contentRect.width - lineLen;
      if (remaining > 0) {
        // Reset to default background for padding
        if (defaultBg && currentBg !== `${defaultBg.r},${defaultBg.g},${defaultBg.b}`) {
          output += `\x1b[48;2;${defaultBg.r};${defaultBg.g};${defaultBg.b}m`;
        }
        output += ' '.repeat(remaining);
      }

      // Reset at end of line
      output += '\x1b[0m';
      ctx.buffer(output);
    }
  }

  private renderEmptyState(ctx: RenderContext, contentRect: Rect): void {
    const bg = this.getCachedRgb(this._bgColor);
    const fg = this.getCachedRgb(this._fgColor);

    // Pre-calculate escape sequences
    const bgEsc = bg ? `\x1b[48;2;${bg.r};${bg.g};${bg.b}m` : '';
    const fgEsc = fg ? `\x1b[38;2;${fg.r};${fg.g};${fg.b}m` : '';
    const spaces = ' '.repeat(contentRect.width);

    // Fill background
    for (let y = 0; y < contentRect.height; y++) {
      ctx.buffer(`\x1b[${contentRect.y + y};${contentRect.x}H${bgEsc}${spaces}\x1b[0m`);
    }

    // Center message
    const providerName = this.getProviderName();
    const lines = [
      `${this.getIcon()} ${providerName}`,
      '',
      this._exitCode !== null ? `Session ended (code: ${this._exitCode})` : 'Session not started',
      '',
      'Press Enter to start a new session',
    ];

    const startY = contentRect.y + Math.floor((contentRect.height - lines.length) / 2);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const x = contentRect.x + Math.floor((contentRect.width - line.length) / 2);
      const y = startY + i;

      if (y >= contentRect.y && y < contentRect.y + contentRect.height) {
        let output = `\x1b[${y};${x}H${bgEsc}${fgEsc}`;
        if (i === 0) output += '\x1b[1m'; // Bold title
        output += line;
        output += '\x1b[0m';
        ctx.buffer(output);
      }
    }
  }

  // ==================== Lifecycle ====================

  onActivated(): void {
    this.debugLog('Activated');
    // Start if not already running and user hasn't explicitly stopped
    // We leave this to explicit user action for now
  }

  onDeactivated(): void {
    this.debugLog('Deactivated');
    // Keep running in background
  }

  serialize(): ContentState {
    return {
      contentType: this.contentType,
      contentId: this.contentId,
      title: this._title,
      data: {
        provider: this._provider,
        cwd: this._cwd,
        mcpServerPort: this._mcpServerPort,
        sessionId: this._sessionId,
      },
    };
  }

  restore(state: ContentState): void {
    if (state.data.provider) {
      this._provider = state.data.provider as AIProvider;
    }
    if (state.data.cwd) {
      this._cwd = state.data.cwd as string;
    }
    if (state.data.mcpServerPort) {
      this._mcpServerPort = state.data.mcpServerPort as number;
    }
    if (state.title) {
      this._title = state.title;
    }
    // Restore session ID for Claude --resume support
    if (state.data.sessionId && typeof state.data.sessionId === 'string') {
      this._sessionId = state.data.sessionId;
      this.debugLog(`Restored sessionId: ${this._sessionId}`);
    }
    this.debugLog('Restored from state');
  }

  dispose(): void {
    this.debugLog('Disposing');
    this.stop();
    this._onUpdateCallback = undefined;
    this._onFocusCallback = undefined;
    this._onBlurCallback = undefined;
    this._onExitCallback = undefined;
  }

  // ==================== Callbacks ====================

  onUpdate(callback: () => void): () => void {
    this._onUpdateCallback = callback;
    return () => {
      this._onUpdateCallback = undefined;
    };
  }

  onExit(callback: (code: number) => void): () => void {
    this._onExitCallback = callback;
    return () => {
      this._onExitCallback = undefined;
    };
  }
}

// ==================== Factory ====================

/**
 * Create an AI chat content instance
 */
export function createAIChatContent(
  contentId: string,
  options?: AIChatContentOptions
): AIChatContent {
  return new AIChatContent(contentId, options);
}

export default AIChatContent;
