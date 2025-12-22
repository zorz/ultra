/**
 * Mouse Event Handling
 * 
 * Provides mouse event processing, delegation, and click detection
 * (single, double, triple clicks).
 */

import type { Position } from '../core/buffer.ts';

export interface MouseEvent {
  name: string;
  x: number;  // 1-indexed
  y: number;  // 1-indexed
  shift: boolean;
  ctrl: boolean;
  meta: boolean;  // Cmd on macOS
  alt: boolean;
}

export interface MouseHandler {
  containsPoint(x: number, y: number): boolean;
  onMouseEvent(event: MouseEvent): boolean;  // return true if handled
}

export interface DragState {
  type: 'none' | 'selecting' | 'resizing' | 'reordering-tab';
  startX?: number;
  startY?: number;
  startPosition?: Position;
  data?: any;
}

export class MouseManager {
  private handlers: MouseHandler[] = [];
  private clickState = {
    lastClickTime: 0,
    lastClickX: 0,
    lastClickY: 0,
    clickCount: 0
  };
  private dragState: DragState = { type: 'none' };
  private clickTimeout = 300;  // ms for double/triple click detection
  private clickDistanceThreshold = 3;  // pixels

  private eventListeners: Map<string, Set<(event: MouseEvent, clickCount: number) => void>> = new Map();

  /**
   * Register a mouse handler
   */
  registerHandler(handler: MouseHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Unregister a mouse handler
   */
  unregisterHandler(handler: MouseHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index >= 0) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * Add event listener for specific event types
   */
  on(eventName: string, callback: (event: MouseEvent, clickCount: number) => void): () => void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    this.eventListeners.get(eventName)!.add(callback);
    
    return () => {
      this.eventListeners.get(eventName)?.delete(callback);
    };
  }

  /**
   * Process a raw mouse event from terminal-kit
   */
  processEvent(name: string, data: { x: number; y: number; shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean }): void {
    let eventName = name;
    let clickCount = 1;

    // Handle click counting for left button
    if (name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      clickCount = this.updateClickCount({
        name,
        x: data.x,
        y: data.y,
        shift: data.shift || false,
        ctrl: data.ctrl || false,
        meta: data.meta || false,
        alt: data.alt || false
      });
      
      // Change event name based on click count
      if (clickCount === 2) {
        eventName = 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE';
      } else if (clickCount === 3) {
        eventName = 'MOUSE_LEFT_BUTTON_PRESSED_TRIPLE';
      }
    }

    const event: MouseEvent = {
      name: eventName,
      x: data.x,
      y: data.y,
      shift: data.shift || false,
      ctrl: data.ctrl || false,
      meta: data.meta || false,
      alt: data.alt || false
    };

    // Handle drag state
    if (name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      this.dragState = {
        type: 'selecting',
        startX: event.x,
        startY: event.y
      };
    } else if (name === 'MOUSE_LEFT_BUTTON_RELEASED') {
      this.dragState = { type: 'none' };
    }

    // Emit to event listeners
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      for (const listener of listeners) {
        listener(event, clickCount);
      }
    }

    // Also emit generic events
    const genericListeners = this.eventListeners.get('*');
    if (genericListeners) {
      for (const listener of genericListeners) {
        listener(event, clickCount);
      }
    }

    // Delegate to handlers (in reverse order, front-to-back)
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      const handler = this.handlers[i]!;
      if (handler.containsPoint(event.x, event.y)) {
        if (handler.onMouseEvent(event)) {
          return;  // Event was handled
        }
      }
    }
  }

  /**
   * Get current drag state
   */
  getDragState(): DragState {
    return this.dragState;
  }

  /**
   * Set drag state (for components to update)
   */
  setDragState(state: DragState): void {
    this.dragState = state;
  }

  /**
   * Check if currently dragging
   */
  isDragging(): boolean {
    return this.dragState.type !== 'none';
  }

  /**
   * Update click count for double/triple click detection
   */
  private updateClickCount(event: MouseEvent): number {
    const now = Date.now();
    const timeDiff = now - this.clickState.lastClickTime;
    const distX = Math.abs(event.x - this.clickState.lastClickX);
    const distY = Math.abs(event.y - this.clickState.lastClickY);

    if (timeDiff < this.clickTimeout && distX <= this.clickDistanceThreshold && distY <= this.clickDistanceThreshold) {
      this.clickState.clickCount = (this.clickState.clickCount % 3) + 1;
    } else {
      this.clickState.clickCount = 1;
    }

    this.clickState.lastClickTime = now;
    this.clickState.lastClickX = event.x;
    this.clickState.lastClickY = event.y;

    return this.clickState.clickCount;
  }

  /**
   * Reset click state
   */
  resetClickState(): void {
    this.clickState.clickCount = 0;
    this.clickState.lastClickTime = 0;
  }
}

// Singleton instance
export const mouseManager = new MouseManager();

export default mouseManager;
