/**
 * Render Scheduler
 *
 * Priority-based render scheduling for the Ultra editor.
 * Batches render operations and processes them in priority order
 * to ensure responsive UI while minimizing unnecessary re-renders.
 *
 * Priorities:
 * - immediate: Processed synchronously (cursor updates, key feedback)
 * - high: Processed first in next frame (selection changes, scroll)
 * - normal: Standard rendering (content updates)
 * - low: Background rendering (minimap, git indicators)
 *
 * @example
 * // Schedule a high-priority render for cursor updates
 * renderScheduler.schedule(() => {
 *   pane.renderCursor(ctx);
 * }, 'high');
 *
 * // Schedule low-priority minimap update
 * renderScheduler.schedule(() => {
 *   minimap.render(ctx);
 * }, 'low');
 */

/**
 * Render priority levels
 */
export type RenderPriority = 'immediate' | 'high' | 'normal' | 'low';

/**
 * Render callback with optional ID for deduplication
 */
export interface RenderTask {
  /** Callback to execute */
  callback: () => void;
  /** Priority level */
  priority: RenderPriority;
  /** Optional ID for deduplication (only latest with same ID runs) */
  id?: string;
  /** Timestamp when scheduled */
  scheduledAt: number;
}

/**
 * Priority order for processing
 */
const PRIORITY_ORDER: RenderPriority[] = ['immediate', 'high', 'normal', 'low'];

/**
 * Render statistics
 */
export interface RenderStats {
  /** Total renders executed */
  totalRenders: number;
  /** Renders by priority */
  byPriority: Record<RenderPriority, number>;
  /** Renders deduplicated (skipped due to same ID) */
  deduplicated: number;
  /** Average batch size */
  avgBatchSize: number;
  /** Current pending tasks */
  pending: number;
}

/**
 * Priority-based render scheduler
 */
export class RenderScheduler {
  private pending = new Map<RenderPriority, Map<string, RenderTask>>();
  private scheduled = false;
  private frameId: ReturnType<typeof setImmediate> | null = null;

  // Statistics
  private totalRenders = 0;
  private rendersByPriority: Record<RenderPriority, number> = {
    immediate: 0,
    high: 0,
    normal: 0,
    low: 0,
  };
  private deduplicatedCount = 0;
  private batchSizes: number[] = [];

  constructor() {
    // Initialize priority queues
    for (const priority of PRIORITY_ORDER) {
      this.pending.set(priority, new Map());
    }
  }

  /**
   * Schedule a render task
   *
   * @param callback - Function to execute
   * @param priority - Priority level (default: 'normal')
   * @param id - Optional ID for deduplication
   */
  schedule(
    callback: () => void,
    priority: RenderPriority = 'normal',
    id?: string
  ): void {
    const queue = this.pending.get(priority)!;
    const taskId = id ?? `task-${Date.now()}-${Math.random()}`;

    // Check for deduplication
    if (id && queue.has(id)) {
      this.deduplicatedCount++;
    }

    const task: RenderTask = {
      callback,
      priority,
      id,
      scheduledAt: Date.now(),
    };

    queue.set(taskId, task);

    // Handle immediate priority synchronously
    if (priority === 'immediate') {
      this.flushImmediate();
      return;
    }

    // Schedule flush if not already scheduled
    if (!this.scheduled) {
      this.scheduled = true;
      this.frameId = setImmediate(() => this.flush());
    }
  }

  /**
   * Schedule multiple tasks at once
   *
   * @param tasks - Array of tasks to schedule
   */
  scheduleBatch(
    tasks: Array<{
      callback: () => void;
      priority?: RenderPriority;
      id?: string;
    }>
  ): void {
    for (const task of tasks) {
      this.schedule(task.callback, task.priority, task.id);
    }
  }

  /**
   * Cancel a scheduled task by ID
   *
   * @param id - Task ID to cancel
   * @returns true if task was cancelled
   */
  cancel(id: string): boolean {
    for (const queue of this.pending.values()) {
      if (queue.delete(id)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Cancel all pending tasks
   */
  cancelAll(): void {
    for (const queue of this.pending.values()) {
      queue.clear();
    }
    if (this.frameId) {
      clearImmediate(this.frameId);
      this.frameId = null;
    }
    this.scheduled = false;
  }

  /**
   * Flush immediate priority tasks synchronously
   */
  private flushImmediate(): void {
    const immediateQueue = this.pending.get('immediate')!;
    if (immediateQueue.size === 0) return;

    for (const task of immediateQueue.values()) {
      try {
        task.callback();
        this.totalRenders++;
        this.rendersByPriority.immediate++;
      } catch (error) {
        console.error('[RenderScheduler] Immediate task error:', error);
      }
    }

    immediateQueue.clear();
  }

  /**
   * Flush all pending tasks in priority order
   */
  private flush(): void {
    this.scheduled = false;
    this.frameId = null;

    let batchSize = 0;

    // Process in priority order
    for (const priority of PRIORITY_ORDER) {
      const queue = this.pending.get(priority)!;
      if (queue.size === 0) continue;

      batchSize += queue.size;

      for (const task of queue.values()) {
        try {
          task.callback();
          this.totalRenders++;
          this.rendersByPriority[priority]++;
        } catch (error) {
          console.error(`[RenderScheduler] ${priority} task error:`, error);
        }
      }

      queue.clear();
    }

    // Track batch size for statistics
    if (batchSize > 0) {
      this.batchSizes.push(batchSize);
      // Keep last 100 batch sizes
      if (this.batchSizes.length > 100) {
        this.batchSizes.shift();
      }
    }
  }

  /**
   * Force flush all pending tasks immediately
   */
  forceFlush(): void {
    if (this.frameId) {
      clearImmediate(this.frameId);
      this.frameId = null;
    }
    this.flush();
  }

  /**
   * Check if there are pending tasks
   */
  hasPending(): boolean {
    for (const queue of this.pending.values()) {
      if (queue.size > 0) return true;
    }
    return false;
  }

  /**
   * Get count of pending tasks by priority
   */
  getPendingCount(): Record<RenderPriority, number> {
    const counts: Record<RenderPriority, number> = {
      immediate: 0,
      high: 0,
      normal: 0,
      low: 0,
    };

    for (const priority of PRIORITY_ORDER) {
      counts[priority] = this.pending.get(priority)!.size;
    }

    return counts;
  }

  /**
   * Get render statistics
   */
  getStats(): RenderStats {
    let totalPending = 0;
    for (const queue of this.pending.values()) {
      totalPending += queue.size;
    }

    const avgBatchSize = this.batchSizes.length > 0
      ? this.batchSizes.reduce((a, b) => a + b, 0) / this.batchSizes.length
      : 0;

    return {
      totalRenders: this.totalRenders,
      byPriority: { ...this.rendersByPriority },
      deduplicated: this.deduplicatedCount,
      avgBatchSize,
      pending: totalPending,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalRenders = 0;
    this.rendersByPriority = {
      immediate: 0,
      high: 0,
      normal: 0,
      low: 0,
    };
    this.deduplicatedCount = 0;
    this.batchSizes = [];
  }
}

/**
 * Common render task IDs for deduplication
 */
export const RenderTaskIds = {
  /** Main editor content */
  EDITOR_CONTENT: 'render:editor:content',
  /** Cursor rendering */
  CURSOR: 'render:cursor',
  /** Selection highlighting */
  SELECTION: 'render:selection',
  /** Line numbers gutter */
  GUTTER: 'render:gutter',
  /** Minimap */
  MINIMAP: 'render:minimap',
  /** Tab bar */
  TAB_BAR: 'render:tabbar',
  /** Status bar */
  STATUS_BAR: 'render:statusbar',
  /** File tree */
  FILE_TREE: 'render:filetree',
  /** Git panel */
  GIT_PANEL: 'render:gitpanel',
  /** Terminal */
  TERMINAL: 'render:terminal',
  /** Full screen refresh */
  FULL_SCREEN: 'render:fullscreen',
} as const;

/**
 * Singleton render scheduler instance
 */
export const renderScheduler = new RenderScheduler();

export default renderScheduler;
