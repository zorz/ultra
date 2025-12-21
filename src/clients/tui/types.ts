/**
 * TUI Core Types
 *
 * Type definitions for the Terminal User Interface layer.
 */

// ============================================
// Geometry
// ============================================

export interface Rect {
  x: number; // Column (0-indexed)
  y: number; // Row (0-indexed)
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Position {
  x: number;
  y: number;
}

// ============================================
// Element Types
// ============================================

export type ElementType =
  | 'DocumentEditor'
  | 'FileTree'
  | 'GitPanel'
  | 'GitDiffView'
  | 'AgentChat'
  | 'TerminalSession'
  | 'SearchResults'
  | 'ProjectSearch'
  | 'DiagnosticsView';

export interface ElementConfig {
  type: ElementType;
  id: string;
  title: string;
  state?: unknown;
}

// ============================================
// Container Types
// ============================================

export type ContainerMode = 'tabs' | 'accordion';

export type SplitDirection = 'horizontal' | 'vertical';

export interface PaneConfig {
  id: string;
  mode: ContainerMode;
  elements: ElementConfig[];
  activeElementId?: string; // For tabs
  expandedElementIds?: string[]; // For accordion
}

export interface SplitConfig {
  id: string;
  direction: SplitDirection;
  children: Array<PaneConfig | SplitConfig>;
  ratios: number[]; // e.g., [0.33, 0.33, 0.34] for three-way split
}

export interface LayoutConfig {
  root: PaneConfig | SplitConfig;
  focusedPaneId: string;
  focusedElementId: string;
}

// ============================================
// Rendering
// ============================================

export interface Cell {
  char: string;
  fg: string; // Foreground color (hex or name)
  bg: string; // Background color
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  dim?: boolean;
}

export interface DirtyRegion {
  rect: Rect;
  reason: string;
}

// ============================================
// Input
// ============================================

export interface KeyEvent {
  key: string; // e.g., 'a', 'Enter', 'ArrowUp'
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface MouseEvent {
  type: 'press' | 'release' | 'drag' | 'scroll' | 'move';
  button: 'left' | 'middle' | 'right' | 'none';
  x: number;
  y: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Scroll direction: 1 for down, -1 for up (only set for scroll events) */
  scrollDirection?: 1 | -1;
}

export type InputEvent = KeyEvent | MouseEvent;

// ============================================
// Lifecycle
// ============================================

export interface ElementLifecycle {
  onMount(): void;
  onUnmount(): void;
  onFocus(): void;
  onBlur(): void;
  onResize(size: Size): void;
  onVisibilityChange(visible: boolean): void;
}

// ============================================
// Type Guards
// ============================================

export function isKeyEvent(event: InputEvent): event is KeyEvent {
  return 'key' in event;
}

export function isMouseEvent(event: InputEvent): event is MouseEvent {
  return 'type' in event && 'button' in event;
}

export function isSplitConfig(
  config: PaneConfig | SplitConfig
): config is SplitConfig {
  return 'direction' in config;
}

export function isPaneConfig(
  config: PaneConfig | SplitConfig
): config is PaneConfig {
  return 'mode' in config;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Check if a point is within a rect.
 */
export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

/**
 * Check if two rects intersect.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/**
 * Get the intersection of two rects.
 */
export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

/**
 * Create a default empty cell.
 */
export function createEmptyCell(bg = 'default', fg = 'default'): Cell {
  return {
    char: ' ',
    fg,
    bg,
  };
}

/**
 * Clone a cell.
 */
export function cloneCell(cell: Cell): Cell {
  return { ...cell };
}

/**
 * Check if two cells are equal.
 */
export function cellsEqual(a: Cell, b: Cell): boolean {
  return (
    a.char === b.char &&
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.dim === b.dim
  );
}
