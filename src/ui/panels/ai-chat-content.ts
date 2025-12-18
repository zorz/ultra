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

    this.loadThemeColors();
    this.debugLog('Created with provider: ' + this._provider);
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

  // ==================== AI Control ====================

  /**
   * Start the AI session
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      this.debugLog('Already running, ignoring start');
      return;
    }

    this.debugLog('Starting AI session');
    const contentRect = this.getContentRect();

    // Build command args
    const args = [...this._providerConfig.args];

    // Add MCP server config if available
    if (this._mcpServerPort) {
      // Claude Code supports --mcp-config for MCP server connections
      if (this._provider === 'claude-code') {
        // We'll pass the MCP config as an environment variable or argument
        // The actual MCP config will be handled by the MCP server module
        this.debugLog(`MCP server port configured: ${this._mcpServerPort}`);
      }
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
    }

    // Create PTY - use reasonable scrollback default for AI chat
    const scrollback = 1000;
    this._pty = new PTY({
      shell: this._providerConfig.command,
      cwd: this._cwd,
      cols: Math.max(1, contentRect.width),
      rows: Math.max(1, contentRect.height),
      scrollback,
      env,
    });

    // Set up callbacks
    this._pty.onUpdate(() => {
      this._onUpdateCallback?.();
    });

    this._pty.onTitle((title) => {
      this._title = title || this.getProviderName();
      this._onUpdateCallback?.();
    });

    this._pty.onExit((code) => {
      this._isRunning = false;
      this._exitCode = code;
      this.debugLog(`AI exited with code: ${code}`);
      this._onExitCallback?.(code);
      this._onUpdateCallback?.();
    });

    try {
      // Start the PTY with the AI command
      // Note: PTY.start() spawns a shell, but we want to run the AI command directly
      // We'll write the command after the shell starts
      await this._pty.start();
      this._isRunning = true;
      this._exitCode = null;
      this._title = this.getProviderName();

      // If we want to run AI directly (not through shell), we'd need to modify PTY
      // For now, we can send the command to the shell
      // This is a workaround - ideally we'd spawn the AI command directly
      if (args.length > 0) {
        this._pty.write(`${args.join(' ')}\n`);
      }

      this.debugLog('AI session started');
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
   * Check if AI is running
   */
  isRunning(): boolean {
    return this._isRunning;
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

  private renderContent(ctx: RenderContext): void {
    const contentRect = this.getContentRect();

    if (!this._pty || !this._isRunning) {
      this.renderEmptyState(ctx, contentRect);
      return;
    }

    const buffer = this._pty.getBuffer();
    const cursor = this._pty.getCursor();
    const viewOffset = this._pty.getViewOffset();

    const defaultBg = hexToRgb(this._bgColor);
    const defaultFg = hexToRgb(this._fgColor);

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
        const isCursor = this._focused && viewOffset === 0 && y === cursor.y && x === cursor.x;

        // Determine colors
        let fg = cell.fg ? hexToRgb(cell.fg) : defaultFg;
        let bg = cell.bg ? hexToRgb(cell.bg) : defaultBg;

        // Handle inverse
        if (cell.inverse) {
          [fg, bg] = [bg, fg];
        }

        // Cursor rendering
        if (isCursor) {
          const cursorRgb = hexToRgb(this._cursorColor);
          bg = cursorRgb;
          fg = defaultBg;
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
        output += '\x1b[0m';
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

  private renderEmptyState(ctx: RenderContext, contentRect: Rect): void {
    const bg = hexToRgb(this._bgColor);
    const fg = hexToRgb(this._fgColor);

    // Fill background
    for (let y = 0; y < contentRect.height; y++) {
      let output = `\x1b[${contentRect.y + y};${contentRect.x}H`;
      if (bg) output += `\x1b[48;2;${bg.r};${bg.g};${bg.b}m`;
      output += ' '.repeat(contentRect.width);
      output += '\x1b[0m';
      ctx.buffer(output);
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
        let output = `\x1b[${y};${x}H`;
        if (bg) output += `\x1b[48;2;${bg.r};${bg.g};${bg.b}m`;
        if (fg) output += `\x1b[38;2;${fg.r};${fg.g};${fg.b}m`;
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
        wasRunning: this._isRunning,
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
    // Note: We don't auto-restart on restore - user must explicitly start
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
