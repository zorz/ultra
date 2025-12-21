/**
 * Base Element
 *
 * Abstract base class for all TUI elements.
 * Provides lifecycle management, rendering interface, and input handling.
 */

import type {
  Rect,
  Size,
  ElementType,
  ElementLifecycle,
  KeyEvent,
  MouseEvent,
} from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Element Context
// ============================================

/**
 * Element type for focus color lookups.
 */
export type FocusableElementType = 'editor' | 'sidebar' | 'panel' | 'terminal';

/**
 * Context provided to elements for accessing services and capabilities.
 */
export interface ElementContext {
  /** Mark element or region for re-render */
  markDirty: (region?: Rect) => void;
  /** Request focus for this element */
  requestFocus: () => void;
  /** Update element title (shown in tabs/headers) */
  updateTitle: (title: string) => void;
  /** Update element status (shown in accordion headers) */
  updateStatus: (status: string) => void;
  /** Get a color from the current theme */
  getThemeColor: (key: string, fallback?: string) => string;
  /** Check if the containing pane is focused */
  isPaneFocused: () => boolean;
  /** Get background color for focus state */
  getBackgroundForFocus: (elementType: FocusableElementType, isFocused: boolean) => string;
  /** Get foreground color for focus state */
  getForegroundForFocus: (elementType: FocusableElementType, isFocused: boolean) => string;
  /** Get selection background for focus state */
  getSelectionBackground: (elementType: FocusableElementType, isFocused: boolean) => string;
}

/**
 * Create a minimal element context for testing.
 */
export function createTestContext(overrides: Partial<ElementContext> = {}): ElementContext {
  return {
    markDirty: () => {},
    requestFocus: () => {},
    updateTitle: () => {},
    updateStatus: () => {},
    getThemeColor: (_key: string, fallback = '#ffffff') => fallback,
    isPaneFocused: () => true,
    getBackgroundForFocus: (_type, _focused) => '#1e1e1e',
    getForegroundForFocus: (_type, _focused) => '#d4d4d4',
    getSelectionBackground: (_type, _focused) => '#094771',
    ...overrides,
  };
}

// ============================================
// Base Element Class
// ============================================

/**
 * Abstract base class for TUI elements.
 *
 * Elements are the content components that render within panes.
 * Each element type (DocumentEditor, FileTree, etc.) extends this class.
 */
export abstract class BaseElement implements ElementLifecycle {
  /** Element type identifier */
  readonly type: ElementType;
  /** Unique instance ID */
  readonly id: string;

  /** Display title (shown in tabs/headers) */
  protected title: string;
  /** Status text (shown in accordion headers) */
  protected status: string = '';
  /** Element bounds within parent container */
  protected bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** Whether element is currently visible */
  protected visible: boolean = false;
  /** Whether element has focus */
  protected focused: boolean = false;
  /** Element context for accessing services */
  protected ctx: ElementContext;

  constructor(type: ElementType, id: string, title: string, ctx: ElementContext) {
    this.type = type;
    this.id = id;
    this.title = title;
    this.ctx = ctx;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Called when element is added to a container.
   * Override to initialize resources.
   */
  onMount(): void {}

  /**
   * Called when element is removed from a container.
   * Override to clean up resources.
   */
  onUnmount(): void {}

  /**
   * Called when element receives focus.
   */
  onFocus(): void {
    this.focused = true;
    this.ctx.markDirty();
  }

  /**
   * Called when element loses focus.
   */
  onBlur(): void {
    this.focused = false;
    this.ctx.markDirty();
  }

  /**
   * Called when element is resized.
   */
  onResize(size: Size): void {
    this.bounds.width = size.width;
    this.bounds.height = size.height;
    this.ctx.markDirty();
  }

  /**
   * Called when visibility changes.
   */
  onVisibilityChange(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      this.ctx.markDirty();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Render element content to the buffer.
   * Coordinates are relative to bounds (0,0 is top-left of element).
   * Must be implemented by subclasses.
   */
  abstract render(buffer: ScreenBuffer): void;

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle keyboard input.
   * @param event Key event
   * @returns true if handled, false to propagate
   */
  handleKey(event: KeyEvent): boolean {
    return false;
  }

  /**
   * Handle mouse input.
   * Coordinates are relative to element bounds.
   * @param event Mouse event
   * @returns true if handled, false to propagate
   */
  handleMouse(event: MouseEvent): boolean {
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get state for session persistence.
   * Override to include element-specific state.
   */
  getState(): unknown {
    return {};
  }

  /**
   * Restore state from session.
   * Override to restore element-specific state.
   */
  setState(_state: unknown): void {}

  // ─────────────────────────────────────────────────────────────────────────
  // Accessors
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get element title.
   */
  getTitle(): string {
    return this.title;
  }

  /**
   * Set element title.
   */
  setTitle(title: string): void {
    if (this.title !== title) {
      this.title = title;
      this.ctx.updateTitle(title);
    }
  }

  /**
   * Get element status.
   */
  getStatus(): string {
    return this.status;
  }

  /**
   * Set element status.
   */
  setStatus(status: string): void {
    if (this.status !== status) {
      this.status = status;
      this.ctx.updateStatus(status);
    }
  }

  /**
   * Get element bounds.
   */
  getBounds(): Rect {
    return { ...this.bounds };
  }

  /**
   * Set element bounds.
   */
  setBounds(bounds: Rect): void {
    const needsResize =
      this.bounds.width !== bounds.width || this.bounds.height !== bounds.height;

    this.bounds = { ...bounds };

    if (needsResize) {
      this.onResize({ width: bounds.width, height: bounds.height });
    }
  }

  /**
   * Check if element is focused.
   */
  isFocused(): boolean {
    return this.focused;
  }

  /**
   * Check if element is visible.
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Get the element context.
   */
  getContext(): ElementContext {
    return this.ctx;
  }

  /**
   * Set the element context.
   * Used when moving elements between containers.
   */
  setContext(ctx: ElementContext): void {
    this.ctx = ctx;
  }
}
