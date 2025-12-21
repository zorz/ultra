/**
 * Focus Manager
 *
 * Manages focus state for TUI elements and panes.
 * Handles focus navigation and pane navigation mode.
 */

import type { KeyEvent, MouseEvent, InputEvent } from '../types.ts';
import type { BaseElement } from '../elements/base.ts';

// ============================================
// Types
// ============================================

/**
 * Callback for focus change events.
 */
export type FocusChangeCallback = (
  prevElementId: string | null,
  nextElementId: string | null,
  prevPaneId: string | null,
  nextPaneId: string | null
) => void;

/**
 * Interface for focus target resolution.
 * Implemented by pane containers to find elements.
 */
export interface FocusResolver {
  /** Get all pane IDs */
  getPaneIds(): string[];
  /** Get element by ID */
  getElement(elementId: string): BaseElement | null;
  /** Find pane containing an element */
  findPaneForElement(elementId: string): string | null;
  /** Get active element in a pane */
  getActiveElementInPane(paneId: string): BaseElement | null;
  /** Get all elements in a pane */
  getElementsInPane(paneId: string): BaseElement[];
}

// ============================================
// Focus Manager
// ============================================

export class FocusManager {
  /** Current resolver for finding elements */
  private resolver: FocusResolver | null = null;

  /** Currently focused pane ID */
  private focusedPaneId: string = '';

  /** Currently focused element ID */
  private focusedElementId: string = '';

  /** Whether in pane navigation mode (Ctrl+G mode) */
  private navigationMode = false;

  /** Focus change listeners */
  private listeners: Set<FocusChangeCallback> = new Set();

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the focus resolver for element lookup.
   */
  setResolver(resolver: FocusResolver): void {
    this.resolver = resolver;
  }

  /**
   * Clear the resolver.
   */
  clearResolver(): void {
    this.resolver = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Focus Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Focus a pane by ID.
   * Focuses the active element within the pane.
   */
  focusPane(paneId: string): boolean {
    if (!this.resolver) return false;

    const prevPaneId = this.focusedPaneId;
    const prevElementId = this.focusedElementId;

    // Get active element in the target pane
    const activeElement = this.resolver.getActiveElementInPane(paneId);
    if (!activeElement) {
      // No elements in pane, but still switch pane focus
      if (paneId !== this.focusedPaneId) {
        this.blurCurrent();
        this.focusedPaneId = paneId;
        this.focusedElementId = '';
        this.notifyListeners(prevElementId, null, prevPaneId, paneId);
      }
      return true;
    }

    // Blur current element
    this.blurCurrent();

    // Update focus state
    this.focusedPaneId = paneId;
    this.focusedElementId = activeElement.id;

    // Focus new element
    activeElement.onFocus();

    this.notifyListeners(prevElementId, activeElement.id, prevPaneId, paneId);
    return true;
  }

  /**
   * Focus an element by ID.
   * Automatically updates pane focus.
   */
  focusElement(elementId: string): boolean {
    if (!this.resolver) return false;

    // Find pane containing element
    const paneId = this.resolver.findPaneForElement(elementId);
    if (!paneId) return false;

    const element = this.resolver.getElement(elementId);
    if (!element) return false;

    const prevPaneId = this.focusedPaneId;
    const prevElementId = this.focusedElementId;

    // Already focused
    if (elementId === this.focusedElementId) {
      return true;
    }

    // Blur current
    this.blurCurrent();

    // Update focus state
    this.focusedPaneId = paneId;
    this.focusedElementId = elementId;

    // Focus new element
    element.onFocus();

    this.notifyListeners(prevElementId, elementId, prevPaneId, paneId);
    return true;
  }

  /**
   * Set focus state directly without triggering lifecycle.
   * Used for restoring session state.
   */
  setFocus(paneId: string, elementId: string): void {
    const prevPaneId = this.focusedPaneId;
    const prevElementId = this.focusedElementId;

    this.focusedPaneId = paneId;
    this.focusedElementId = elementId;

    if (prevPaneId !== paneId || prevElementId !== elementId) {
      this.notifyListeners(prevElementId, elementId, prevPaneId, paneId);
    }
  }

  /**
   * Clear all focus.
   */
  clearFocus(): void {
    const prevPaneId = this.focusedPaneId;
    const prevElementId = this.focusedElementId;

    this.blurCurrent();

    this.focusedPaneId = '';
    this.focusedElementId = '';

    if (prevPaneId || prevElementId) {
      this.notifyListeners(prevElementId, null, prevPaneId, null);
    }
  }

  /**
   * Blur the currently focused element.
   */
  private blurCurrent(): void {
    if (this.focusedElementId && this.resolver) {
      const current = this.resolver.getElement(this.focusedElementId);
      current?.onBlur();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Focus Queries
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the currently focused pane ID.
   */
  getFocusedPaneId(): string {
    return this.focusedPaneId;
  }

  /**
   * Get the currently focused element ID.
   */
  getFocusedElementId(): string {
    return this.focusedElementId;
  }

  /**
   * Get the currently focused element.
   */
  getFocusedElement(): BaseElement | null {
    if (!this.resolver || !this.focusedElementId) {
      return null;
    }
    return this.resolver.getElement(this.focusedElementId);
  }

  /**
   * Check if any element is focused.
   */
  hasFocus(): boolean {
    return this.focusedElementId !== '';
  }

  /**
   * Check if a specific element is focused.
   */
  isElementFocused(elementId: string): boolean {
    return this.focusedElementId === elementId;
  }

  /**
   * Check if a specific pane is focused.
   */
  isPaneFocused(paneId: string): boolean {
    return this.focusedPaneId === paneId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation Mode
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if in pane navigation mode.
   */
  isInNavigationMode(): boolean {
    return this.navigationMode;
  }

  /**
   * Enter pane navigation mode.
   */
  enterNavigationMode(): void {
    this.navigationMode = true;
  }

  /**
   * Exit pane navigation mode.
   */
  exitNavigationMode(): void {
    this.navigationMode = false;
  }

  /**
   * Toggle pane navigation mode.
   */
  toggleNavigationMode(): void {
    this.navigationMode = !this.navigationMode;
  }

  /**
   * Handle input while in navigation mode.
   * @returns true if handled
   */
  handleNavigationInput(event: InputEvent): boolean {
    if (!this.navigationMode) return false;
    if (!('key' in event)) return false;
    if (!this.resolver) return false;

    const paneIds = this.resolver.getPaneIds();
    const currentIndex = paneIds.indexOf(this.focusedPaneId);

    switch (event.key) {
      case 'Escape':
        this.exitNavigationMode();
        return true;

      case 'Enter':
      case ' ':
        // Confirm selection and exit navigation mode
        this.exitNavigationMode();
        return true;

      case 'ArrowLeft':
      case 'h':
        // Focus previous pane
        if (currentIndex > 0) {
          this.focusPane(paneIds[currentIndex - 1]!);
        } else if (paneIds.length > 0) {
          // Wrap to last
          this.focusPane(paneIds[paneIds.length - 1]!);
        }
        return true;

      case 'ArrowRight':
      case 'l':
        // Focus next pane
        if (currentIndex < paneIds.length - 1) {
          this.focusPane(paneIds[currentIndex + 1]!);
        } else if (paneIds.length > 0) {
          // Wrap to first
          this.focusPane(paneIds[0]!);
        }
        return true;

      case 'ArrowUp':
      case 'k':
        // Focus previous pane (same as left for now)
        if (currentIndex > 0) {
          this.focusPane(paneIds[currentIndex - 1]!);
        } else if (paneIds.length > 0) {
          this.focusPane(paneIds[paneIds.length - 1]!);
        }
        return true;

      case 'ArrowDown':
      case 'j':
        // Focus next pane (same as right for now)
        if (currentIndex < paneIds.length - 1) {
          this.focusPane(paneIds[currentIndex + 1]!);
        } else if (paneIds.length > 0) {
          this.focusPane(paneIds[0]!);
        }
        return true;

      default:
        // Check for number shortcuts (1-9 for direct pane access)
        if (/^[1-9]$/.test(event.key)) {
          const index = parseInt(event.key, 10) - 1;
          if (index < paneIds.length) {
            this.focusPane(paneIds[index]!);
            this.exitNavigationMode();
          }
          return true;
        }
        return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Focus Navigation (non-navigation mode)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Focus next element in the current pane.
   */
  focusNextElement(): boolean {
    if (!this.resolver || !this.focusedPaneId) return false;

    const elements = this.resolver.getElementsInPane(this.focusedPaneId);
    if (elements.length === 0) return false;

    const currentIndex = elements.findIndex((e) => e.id === this.focusedElementId);
    const nextIndex = (currentIndex + 1) % elements.length;

    return this.focusElement(elements[nextIndex]!.id);
  }

  /**
   * Focus previous element in the current pane.
   */
  focusPreviousElement(): boolean {
    if (!this.resolver || !this.focusedPaneId) return false;

    const elements = this.resolver.getElementsInPane(this.focusedPaneId);
    if (elements.length === 0) return false;

    const currentIndex = elements.findIndex((e) => e.id === this.focusedElementId);
    const prevIndex = currentIndex <= 0 ? elements.length - 1 : currentIndex - 1;

    return this.focusElement(elements[prevIndex]!.id);
  }

  /**
   * Focus next pane.
   */
  focusNextPane(): boolean {
    if (!this.resolver) return false;

    const paneIds = this.resolver.getPaneIds();
    if (paneIds.length === 0) return false;

    const currentIndex = paneIds.indexOf(this.focusedPaneId);
    const nextIndex = (currentIndex + 1) % paneIds.length;

    return this.focusPane(paneIds[nextIndex]!);
  }

  /**
   * Focus previous pane.
   */
  focusPreviousPane(): boolean {
    if (!this.resolver) return false;

    const paneIds = this.resolver.getPaneIds();
    if (paneIds.length === 0) return false;

    const currentIndex = paneIds.indexOf(this.focusedPaneId);
    const prevIndex = currentIndex <= 0 ? paneIds.length - 1 : currentIndex - 1;

    return this.focusPane(paneIds[prevIndex]!);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Listeners
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a focus change listener.
   * @returns Unsubscribe function
   */
  onFocusChange(callback: FocusChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners of a focus change.
   */
  private notifyListeners(
    prevElementId: string | null,
    nextElementId: string | null,
    prevPaneId: string | null,
    nextPaneId: string | null
  ): void {
    for (const listener of this.listeners) {
      listener(prevElementId, nextElementId, prevPaneId, nextPaneId);
    }
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new focus manager.
 */
export function createFocusManager(): FocusManager {
  return new FocusManager();
}
