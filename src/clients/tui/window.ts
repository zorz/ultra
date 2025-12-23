/**
 * Window Manager
 *
 * Orchestrates the TUI window: layout, overlays, status bar, input, and rendering.
 */

import type { Rect, Size, InputEvent, KeyEvent, MouseEvent } from './types.ts';
import { isKeyEvent, isMouseEvent, containsPoint } from './types.ts';
import type { ScreenBuffer } from './rendering/buffer.ts';
import { createScreenBuffer } from './rendering/buffer.ts';
import { PaneContainer, createPaneContainer, type PaneContainerCallbacks, type FocusableElementType } from './layout/index.ts';
import { StatusBar, createStatusBar, type StatusBarCallbacks } from './status-bar/index.ts';
import { OverlayManager, createOverlayManager, type OverlayManagerCallbacks, type NotificationType } from './overlays/index.ts';
import { FocusManager, createFocusManager, type FocusChangeCallback } from './input/index.ts';
import type { BaseElement } from './elements/index.ts';
import type { Pane } from './layout/pane.ts';
import { hexToRgb, rgbToHex, darken, lighten } from './ansi/colors.ts';

// ============================================
// Types
// ============================================

/**
 * Theme color provider function.
 */
export type ThemeColorProvider = (key: string, fallback?: string) => string;

/**
 * Window configuration.
 */
export interface WindowConfig {
  /** Initial window size */
  size: Size;
  /** Theme color provider */
  getThemeColor: ThemeColorProvider;
  /** Setting value provider */
  getSetting: <T>(key: string, defaultValue: T) => T;
  /** Called when window needs re-render */
  onDirty?: () => void;
  /** Called when focus changes */
  onFocusChange?: FocusChangeCallback;
  /** Called when an element close is requested via tab X. Return true to proceed, false to cancel. */
  onElementCloseRequest?: (elementId: string, element: BaseElement) => Promise<boolean>;
  /** Whether status bar starts expanded */
  statusBarExpanded?: boolean;
}

/**
 * Keybinding handler.
 */
export interface KeyBinding {
  /** Key combination (e.g., 'ctrl+s', 'alt+p') */
  key: string;
  /** Handler function, return true if consumed */
  handler: () => boolean;
  /** Optional context condition */
  when?: () => boolean;
}

// ============================================
// Window Manager
// ============================================

export class Window {
  /** Screen size */
  private size: Size;

  /** Screen buffer for rendering */
  private buffer: ScreenBuffer;

  /** Pane container for layout */
  private paneContainer: PaneContainer;

  /** Status bar */
  private statusBar: StatusBar;

  /** Overlay manager */
  private overlayManager: OverlayManager;

  /** Focus manager */
  private focusManager: FocusManager;

  /** Theme color provider */
  private getThemeColor: ThemeColorProvider;

  /** Setting value provider */
  private getSetting: <T>(key: string, defaultValue: T) => T;

  /** Dirty callback */
  private onDirtyCallback?: () => void;

  /** Focus change callback */
  private onFocusChangeCallback?: FocusChangeCallback;

  /** Global keybindings */
  private keybindings: KeyBinding[] = [];

  /** Whether window is active */
  private active = false;

  /** Pending chord prefix (first key of a chord sequence) */
  private pendingChord: string | null = null;

  /** Chord timeout handle */
  private chordTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Chord timeout duration (ms) */
  private readonly CHORD_TIMEOUT = 500;

  /** Status bar height (1 collapsed, more when expanded) */
  private statusBarHeight = 1;

  constructor(config: WindowConfig) {
    this.size = { ...config.size };
    this.getThemeColor = config.getThemeColor;
    this.getSetting = config.getSetting;
    this.onDirtyCallback = config.onDirty;
    this.onFocusChangeCallback = config.onFocusChange;

    // Create screen buffer
    this.buffer = createScreenBuffer(this.size);

    // Create focus manager
    this.focusManager = createFocusManager();
    this.focusManager.onFocusChange((prevElem, nextElem, prevPane, nextPane) => {
      this.onFocusChangeCallback?.(prevElem, nextElem, prevPane, nextPane);
      this.markDirty();
    });

    // Create pane container
    const paneContainerCallbacks: PaneContainerCallbacks = {
      onDirty: () => this.markDirty(),
      getThemeColor: this.getThemeColor,
      getSetting: this.getSetting,
      onElementCloseRequest: config.onElementCloseRequest,
      getBackgroundForFocus: (type, focused) => this.getBackgroundForFocus(type, focused),
      getForegroundForFocus: (type, focused) => this.getForegroundForFocus(type, focused),
      getSelectionBackground: (type, focused) => this.getSelectionBackground(type, focused),
    };
    this.paneContainer = createPaneContainer(paneContainerCallbacks);
    this.paneContainer.setFocusManager(this.focusManager);
    this.focusManager.setResolver(this.paneContainer);

    // Create status bar
    const statusBarCallbacks: StatusBarCallbacks = {
      onToggle: () => this.handleStatusBarToggle(),
      getThemeColor: this.getThemeColor,
    };
    this.statusBar = createStatusBar(statusBarCallbacks);
    if (config.statusBarExpanded) {
      this.statusBar.expand();
      this.statusBarHeight = this.statusBar.getExpandedHeight();
    }

    // Create overlay manager
    const overlayCallbacks: OverlayManagerCallbacks = {
      onDirty: () => this.markDirty(),
      getThemeColor: this.getThemeColor,
      getScreenSize: () => this.size,
    };
    this.overlayManager = createOverlayManager(overlayCallbacks);

    // Apply initial layout
    this.updateLayout();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Activate the window.
   */
  start(): void {
    this.active = true;
    this.markDirty();
  }

  /**
   * Deactivate the window.
   */
  stop(): void {
    this.active = false;
  }

  /**
   * Check if window is active.
   */
  isActive(): boolean {
    return this.active;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Size & Layout
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resize the window.
   */
  resize(size: Size): void {
    this.size = { ...size };
    this.buffer = createScreenBuffer(this.size);
    this.updateLayout();
    this.markDirty();
  }

  /**
   * Get the window size.
   */
  getSize(): Size {
    return { ...this.size };
  }

  /**
   * Update layout when size or status bar changes.
   */
  private updateLayout(): void {
    // Calculate available space for pane container
    const paneContainerBounds: Rect = {
      x: 0,
      y: 0,
      width: this.size.width,
      height: this.size.height - this.statusBarHeight,
    };
    this.paneContainer.setBounds(paneContainerBounds);

    // Position status bar at bottom
    const statusBarBounds: Rect = {
      x: 0,
      y: this.size.height - this.statusBarHeight,
      width: this.size.width,
      height: this.statusBarHeight,
    };
    this.statusBar.setBounds(statusBarBounds);
  }

  /**
   * Handle status bar toggle.
   */
  private handleStatusBarToggle(): void {
    this.statusBarHeight = this.statusBar.getCurrentHeight();
    this.updateLayout();
    this.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle an input event.
   * @returns true if the event was handled
   */
  handleInput(event: InputEvent): boolean {
    // 1. Overlays get first shot
    if (this.overlayManager.hasVisibleOverlays()) {
      if (this.overlayManager.handleInput(event)) {
        return true;
      }
      // Escape dismisses overlay
      if (isKeyEvent(event) && event.key === 'Escape') {
        this.overlayManager.dismissTop();
        return true;
      }
    }

    // 2. Global keybindings
    if (isKeyEvent(event)) {
      if (this.handleKeybinding(event)) {
        return true;
      }
    }

    // 3. Status bar click (expanded or collapsed)
    if (isMouseEvent(event)) {
      const statusBounds = this.statusBar.getBounds();
      if (containsPoint(statusBounds, event.x, event.y)) {
        if (event.type === 'press' && event.button === 'left') {
          this.statusBar.toggle();
          return true;
        }
        return false;
      }
    }

    // 4. Focused element gets keyboard input
    if (isKeyEvent(event)) {
      const focused = this.focusManager.getFocusedElement();
      if (focused?.handleKey(event)) {
        return true;
      }
    }

    // 5. Pane container for mouse input - route to pane at click position
    if (isMouseEvent(event)) {
      const paneAtPoint = this.paneContainer.findPaneAtPoint(event.x, event.y);
      if (paneAtPoint) {
        // Focus the pane when clicking anywhere in it (even if empty)
        if (event.type === 'press' && event.button === 'left') {
          this.focusPane(paneAtPoint);
        }

        // First let the pane handle accordion headers
        if (paneAtPoint.handleMouse(event)) {
          return true;
        }
        // Then check elements in the pane (visible ones)
        for (const element of paneAtPoint.getElements()) {
          if (element.isVisible() && element.handleMouse(event)) {
            return true;
          }
        }

        // If the pane was clicked but nothing handled it, still consider it handled
        // (e.g., clicking on empty pane content area)
        if (event.type === 'press' && event.button === 'left') {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check global keybindings.
   * Supports chord sequences (e.g., "ctrl+k ctrl+c").
   */
  private handleKeybinding(event: KeyEvent): boolean {
    const keyStr = this.normalizeKey(event);

    // Check for chord continuation
    if (this.pendingChord) {
      const chordKey = `${this.pendingChord} ${keyStr}`;
      this.clearChord();

      // Look for full chord match
      for (const binding of this.keybindings) {
        const normalizedBinding = this.normalizeBindingKey(binding.key);
        if (normalizedBinding === chordKey) {
          if (binding.when && !binding.when()) {
            continue;
          }
          if (binding.handler()) {
            return true;
          }
        }
      }

      // Chord didn't complete - fall through to check for new chord or direct binding
    }

    // Check if this key could start a chord
    const chordPrefix = keyStr + ' ';
    const hasChordContinuation = this.keybindings.some((b) => {
      const normalized = this.normalizeBindingKey(b.key);
      return normalized.startsWith(chordPrefix);
    });

    // Check for direct binding
    for (const binding of this.keybindings) {
      const normalizedBinding = this.normalizeBindingKey(binding.key);
      if (normalizedBinding === keyStr) {
        if (binding.when && !binding.when()) {
          continue;
        }

        // If this key also starts a chord, wait for chord instead of executing
        if (hasChordContinuation) {
          break;
        }

        if (binding.handler()) {
          return true;
        }
      }
    }

    if (hasChordContinuation) {
      // Start chord timeout
      this.pendingChord = keyStr;

      // Show chord indicator in status bar
      this.showStatusCommand(`${keyStr} ...`);

      this.chordTimeout = setTimeout(() => {
        this.clearChord();
        this.markDirty();
      }, this.CHORD_TIMEOUT);

      return true; // Consume the key to wait for chord
    }

    return false;
  }

  /**
   * Clear any pending chord.
   */
  private clearChord(): void {
    if (this.chordTimeout) {
      clearTimeout(this.chordTimeout);
      this.chordTimeout = null;
    }
    if (this.pendingChord) {
      // Clear the chord indicator from status bar
      this.statusBar.setItemContent('command', '');
    }
    this.pendingChord = null;
  }

  /**
   * Check if a chord is pending.
   */
  isChordPending(): boolean {
    return this.pendingChord !== null;
  }

  /**
   * Get the pending chord prefix.
   */
  getPendingChord(): string | null {
    return this.pendingChord;
  }

  /**
   * Normalize a key event to a string like "ctrl+s".
   */
  private normalizeKey(event: KeyEvent): string {
    const parts: string[] = [];
    if (event.ctrl) parts.push('ctrl');
    if (event.alt) parts.push('alt');
    if (event.shift) parts.push('shift');
    if (event.meta) parts.push('meta');
    parts.push(event.key.toLowerCase());
    return parts.join('+');
  }

  /**
   * Normalize a binding key string to match normalizeKey output.
   * Handles space-separated chord sequences like "ctrl+k ctrl+c".
   */
  private normalizeBindingKey(keyString: string): string {
    // Split by space for chord sequences
    const chordParts = keyString.trim().split(/\s+/);

    // Normalize each part of the chord
    const normalized = chordParts.map((part) => {
      const segments = part.toLowerCase().split('+');
      const modifiers: string[] = [];
      let key = '';

      for (const seg of segments) {
        const trimmed = seg.trim();
        if (['ctrl', 'cmd', 'control'].includes(trimmed)) {
          modifiers.push('ctrl');
        } else if (trimmed === 'shift') {
          modifiers.push('shift');
        } else if (['alt', 'option'].includes(trimmed)) {
          modifiers.push('alt');
        } else if (['meta', 'win', 'super'].includes(trimmed)) {
          modifiers.push('meta');
        } else {
          key = trimmed;
        }
      }

      // Match the order from normalizeKey: ctrl, alt, shift, meta
      const orderedModifiers: string[] = [];
      if (modifiers.includes('ctrl')) orderedModifiers.push('ctrl');
      if (modifiers.includes('alt')) orderedModifiers.push('alt');
      if (modifiers.includes('shift')) orderedModifiers.push('shift');
      if (modifiers.includes('meta')) orderedModifiers.push('meta');
      orderedModifiers.push(key);

      return orderedModifiers.join('+');
    });

    return normalized.join(' ');
  }

  /**
   * Add a global keybinding.
   */
  addKeybinding(binding: KeyBinding): () => void {
    this.keybindings.push(binding);
    return () => {
      const idx = this.keybindings.indexOf(binding);
      if (idx !== -1) {
        this.keybindings.splice(idx, 1);
      }
    };
  }

  /**
   * Remove all keybindings.
   */
  clearKeybindings(): void {
    this.keybindings = [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Focus Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the focus manager.
   */
  getFocusManager(): FocusManager {
    return this.focusManager;
  }

  /**
   * Get the currently focused element.
   */
  getFocusedElement(): BaseElement | null {
    return this.focusManager.getFocusedElement();
  }

  /**
   * Get the currently focused pane.
   */
  getFocusedPane(): Pane | null {
    const paneId = this.focusManager.getFocusedPaneId();
    if (!paneId) return null;
    return this.paneContainer.getPane(paneId);
  }

  /**
   * Focus a specific pane.
   */
  focusPane(pane: Pane): void {
    this.focusManager.focusPane(pane.id);
  }

  /**
   * Focus a specific element.
   */
  focusElement(element: BaseElement): void {
    this.focusManager.focusElement(element.id);
  }

  /**
   * Navigate focus to next pane.
   */
  focusNextPane(): boolean {
    return this.focusManager.focusNextPane();
  }

  /**
   * Navigate focus to previous pane.
   */
  focusPreviousPane(): boolean {
    return this.focusManager.focusPreviousPane();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pane Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the pane container.
   */
  getPaneContainer(): PaneContainer {
    return this.paneContainer;
  }

  /**
   * Get or create the root pane.
   */
  ensureRootPane(): Pane {
    return this.paneContainer.ensureRoot();
  }

  /**
   * Split the focused pane.
   */
  splitPane(direction: 'horizontal' | 'vertical'): Pane | null {
    const focused = this.getFocusedPane();
    if (!focused) {
      // If no pane, create root
      const root = this.ensureRootPane();
      const newId = this.paneContainer.split(direction, root.id);
      return this.paneContainer.getPane(newId);
    }
    const newId = this.paneContainer.split(direction, focused.id);
    return this.paneContainer.getPane(newId);
  }

  /**
   * Close a pane.
   */
  closePane(paneId: string): boolean {
    return this.paneContainer.close(paneId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Status Bar
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the status bar.
   */
  getStatusBar(): StatusBar {
    return this.statusBar;
  }

  /**
   * Update a status bar item.
   */
  setStatusItem(id: string, content: string): boolean {
    return this.statusBar.setItemContent(id, content);
  }

  /**
   * Add a history entry to the status bar.
   */
  addStatusHistory(message: string, type?: 'info' | 'warning' | 'error' | 'success'): void {
    this.statusBar.addHistory(message, type);
  }

  /**
   * Show a command in the status bar briefly.
   */
  showStatusCommand(command: string, duration?: number): void {
    this.statusBar.showCommand(command, duration);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Overlays & Notifications
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the overlay manager.
   */
  getOverlayManager(): OverlayManager {
    return this.overlayManager;
  }

  /**
   * Show a notification.
   */
  showNotification(message: string, type?: NotificationType, duration?: number): string {
    return this.overlayManager.showNotification(message, type, duration);
  }

  /**
   * Remove a notification.
   */
  removeNotification(id: string): boolean {
    return this.overlayManager.removeNotification(id);
  }

  /**
   * Check if any overlays are visible.
   */
  hasOverlay(): boolean {
    return this.overlayManager.hasVisibleOverlays();
  }

  /**
   * Dismiss all overlays.
   */
  dismissOverlays(): void {
    this.overlayManager.dismissAll();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Mark the window as needing re-render.
   */
  markDirty(): void {
    this.onDirtyCallback?.();
  }

  /**
   * Render the window to the buffer.
   */
  render(): ScreenBuffer {
    // Clear buffer
    const bg = this.getThemeColor('editor.background', '#1e1e1e');
    this.buffer.clear(bg, '#cccccc');

    // Render pane container
    this.paneContainer.render(this.buffer);

    // Render status bar
    this.statusBar.render(this.buffer);

    // Render overlays (on top of everything)
    this.overlayManager.render(this.buffer);

    return this.buffer;
  }

  /**
   * Get the current buffer.
   */
  getBuffer(): ScreenBuffer {
    return this.buffer;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Focus Colors
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get base colors for an element type.
   */
  private getBaseColors(elementType: FocusableElementType): { background: string; foreground: string } {
    switch (elementType) {
      case 'editor':
        return {
          background: this.getThemeColor('editor.background', '#1e1e1e'),
          foreground: this.getThemeColor('editor.foreground', '#d4d4d4'),
        };
      case 'sidebar':
        return {
          background: this.getThemeColor('sideBar.background', '#252526'),
          foreground: this.getThemeColor('sideBar.foreground', '#cccccc'),
        };
      case 'panel':
        return {
          background: this.getThemeColor('panel.background', '#1e1e1e'),
          foreground: this.getThemeColor('panel.foreground', '#cccccc'),
        };
      case 'terminal':
        return {
          background: this.getThemeColor('terminal.background', '#1e1e1e'),
          foreground: this.getThemeColor('terminal.foreground', '#cccccc'),
        };
    }
  }

  /**
   * Get background color for focus state.
   * Focused elements are slightly darker to indicate focus.
   */
  private getBackgroundForFocus(elementType: FocusableElementType, isFocused: boolean): string {
    const base = this.getBaseColors(elementType);
    if (isFocused) {
      const rgb = hexToRgb(base.background);
      if (!rgb) return base.background;
      return rgbToHex(darken(rgb, 0.08));
    }
    return base.background;
  }

  /**
   * Get foreground color for focus state.
   * Unfocused elements have slightly dimmed text.
   */
  private getForegroundForFocus(elementType: FocusableElementType, isFocused: boolean): string {
    const base = this.getBaseColors(elementType);
    if (!isFocused) {
      const rgb = hexToRgb(base.foreground);
      if (!rgb) return base.foreground;
      return rgbToHex(darken(rgb, 0.25));
    }
    return base.foreground;
  }

  /**
   * Get selection background for focus state.
   * Uses appropriate theme color based on element type.
   */
  private getSelectionBackground(elementType: FocusableElementType, isFocused: boolean): string {
    if (isFocused) {
      // Editor uses editor.selectionBackground, others use list.activeSelectionBackground
      if (elementType === 'editor') {
        return this.getThemeColor('editor.selectionBackground', '#264f78');
      }
      return this.getThemeColor('list.activeSelectionBackground', '#094771');
    }
    // Unfocused: slightly lighter than background
    const base = this.getBaseColors(elementType);
    const rgb = hexToRgb(base.background);
    if (!rgb) return base.background;
    return rgbToHex(lighten(rgb, 0.15));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Serialize window state for persistence.
   */
  serialize(): WindowState {
    return {
      size: { ...this.size },
      layout: this.paneContainer.serialize(),
      focusedPaneId: this.getFocusedPane()?.id ?? null,
      statusBarExpanded: this.statusBar.isExpanded(),
    };
  }

  /**
   * Deserialize window state.
   */
  deserialize(state: WindowState): void {
    // Restore layout
    if (state.layout) {
      this.paneContainer.deserialize(state.layout);
    }

    // Restore focus
    if (state.focusedPaneId) {
      const pane = this.paneContainer.getPane(state.focusedPaneId);
      if (pane) {
        this.focusManager.focusPane(pane.id);
      }
    }

    // Restore status bar
    if (state.statusBarExpanded) {
      this.statusBar.expand();
      this.statusBarHeight = this.statusBar.getExpandedHeight();
      this.updateLayout();
    }
  }
}

/**
 * Serialized window state.
 */
export interface WindowState {
  size: Size;
  layout: ReturnType<PaneContainer['serialize']>;
  focusedPaneId: string | null;
  statusBarExpanded: boolean;
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new window.
 */
export function createWindow(config: WindowConfig): Window {
  return new Window(config);
}
