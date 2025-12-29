/**
 * Typed Event Emitter
 *
 * A generic, type-safe event emitter that provides a foundation for
 * event-based communication between components.
 *
 * Features:
 * - Full TypeScript type inference for event names and payloads
 * - Automatic cleanup via unsubscribe functions
 * - Support for one-time listeners
 * - Error isolation (one failing handler doesn't affect others)
 *
 * @example
 * // Define events with their payload types
 * interface EditorEvents {
 *   'change': { content: string };
 *   'save': { path: string };
 *   'close': void;
 * }
 *
 * class Editor extends EventEmitter<EditorEvents> {
 *   save(path: string) {
 *     // ... save logic
 *     this.emit('save', { path });
 *   }
 * }
 *
 * const editor = new Editor();
 * const unsubscribe = editor.on('save', ({ path }) => {
 *   console.log(`Saved to ${path}`);
 * });
 *
 * // Later: clean up
 * unsubscribe();
 */

import { debugLog } from '../debug.ts';

/**
 * Callback function type for event handlers
 */
export type EventCallback<T> = (data: T) => void;

/**
 * Unsubscribe function returned by event registration methods
 */
export type Unsubscribe = () => void;

/**
 * Generic typed event emitter base class.
 *
 * @template Events - Record type mapping event names to payload types
 *
 * @example
 * interface MyEvents {
 *   'click': { x: number; y: number };
 *   'keypress': { key: string; ctrl: boolean };
 *   'close': void;
 * }
 *
 * class MyComponent extends EventEmitter<MyEvents> {
 *   handleClick(x: number, y: number) {
 *     this.emit('click', { x, y });
 *   }
 * }
 */
export class EventEmitter<Events extends Record<string, unknown>> {
  /**
   * Map of event names to sets of callbacks
   */
  private listeners = new Map<keyof Events, Set<EventCallback<unknown>>>();

  /**
   * Subscribe to an event.
   *
   * @param event - Name of the event to subscribe to
   * @param callback - Function to call when the event is emitted
   * @returns Unsubscribe function to remove the listener
   *
   * @example
   * const unsubscribe = emitter.on('change', (data) => {
   *   console.log('Changed:', data);
   * });
   *
   * // Later: remove listener
   * unsubscribe();
   */
  on<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const callbacks = this.listeners.get(event)!;
    callbacks.add(callback as EventCallback<unknown>);

    // Return unsubscribe function
    return () => {
      callbacks.delete(callback as EventCallback<unknown>);
      // Clean up empty sets
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Subscribe to an event for one emission only.
   *
   * The callback will be automatically removed after the first time
   * the event is emitted.
   *
   * @param event - Name of the event to subscribe to
   * @param callback - Function to call when the event is emitted
   * @returns Unsubscribe function to remove the listener before it fires
   *
   * @example
   * emitter.once('ready', () => {
   *   console.log('Component is ready!');
   * });
   */
  once<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): Unsubscribe {
    const unsubscribe = this.on(event, (data) => {
      unsubscribe();
      callback(data);
    });
    return unsubscribe;
  }

  /**
   * Emit an event to all subscribed listeners.
   *
   * Listeners are called synchronously in the order they were registered.
   * Errors in individual listeners are caught and logged, allowing other
   * listeners to still be called.
   *
   * @param event - Name of the event to emit
   * @param data - Data to pass to event handlers
   *
   * @example
   * // For events with data
   * this.emit('change', { content: 'new content' });
   *
   * // For events without data (void type)
   * this.emit('close', undefined);
   */
  protected emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks || callbacks.size === 0) return;

    for (const callback of callbacks) {
      try {
        callback(data);
      } catch (error) {
        // Log error but don't let it break other listeners
        debugLog(`[EventEmitter] Error in event handler for "${String(event)}": ${error}`);
      }
    }
  }

  /**
   * Remove all listeners for a specific event.
   *
   * @param event - Name of the event to clear listeners for
   *
   * @example
   * emitter.off('change');
   */
  off<K extends keyof Events>(event: K): void {
    this.listeners.delete(event);
  }

  /**
   * Remove all listeners for all events.
   *
   * Useful for cleanup when the emitter is being destroyed.
   *
   * @example
   * // In dispose/cleanup method
   * this.removeAllListeners();
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * Get the count of listeners for a specific event.
   *
   * @param event - Name of the event to count listeners for
   * @returns Number of registered listeners
   */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Check if there are any listeners for a specific event.
   *
   * @param event - Name of the event to check
   * @returns true if there are listeners, false otherwise
   */
  hasListeners<K extends keyof Events>(event: K): boolean {
    return this.listenerCount(event) > 0;
  }

  /**
   * Get all event names that have listeners.
   *
   * @returns Array of event names with active listeners
   */
  eventNames(): (keyof Events)[] {
    return Array.from(this.listeners.keys());
  }
}

/**
 * Mixin to add EventEmitter functionality to an existing class.
 *
 * Use this when you can't extend EventEmitter directly due to
 * existing inheritance.
 *
 * @example
 * interface MyEvents {
 *   'change': string;
 * }
 *
 * class MyClass extends SomeBase {
 *   private events = new EventEmitterMixin<MyEvents>();
 *
 *   onChange(callback: EventCallback<string>): Unsubscribe {
 *     return this.events.on('change', callback);
 *   }
 *
 *   protected notifyChange(value: string): void {
 *     this.events.emit('change', value);
 *   }
 * }
 */
export class EventEmitterMixin<Events extends Record<string, unknown>> extends EventEmitter<Events> {
  /**
   * Expose emit as public for mixin usage
   */
  public override emit<K extends keyof Events>(event: K, data: Events[K]): void {
    super.emit(event, data);
  }
}

export default EventEmitter;
