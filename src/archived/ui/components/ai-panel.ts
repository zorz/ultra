/**
 * AI Panel Component
 *
 * Wrapper for AIChatContent that integrates with the layout system.
 * Uses the panel abstraction layer and MCP server for AI tool access.
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import { AIChatContent, type AIProvider, type AIChatContentOptions } from '../panels/ai-chat-content.ts';
import { debugLog, isDebugEnabled } from '../../debug.ts';

/**
 * AI Panel wraps AIChatContent for integration with Ultra's layout system
 */
export class AIPanel implements MouseHandler {
  private _debugName = 'AIPanel';
  private _rect: Rect = { x: 1, y: 1, width: 40, height: 20 };
  private _aiChat: AIChatContent | null = null;
  private _focused: boolean = false;
  private _visible: boolean = false;

  // Preserved chat state from session restore (used when _aiChat hasn't been instantiated yet)
  private _preservedChatState: Record<string, unknown> | null = null;

  // Callbacks
  private _onUpdateCallback?: () => void;
  private _onFocusCallback?: () => void;
  private _onSessionIdCapturedCallback?: (sessionId: string) => void;

  constructor() {
    this.debugLog('Created');
  }

  protected debugLog(msg: string): void {
    if (isDebugEnabled()) {
      debugLog(`[${this._debugName}] ${msg}`);
    }
  }

  // ==================== AI Chat Management ====================

  /**
   * Initialize or get the AI chat instance
   */
  private ensureAIChat(): AIChatContent {
    if (!this._aiChat) {
      this._aiChat = new AIChatContent('ai-panel-chat', {
        provider: 'claude-code',
        cwd: process.cwd(),
      });

      // Wire up callbacks
      this._aiChat.onUpdate(() => {
        this._onUpdateCallback?.();
      });

      this._aiChat.onSessionIdCaptured((sessionId) => {
        this.debugLog(`Session ID captured: ${sessionId}`);
        this._onSessionIdCapturedCallback?.(sessionId);
      });

      this.debugLog('AI chat created');

      // Restore preserved state if available (from deferred session restore)
      if (this._preservedChatState) {
        this.debugLog('Restoring preserved chatState to newly created _aiChat');
        this._aiChat.restore(this._preservedChatState as any);
        // Keep _preservedChatState around for serialization until first real serialize
      }
    }
    return this._aiChat;
  }

  /**
   * Start the AI session
   */
  async start(): Promise<void> {
    const chat = this.ensureAIChat();
    if (!chat.isRunning()) {
      this.debugLog('Starting AI session');
      await chat.start();
    }
  }

  /**
   * Stop the AI session
   */
  stop(): void {
    if (this._aiChat) {
      this._aiChat.stop();
      this.debugLog('AI session stopped');
    }
  }

  /**
   * Check if AI is running
   */
  isRunning(): boolean {
    return this._aiChat?.isRunning() ?? false;
  }

  /**
   * Get the underlying AIChatContent
   */
  getAIChat(): AIChatContent | null {
    return this._aiChat;
  }

  /**
   * Set the AI provider
   */
  setProvider(provider: AIProvider): void {
    // Need to recreate chat with new provider
    if (this._aiChat) {
      const wasRunning = this._aiChat.isRunning();
      this._aiChat.dispose();
      this._aiChat = null;

      // Recreate with new provider
      this._aiChat = new AIChatContent('ai-panel-chat', {
        provider,
        cwd: process.cwd(),
      });

      this._aiChat.onUpdate(() => {
        this._onUpdateCallback?.();
      });

      if (wasRunning) {
        this._aiChat.start();
      }
    }
  }

  /**
   * Set MCP server port for tool access
   */
  setMCPServerPort(port: number): void {
    if (this._aiChat) {
      this._aiChat.setMCPServerPort(port);
    }
  }

  // ==================== Layout Integration ====================

  setRect(rect: Rect): void {
    this._rect = { ...rect };
    if (this._aiChat) {
      this._aiChat.setRect(rect);
    }
  }

  getRect(): Rect {
    return { ...this._rect };
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    if (this._aiChat) {
      this._aiChat.setVisible(visible);
    }
  }

  isVisible(): boolean {
    return this._visible;
  }

  // ==================== Focus ====================

  setFocused(focused: boolean): void {
    const wasFocused = this._focused;
    this._focused = focused;

    if (this._aiChat) {
      this._aiChat.setFocused(focused);
    }

    if (focused && !wasFocused) {
      this._onFocusCallback?.();
    }
  }

  isFocused(): boolean {
    return this._focused;
  }

  // ==================== Rendering ====================

  render(ctx: RenderContext): void {
    if (!this._visible) return;

    const chat = this.ensureAIChat();
    chat.setRect(this._rect);
    chat.render(ctx);
  }

  // ==================== Input Handling ====================

  handleKey(event: KeyEvent): boolean {
    if (!this._visible || !this._focused) return false;

    // If AI is not running and user presses Enter, start it
    if (event.key === 'ENTER' && !this.isRunning()) {
      this.start();
      return true;
    }

    if (this._aiChat) {
      return this._aiChat.handleKey(event);
    }

    return false;
  }

  containsPoint(x: number, y: number): boolean {
    // Early return if not visible - don't claim any mouse events
    if (!this._visible) return false;
    return (
      x >= this._rect.x &&
      x < this._rect.x + this._rect.width &&
      y >= this._rect.y &&
      y < this._rect.y + this._rect.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    if (!this._visible) return false;

    if (!this.containsPoint(event.x, event.y)) {
      return false;
    }

    // Focus on click
    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      if (!this._focused) {
        this.setFocused(true);
      }
    }

    if (this._aiChat) {
      return this._aiChat.handleMouse(event);
    }

    return true;
  }

  // ==================== Callbacks ====================

  onUpdate(callback: () => void): () => void {
    this._onUpdateCallback = callback;
    return () => {
      this._onUpdateCallback = undefined;
    };
  }

  onFocus(callback: () => void): () => void {
    this._onFocusCallback = callback;
    return () => {
      this._onFocusCallback = undefined;
    };
  }

  onSessionIdCaptured(callback: (sessionId: string) => void): () => void {
    this._onSessionIdCapturedCallback = callback;
    return () => {
      this._onSessionIdCapturedCallback = undefined;
    };
  }

  // ==================== Lifecycle ====================

  dispose(): void {
    if (this._aiChat) {
      this._aiChat.dispose();
      this._aiChat = null;
    }
    this._onUpdateCallback = undefined;
    this._onFocusCallback = undefined;
    this._onSessionIdCapturedCallback = undefined;
    this.debugLog('Disposed');
  }

  // ==================== Serialization ====================

  /**
   * Serialize AI panel state for session persistence
   */
  serialize(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      visible: this._visible,
      focused: this._focused,
    };

    // Include chat state if chat exists
    if (this._aiChat) {
      const chatState = this._aiChat.serialize();
      this.debugLog(`Serializing: _aiChat exists, sessionId=${chatState.data?.sessionId || 'null'}`);
      result.chatState = chatState;
      // Clear preserved state since we now have the real state
      this._preservedChatState = null;
    } else if (this._preservedChatState) {
      // Use preserved state from session restore if _aiChat hasn't been instantiated
      this.debugLog(`Serializing: using preserved chatState, sessionId=${(this._preservedChatState.data as any)?.sessionId || 'null'}`);
      result.chatState = this._preservedChatState;
    } else {
      this.debugLog('Serializing: _aiChat is null and no preserved state');
    }

    return result;
  }

  /**
   * Restore AI panel state from session
   */
  restore(state: Record<string, unknown>): void {
    if (!state) {
      this.debugLog('Restore called with null/undefined state');
      return;
    }

    this.debugLog(`Restore called with state: visible=${state.visible}, focused=${state.focused}, hasChatState=${!!state.chatState}`);

    // Restore visibility and focus state
    if (typeof state.visible === 'boolean') {
      this._visible = state.visible;
    }
    if (typeof state.focused === 'boolean') {
      this._focused = state.focused;
    }

    // Preserve chat state for later serialization even if we don't instantiate _aiChat now
    if (state.chatState && typeof state.chatState === 'object') {
      const chatState = state.chatState as Record<string, unknown>;
      const sessionId = (chatState.data as Record<string, unknown>)?.sessionId;
      this.debugLog(`Preserving chatState with sessionId=${sessionId || 'null'}`);
      // Store the chatState so we can serialize it even if _aiChat is never instantiated
      this._preservedChatState = chatState;

      // Only instantiate _aiChat if the panel is visible (will be used immediately)
      // Otherwise, let it be created lazily when the panel is shown
      if (this._visible) {
        const chat = this.ensureAIChat();
        chat.restore(chatState as any);
        this.debugLog(`After restore: _aiChat.sessionId=${chat.getSessionId() || 'null'}`);
      } else {
        this.debugLog('Panel not visible, deferring _aiChat instantiation');
      }
    } else {
      this.debugLog('No chatState to restore');
    }

    this.debugLog('Restored from session state');
  }
}

export const aiPanel = new AIPanel();
export default aiPanel;
