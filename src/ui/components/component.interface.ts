/**
 * Component Interfaces
 *
 * Defines the base interfaces for all UI components in Ultra.
 * These interfaces establish a consistent contract for lifecycle,
 * rendering, input handling, and focus management.
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { MouseEvent } from '../mouse.ts';

// ==================== Base Component ====================

/**
 * Base interface for all UI components.
 *
 * Provides common properties and methods that all renderable
 * components should implement for consistent lifecycle management.
 *
 * @example
 * class StatusBar implements UIComponent {
 *   readonly id = 'status-bar';
 *   private visible = true;
 *   private rect: Rect = { x: 1, y: 1, width: 80, height: 1 };
 *
 *   isVisible(): boolean { return this.visible; }
 *   getRect(): Rect { return this.rect; }
 *   setRect(rect: Rect): void { this.rect = rect; }
 *   render(ctx: RenderContext): void { ... }
 * }
 */
export interface UIComponent {
  /**
   * Unique identifier for this component instance.
   * Used for focus management, event routing, and debugging.
   */
  readonly id: string;

  /**
   * Check if the component is currently visible/active.
   * Invisible components should not be rendered or receive input.
   */
  isVisible(): boolean;

  /**
   * Get the component's bounding rectangle.
   * Coordinates are 1-indexed (terminal convention).
   */
  getRect(): Rect;

  /**
   * Update the component's bounding rectangle.
   * Called by layout manager when screen size changes.
   */
  setRect(rect: Rect): void;

  /**
   * Render the component to the given context.
   * Should check isVisible() and return early if not visible.
   *
   * @param ctx - Render context with drawing methods
   */
  render(ctx: RenderContext): void;

  /**
   * Handle keyboard input.
   * Return true if the event was handled, false to propagate.
   *
   * @param event - Keyboard event to handle
   * @returns true if handled, false to propagate
   */
  handleKey?(event: KeyEvent): boolean;

  /**
   * Handle mouse input.
   * Return true if the event was handled, false to propagate.
   *
   * @param event - Mouse event to handle
   * @returns true if handled, false to propagate
   */
  handleMouse?(event: MouseEvent): boolean;

  /**
   * Check if a point is within this component's bounds.
   * Used for mouse event routing.
   *
   * @param x - X coordinate (1-indexed)
   * @param y - Y coordinate (1-indexed)
   */
  containsPoint?(x: number, y: number): boolean;

  /**
   * Clean up resources when component is destroyed.
   * Called before the component is removed from the UI tree.
   */
  dispose?(): void;
}

// ==================== Focusable Component ====================

/**
 * Component that can receive keyboard focus.
 *
 * Focused components receive keyboard events before other components.
 * Only one component can be focused at a time.
 *
 * @example
 * class TextInput implements FocusableComponent {
 *   readonly id = 'text-input';
 *   private focused = false;
 *
 *   isFocused(): boolean { return this.focused; }
 *   setFocused(focused: boolean): void {
 *     const wasFocused = this.focused;
 *     this.focused = focused;
 *     if (focused && !wasFocused) this.emit('focus');
 *     if (!focused && wasFocused) this.emit('blur');
 *   }
 * }
 */
export interface FocusableComponent extends UIComponent {
  /**
   * Check if this component currently has focus.
   */
  isFocused(): boolean;

  /**
   * Set the focus state of this component.
   * Should trigger focus/blur callbacks when state changes.
   *
   * @param focused - New focus state
   */
  setFocused(focused: boolean): void;

  /**
   * Register a callback for when the component gains focus.
   * @returns Unsubscribe function
   */
  onFocus?(callback: () => void): () => void;

  /**
   * Register a callback for when the component loses focus.
   * @returns Unsubscribe function
   */
  onBlur?(callback: () => void): () => void;
}

// ==================== Container Component ====================

/**
 * Component that manages child components.
 *
 * Container components handle layout and event routing for their children.
 * Events are typically routed to children first, then handled by the container.
 *
 * @example
 * class SplitPane implements ContainerComponent {
 *   private children: UIComponent[] = [];
 *
 *   getChildren(): UIComponent[] { return [...this.children]; }
 *   addChild(component: UIComponent): void {
 *     this.children.push(component);
 *     this.relayout();
 *   }
 * }
 */
export interface ContainerComponent extends UIComponent {
  /**
   * Get all child components.
   * Returns a copy to prevent external modification.
   */
  getChildren(): UIComponent[];

  /**
   * Add a child component.
   * The container is responsible for positioning the child.
   */
  addChild(component: UIComponent): void;

  /**
   * Remove a child component.
   * The child's dispose() method should be called if it exists.
   */
  removeChild(component: UIComponent): void;

  /**
   * Find a child component by ID.
   * Searches recursively through nested containers.
   */
  findById?(id: string): UIComponent | undefined;
}

// ==================== Scrollable Component ====================

/**
 * Component with scrollable content.
 *
 * Used for components that display content larger than their visible area,
 * such as editors, file trees, and lists.
 */
export interface ScrollableComponent extends UIComponent {
  /**
   * Get current scroll position (top line/row).
   */
  getScrollTop(): number;

  /**
   * Get current horizontal scroll position.
   */
  getScrollLeft(): number;

  /**
   * Set scroll position.
   * Implementations should clamp to valid range.
   */
  setScrollTop(top: number): void;

  /**
   * Set horizontal scroll position.
   */
  setScrollLeft(left: number): void;

  /**
   * Get total content height (in lines/rows).
   */
  getContentHeight(): number;

  /**
   * Get total content width (in columns).
   */
  getContentWidth(): number;

  /**
   * Scroll by a relative amount.
   */
  scrollBy(deltaX: number, deltaY: number): void;

  /**
   * Ensure a position is visible, scrolling if necessary.
   */
  scrollToPosition?(line: number, column?: number): void;
}

// ==================== Modal Component ====================

/**
 * Component that overlays other content (dialogs, menus, etc.).
 *
 * Modal components capture all input while visible and typically
 * have a backdrop that dims the underlying content.
 */
export interface ModalComponent extends FocusableComponent {
  /**
   * Show the modal component.
   */
  show(): void;

  /**
   * Hide the modal component.
   */
  hide(): void;

  /**
   * Check if clicking outside should close the modal.
   */
  shouldCloseOnBackdropClick?(): boolean;

  /**
   * Register a callback for when the modal is closed.
   * @returns Unsubscribe function
   */
  onClose?(callback: () => void): () => void;
}

// ==================== Type Guards ====================

/**
 * Check if a component is focusable.
 */
export function isFocusable(component: UIComponent): component is FocusableComponent {
  return 'isFocused' in component && 'setFocused' in component;
}

/**
 * Check if a component is a container.
 */
export function isContainer(component: UIComponent): component is ContainerComponent {
  return 'getChildren' in component && 'addChild' in component;
}

/**
 * Check if a component is scrollable.
 */
export function isScrollable(component: UIComponent): component is ScrollableComponent {
  return 'getScrollTop' in component && 'setScrollTop' in component;
}

/**
 * Check if a component is a modal.
 */
export function isModal(component: UIComponent): component is ModalComponent {
  return 'show' in component && 'hide' in component && isFocusable(component);
}

// ==================== Utility Types ====================

/**
 * Event handler that returns an unsubscribe function.
 */
export type EventHandler<T = void> = (data: T) => void;
export type Unsubscribe = () => void;

/**
 * Component lifecycle state.
 */
export type ComponentState = 'created' | 'mounted' | 'visible' | 'hidden' | 'disposed';

/**
 * Component constructor options.
 */
export interface ComponentOptions {
  id?: string;
  visible?: boolean;
  rect?: Rect;
}
