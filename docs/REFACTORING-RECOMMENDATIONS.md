# Ultra Editor - Refactoring & Optimization Recommendations

This document outlines recommendations for improving code consistency, stability, and performance in the Ultra terminal code editor. These recommendations are organized by priority and grouped by architectural concern.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [High Priority: Architectural Improvements](#high-priority-architectural-improvements)
3. [Medium Priority: API Consistency](#medium-priority-api-consistency)
4. [Medium Priority: Component Decomposition](#medium-priority-component-decomposition)
5. [Standard Priority: Performance Optimizations](#standard-priority-performance-optimizations)
6. [Standard Priority: Error Handling](#standard-priority-error-handling)
7. [Code Quality Improvements](#code-quality-improvements)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

Ultra has a solid architectural foundation with well-established patterns for dialog components (BaseDialog → SearchableDialog hierarchy), singleton managers, and callback-based event handling. However, there are opportunities to improve consistency, reduce code duplication, and enhance maintainability.

### Key Strengths to Preserve
- ✅ Piece table buffer for O(log n) text operations
- ✅ BaseDialog → SearchableDialog inheritance pattern
- ✅ Singleton managers with clean initialization
- ✅ Callback pattern with cleanup function returns
- ✅ VS Code-compatible configuration format
- ✅ Batched rendering to prevent flickering

### Key Areas for Improvement
- 🔧 Component decomposition (Pane class is 2000+ lines)
- 🔧 Consistent callback/event naming conventions
- 🔧 Shared utility extraction (hexToRgb duplicated 4x)
- 🔧 Standardized error handling patterns
- 🔧 Interface-driven component design
- 🔧 State management clarity

---

## High Priority: Architectural Improvements

### 1. Extract Common Component Interface

**Problem**: UI components implement `MouseHandler` but lack a unified component interface for lifecycle, rendering, and state management.

**Recommendation**: Create a base `UIComponent` interface that all renderable components implement.

```typescript
// src/ui/components/component.interface.ts

/**
 * Base interface for all UI components
 */
export interface UIComponent {
  /** Unique component identifier */
  readonly id: string;

  /** Check if component is currently visible/active */
  isVisible(): boolean;

  /** Get component bounds */
  getRect(): Rect;

  /** Set component bounds */
  setRect(rect: Rect): void;

  /** Render the component */
  render(ctx: RenderContext): void;

  /** Handle keyboard input, returns true if handled */
  handleKey?(event: KeyEvent): boolean;

  /** Clean up resources */
  dispose?(): void;
}

/**
 * Component that can handle focus
 */
export interface FocusableComponent extends UIComponent {
  /** Check if component has focus */
  isFocused(): boolean;

  /** Set focus state */
  setFocused(focused: boolean): void;

  /** Focus gained callback */
  onFocus?(callback: () => void): () => void;

  /** Focus lost callback */
  onBlur?(callback: () => void): () => void;
}

/**
 * Component that manages child components
 */
export interface ContainerComponent extends UIComponent {
  /** Get child components */
  getChildren(): UIComponent[];

  /** Add child component */
  addChild(component: UIComponent): void;

  /** Remove child component */
  removeChild(component: UIComponent): void;
}
```

**Benefits**:
- Enables consistent component lifecycle management
- Supports future component tree traversal
- Makes testing easier with clear contracts

### 2. Centralize Color/Theme Utilities

**Problem**: `hexToRgb()` is duplicated in:
- `src/ui/components/pane.ts` (lines 2004-2012)
- `src/ui/components/pane-manager.ts` (lines 844-851)
- Multiple other components

**Recommendation**: Create a shared color utilities module:

```typescript
// src/ui/colors.ts

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a: number;
}

/**
 * Parse hex color to RGB
 */
export function hexToRgb(hex: string | undefined): RGB | null {
  if (!hex) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1]!, 16),
    g: parseInt(result[2]!, 16),
    b: parseInt(result[3]!, 16)
  } : null;
}

/**
 * Convert RGB to hex string
 */
export function rgbToHex(rgb: RGB): string {
  return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;
}

/**
 * Blend two colors
 */
export function blendColors(base: string, blend: string, amount: number): string {
  const baseRgb = hexToRgb(base);
  const blendRgb = hexToRgb(blend);
  if (!baseRgb || !blendRgb) return base;

  return rgbToHex({
    r: Math.round(baseRgb.r + (blendRgb.r - baseRgb.r) * amount),
    g: Math.round(baseRgb.g + (blendRgb.g - baseRgb.g) * amount),
    b: Math.round(baseRgb.b + (blendRgb.b - baseRgb.b) * amount)
  });
}

/**
 * Generate ANSI escape sequence for foreground color
 */
export function fgAnsi(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

/**
 * Generate ANSI escape sequence for background color
 */
export function bgAnsi(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m`;
}
```

**Migration**: Replace all duplicated implementations with imports from this module.

### 3. Event Emitter Pattern

**Problem**: Callback management is scattered with inconsistent patterns. Each component maintains its own `Set<callback>` and cleanup logic.

**Recommendation**: Create a typed event emitter base class:

```typescript
// src/core/event-emitter.ts

type EventCallback<T> = (data: T) => void;

export class EventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<EventCallback<any>>>();

  /**
   * Subscribe to an event
   * @returns Unsubscribe function
   */
  on<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Subscribe to an event for one emission only
   */
  once<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): () => void {
    const unsubscribe = this.on(event, (data) => {
      unsubscribe();
      callback(data);
    });
    return unsubscribe;
  }

  /**
   * Emit an event
   */
  protected emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;

    for (const callback of callbacks) {
      try {
        callback(data);
      } catch (e) {
        console.error(`Event handler error for ${String(event)}:`, e);
      }
    }
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }
}
```

**Usage Example**:
```typescript
// In Pane class
interface PaneEvents {
  'click': { position: Position; clickCount: number; event: MouseEvent };
  'scroll': { deltaX: number; deltaY: number };
  'tabSelect': { document: Document };
  'tabClose': { document: Document; tabId: string };
  'focus': void;
}

export class Pane extends EventEmitter<PaneEvents> implements UIComponent {
  // Replace individual callbacks with:
  // this.emit('click', { position, clickCount, event });

  // And callers use:
  // pane.on('click', ({ position, clickCount }) => { ... });
}
```

---

## Medium Priority: API Consistency

### 4. Standardize Callback Naming Convention

**Problem**: Inconsistent callback method names:
- `onClick` vs `onTabSelect` vs `onFoldToggle` vs `onGitGutterClick`
- Some use `on` prefix, some don't
- Parameter order varies

**Recommendation**: Establish naming convention:

```typescript
// Standard pattern: on<Event>(callback): unsubscribe
// Event names: PascalCase noun or verb phrase
// Return: Always return unsubscribe function

// Good Examples:
onClick(callback: (data: ClickData) => void): () => void;
onScroll(callback: (data: ScrollData) => void): () => void;
onDocumentChange(callback: (doc: Document) => void): () => void;
onClose(callback: () => void): () => void;

// Avoid:
onTabCloseRequest()  // → use onTabClose()
onDocumentClickCallback()  // → use onClick()
```

**Naming Rules**:
1. Always prefix with `on`
2. Use PascalCase for event name
3. Keep event name short but descriptive
4. Always return unsubscribe function
5. Group related callbacks (onMouseDown, onMouseUp, onMouseMove → just onMouse with event type)

### 5. Standardize Async Method Patterns

**Problem**: Inconsistent async/sync method usage:
- Some async methods return `Promise<boolean>` for success
- Others return `Promise<T | null>` for results
- Some throw, others return null on error

**Recommendation**: Define consistent patterns:

```typescript
// Pattern 1: Operations that can fail
async performAction(): Promise<OperationResult> {
  // Return success/failure with optional message
}

interface OperationResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

// Pattern 2: Data fetching
async getData(): Promise<Data | null> {
  // Return null on not-found, throw on error
}

// Pattern 3: State changes
async updateState(): Promise<void> {
  // Throw on error, resolve on success
}
```

**For GitIntegration specifically**:
```typescript
// Current (inconsistent):
async add(filePath: string): Promise<boolean>
async show(filePath: string): Promise<string | null>
async commit(message: string): Promise<boolean>

// Recommended (consistent):
async add(filePath: string): Promise<GitResult>
async show(filePath: string, ref?: string): Promise<string | null>
async commit(message: string): Promise<GitResult>

interface GitResult {
  success: boolean;
  error?: string;
}
```

### 6. Consistent Constructor and Factory Patterns

**Problem**: Mixed patterns for object creation:
- Some classes use constructor + init()
- Some use static factory methods (Document.fromFile)
- Some use async constructors (which is anti-pattern)

**Recommendation**: Standardize on factory pattern for async initialization:

```typescript
// Pattern: Private constructor + static factory for async setup
class LSPClient {
  private constructor(
    private command: string,
    private args: string[],
    private workspaceRoot: string
  ) {}

  /**
   * Create and initialize LSP client
   */
  static async create(
    command: string,
    args: string[],
    workspaceRoot: string
  ): Promise<LSPClient> {
    const client = new LSPClient(command, args, workspaceRoot);
    await client.initialize();
    return client;
  }

  private async initialize(): Promise<void> {
    // Async setup logic
  }
}

// Usage:
const client = await LSPClient.create('typescript-language-server', ['--stdio'], '/workspace');
```

---

## Medium Priority: Component Decomposition

### 7. Decompose Pane Class

**Problem**: `Pane` class is ~2000 lines handling:
- Tab management
- Editor rendering
- Word wrap computation
- Syntax highlighting coordination
- Git gutter rendering
- Inline diff display
- Folding management
- Minimap coordination
- Mouse handling
- Scroll management

**Recommendation**: Extract focused sub-components:

```
src/ui/components/
├── pane/
│   ├── index.ts              # Re-exports
│   ├── pane.ts               # Orchestrator (~500 lines)
│   ├── pane-editor.ts        # Editor area rendering
│   ├── pane-gutter.ts        # Line numbers, git indicators, fold icons
│   ├── pane-scroll.ts        # Scroll management and word wrap
│   ├── pane-selection.ts     # Selection rendering
│   └── inline-diff.ts        # Inline diff widget
```

**Decomposition Strategy**:

```typescript
// src/ui/components/pane/pane-gutter.ts
export class PaneGutter {
  constructor(private pane: PaneContext) {}

  /** Calculate gutter width based on line count */
  calculateWidth(lineCount: number): number { ... }

  /** Render gutter for a single line */
  renderLine(
    ctx: RenderContext,
    lineNum: number,
    screenY: number,
    isCurrentLine: boolean
  ): void { ... }

  /** Check if click is in gutter area */
  containsClick(x: number, gutterEnd: number): boolean { ... }
}

// src/ui/components/pane/pane-editor.ts
export class PaneEditor {
  private gutter: PaneGutter;
  private selection: PaneSelection;

  render(ctx: RenderContext, doc: Document, editorRect: Rect): void {
    this.renderBackground(ctx, editorRect);
    this.renderLines(ctx, doc, editorRect);
    this.renderCursor(ctx, doc, editorRect);
  }
}
```

### 8. Extract State Management

**Problem**: State is scattered across App, Pane, Document, and managers with unclear ownership.

**Recommendation**: Create explicit state containers with clear ownership:

```typescript
// src/state/editor-state.ts

export interface EditorState {
  /** Currently open documents */
  documents: Map<string, DocumentState>;

  /** Active document ID */
  activeDocumentId: string | null;

  /** Pane layout configuration */
  paneLayout: PaneLayoutState;

  /** UI visibility states */
  ui: UIState;
}

export interface DocumentState {
  document: Document;
  paneId: string;
  scrollTop: number;
  scrollLeft: number;
  foldedRegions: number[];
}

export interface UIState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  terminalVisible: boolean;
  terminalHeight: number;
  activeDialog: string | null;
}

// State manager with change notifications
export class EditorStateManager extends EventEmitter<{
  'documentChange': { id: string; document: Document };
  'activeDocumentChange': { id: string | null };
  'uiChange': { key: keyof UIState; value: unknown };
}> {
  private state: EditorState;

  // Immutable getters
  getDocument(id: string): DocumentState | undefined { ... }
  getActiveDocument(): DocumentState | undefined { ... }

  // State mutations (emit change events)
  setActiveDocument(id: string): void { ... }
  updateUI(key: keyof UIState, value: unknown): void { ... }
}
```

---

## Standard Priority: Performance Optimizations

### 9. Lazy Initialization for Features

**Problem**: Some features initialize eagerly even when not needed.

**Recommendation**: Implement lazy loading pattern:

```typescript
// src/features/syntax/shiki-highlighter.ts

class ShikiHighlighter {
  private instance: Highlighter | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Ensure highlighter is initialized (lazy)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.instance) return;

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }

    await this.initPromise;
  }

  /**
   * Get highlighted tokens (auto-initializes if needed)
   */
  async highlightLine(line: number): Promise<HighlightToken[]> {
    await this.ensureInitialized();
    // ... use this.instance
  }
}
```

### 10. Cache Invalidation Strategy

**Problem**: Multiple caching layers without coordinated invalidation:
- Git status cache (5s TTL)
- Line changes cache per file
- Syntax highlight cache per line
- Theme colors cache

**Recommendation**: Implement cache manager with dependency tracking:

```typescript
// src/core/cache.ts

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  dependencies: string[];
}

export class CacheManager {
  private caches = new Map<string, CacheEntry<unknown>>();
  private ttls = new Map<string, number>();

  /**
   * Get cached value or compute
   */
  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
    options?: { ttl?: number; dependencies?: string[] }
  ): Promise<T> {
    const cached = this.caches.get(key);
    const ttl = this.ttls.get(key) ?? options?.ttl ?? 60000;

    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.value as T;
    }

    const value = await compute();
    this.caches.set(key, {
      value,
      timestamp: Date.now(),
      dependencies: options?.dependencies ?? []
    });

    return value;
  }

  /**
   * Invalidate cache entries
   */
  invalidate(pattern: string | RegExp): void {
    for (const [key, entry] of this.caches) {
      const matches = typeof pattern === 'string'
        ? key === pattern || entry.dependencies.includes(pattern)
        : pattern.test(key);

      if (matches) {
        this.caches.delete(key);
      }
    }
  }
}
```

### 11. Render Batching Improvements

**Current**: Renderer uses `setImmediate` for batching.

**Recommendation**: Add priority-based render scheduling:

```typescript
// src/ui/render-scheduler.ts

type RenderPriority = 'immediate' | 'high' | 'normal' | 'low';

export class RenderScheduler {
  private pending = new Map<RenderPriority, Set<() => void>>();
  private scheduled = false;

  schedule(callback: () => void, priority: RenderPriority = 'normal'): void {
    if (!this.pending.has(priority)) {
      this.pending.set(priority, new Set());
    }
    this.pending.get(priority)!.add(callback);

    if (!this.scheduled) {
      this.scheduled = true;

      if (priority === 'immediate') {
        this.flush();
      } else {
        setImmediate(() => this.flush());
      }
    }
  }

  private flush(): void {
    this.scheduled = false;

    // Process in priority order
    for (const priority of ['immediate', 'high', 'normal', 'low'] as RenderPriority[]) {
      const callbacks = this.pending.get(priority);
      if (callbacks) {
        for (const callback of callbacks) {
          callback();
        }
        callbacks.clear();
      }
    }
  }
}
```

---

## Standard Priority: Error Handling

### 12. Unified Error Handling

**Problem**: Errors are handled inconsistently:
- Some caught and logged
- Some swallowed silently
- No user feedback for recoverable errors

**Recommendation**: Create error handling infrastructure:

```typescript
// src/core/errors.ts

/**
 * Base application error
 */
export class UltraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = true,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'UltraError';
  }
}

/**
 * Error codes
 */
export const ErrorCodes = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_SAVE_FAILED: 'FILE_SAVE_FAILED',
  GIT_OPERATION_FAILED: 'GIT_OPERATION_FAILED',
  LSP_CONNECTION_FAILED: 'LSP_CONNECTION_FAILED',
  LSP_REQUEST_TIMEOUT: 'LSP_REQUEST_TIMEOUT',
  THEME_LOAD_FAILED: 'THEME_LOAD_FAILED',
} as const;

/**
 * Error handler service
 */
export class ErrorHandler {
  private handlers = new Map<string, (error: UltraError) => void>();

  /**
   * Handle an error
   */
  handle(error: Error | UltraError): void {
    const ultraError = error instanceof UltraError
      ? error
      : new UltraError(error.message, 'UNKNOWN', true);

    // Log to debug
    debugLog(`[Error] ${ultraError.code}: ${ultraError.message}`);

    // Call registered handler
    const handler = this.handlers.get(ultraError.code);
    if (handler) {
      handler(ultraError);
    } else if (ultraError.recoverable) {
      // Show in status bar
      this.showStatusMessage(`Error: ${ultraError.message}`);
    } else {
      // Critical error - show dialog
      this.showErrorDialog(ultraError);
    }
  }

  /**
   * Register error handler for specific code
   */
  onError(code: string, handler: (error: UltraError) => void): void {
    this.handlers.set(code, handler);
  }
}
```

### 13. Operation Result Pattern

**Recommendation**: Use Result type for operations that can fail:

```typescript
// src/core/result.ts

export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

export const Result = {
  ok<T>(value: T): Result<T, never> {
    return { success: true, value };
  },

  err<E>(error: E): Result<never, E> {
    return { success: false, error };
  },

  map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return result.success
      ? Result.ok(fn(result.value))
      : result;
  },

  async mapAsync<T, U, E>(
    result: Result<T, E>,
    fn: (value: T) => Promise<U>
  ): Promise<Result<U, E>> {
    return result.success
      ? Result.ok(await fn(result.value))
      : result;
  }
};

// Usage:
async function saveDocument(doc: Document): Promise<Result<void, SaveError>> {
  try {
    await doc.save();
    return Result.ok(undefined);
  } catch (e) {
    return Result.err(new SaveError(e.message));
  }
}
```

---

## Code Quality Improvements

### 14. Extract Magic Numbers and Strings

**Problem**: Hard-coded values throughout:
- Cache TTL: 5000ms
- Chunk size: 16384
- Tab size: 2
- Various timeout values

**Recommendation**: Create constants module:

```typescript
// src/constants.ts

export const CACHE = {
  GIT_STATUS_TTL: 5000,
  LINE_CHANGES_TTL: 5000,
  THEME_TTL: 60000,
} as const;

export const RENDER = {
  CHUNK_SIZE: 16384,
  SCROLL_LINES: 3,
  MINIMAP_WIDTH: 10,
} as const;

export const TIMEOUTS = {
  LSP_REQUEST: 30000,
  DEBOUNCE_DEFAULT: 100,
  CHORD_KEY: 500,
} as const;

export const UI = {
  DEFAULT_TAB_SIZE: 2,
  DEFAULT_GUTTER_WIDTH: 6,
  TAB_BAR_HEIGHT: 1,
  STATUS_BAR_HEIGHT: 1,
} as const;
```

### 15. Add JSDoc for Public APIs

**Problem**: Some public methods lack documentation, making it harder to understand intended usage.

**Recommendation**: Add comprehensive JSDoc:

```typescript
/**
 * Open a document in the editor
 *
 * If the document is already open in any pane, that tab will be activated.
 * Otherwise, a new tab will be created in the target pane.
 *
 * @param document - The document to open
 * @param options - Optional configuration
 * @param options.paneId - Specific pane to open in (default: active pane)
 * @param options.activate - Whether to activate the tab (default: true)
 * @param options.preview - Open as preview tab that can be replaced (default: false)
 *
 * @returns The pane and tab where the document was opened
 *
 * @example
 * // Open in active pane
 * const { pane, tabId } = await paneManager.openDocument(doc);
 *
 * @example
 * // Open in specific pane without activating
 * await paneManager.openDocument(doc, { paneId: 'pane-2', activate: false });
 */
openDocument(document: Document, options?: OpenDocumentOptions): OpenResult;
```

### 16. Type Narrowing Improvements

**Problem**: Some type guards are fragile or missing:

```typescript
// Current (fragile):
function isCommand(item: PaletteEntry): item is Command {
  return 'handler' in item && !('id' in item && 'title' in item && typeof (item as any).handler === 'function');
}
```

**Recommendation**: Use branded types or discriminated unions:

```typescript
// Better: Discriminated union
interface CommandEntry {
  type: 'command';
  command: Command;
}

interface PaletteItemEntry {
  type: 'paletteItem';
  item: PaletteItem;
}

type PaletteEntry = CommandEntry | PaletteItemEntry;

// Type narrowing is now trivial
if (entry.type === 'command') {
  entry.command.handler();
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
1. ✅ Extract color utilities to shared module
2. ✅ Create UIComponent interface
3. ✅ Create EventEmitter base class
4. ✅ Define constants module
5. ✅ Add Result type

### Phase 2: API Consistency (Week 3-4)
1. ✅ Standardize callback naming across all components
2. ✅ Add factory patterns for async initialization (LSPClient.create)
3. Add JSDoc to all public APIs
4. Fix type guard implementations

### Phase 3: Component Decomposition (Week 5-6)
1. ✅ Extract PaneGutter component (src/ui/components/pane/pane-gutter.ts)
2. Extract PaneEditor component
3. ✅ Extract InlineDiff component (src/ui/components/pane/inline-diff.ts)
4. Refactor Pane as orchestrator

### Phase 4: State Management (Week 7-8)
1. ✅ Create EditorStateManager (src/state/editor-state.ts)
2. Migrate state from App to state manager
3. ✅ Add state change events
4. Update components to use state manager

### Phase 5: Error Handling (Week 9-10)
1. Implement UltraError class hierarchy
2. Create ErrorHandler service
3. Update all try/catch blocks to use new pattern
4. Add user feedback for recoverable errors

### Phase 6: Performance (Week 11-12)
1. Implement CacheManager
2. Add render priority system
3. Profile and optimize hot paths
4. Add lazy initialization where beneficial

---

## Appendix: File-by-File Changes Summary

| File | Priority | Status | Changes |
|------|----------|--------|---------|
| `src/ui/colors.ts` | High | ✅ | NEW - Shared color utilities |
| `src/core/event-emitter.ts` | High | ✅ | NEW - Typed event emitter |
| `src/ui/components/component.interface.ts` | High | ✅ | NEW - Component interfaces |
| `src/constants.ts` | High | ✅ | NEW - Centralized constants |
| `src/core/result.ts` | Medium | ✅ | NEW - Result type |
| `src/state/editor-state.ts` | Medium | ✅ | NEW - Centralized state management |
| `src/ui/components/pane/pane-gutter.ts` | Medium | ✅ | NEW - Gutter rendering component |
| `src/ui/components/pane/inline-diff.ts` | Medium | ✅ | NEW - Inline diff widget component |
| `src/features/lsp/client.ts` | Medium | ✅ | Added LSPClient.create() factory method |
| `src/ui/components/pane.ts` | Medium | ✅ | Standardized callback return types |
| `src/ui/components/pane-manager.ts` | Medium | ✅ | Standardized callback return types |
| `src/ui/components/file-tree.ts` | Medium | ✅ | Standardized callback return types |
| `src/ui/components/git-panel.ts` | Medium | ✅ | Standardized callback return types |
| `src/ui/components/terminal-pane.ts` | Medium | ✅ | Standardized callback return types |
| `src/ui/components/minimap.ts` | Medium | ✅ | Standardized callback return types |
| `src/ui/components/tab-bar.ts` | Medium | ✅ | Standardized callback return types |
| `src/ui/components/editor-pane.ts` | Medium | ✅ | Standardized callback return types |
| `src/core/errors.ts` | Standard | Pending | NEW - Error handling |
| `src/ui/renderer.ts` | Standard | Pending | Add render priorities |

---

## Conclusion

These recommendations aim to improve Ultra's maintainability, testability, and developer experience while preserving its existing strengths. The changes are designed to be incremental, allowing for gradual adoption without major rewrites.

The most impactful changes are:
1. **Color utilities extraction** - Immediate code reduction
2. **Component interface** - Foundation for future improvements
3. **Pane decomposition** - Major maintainability improvement
4. **Error handling** - Better user experience and debuggability

Each recommendation includes concrete code examples to guide implementation.
