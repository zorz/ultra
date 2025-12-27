/**
 * Query Results Element
 *
 * Displays database query results in multiple view modes:
 * - Table: Scrollable grid with column sorting
 * - JSON: Formatted JSON view
 * - Text: Plain text (psql-style) output
 *
 * Features:
 * - Column resizing
 * - Sorting by column
 * - Export to CSV/JSON
 * - Pagination for large result sets
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import { debugLog } from '../../../debug.ts';
import type { QueryResult, FieldInfo } from '../../../services/database/types.ts';

// ============================================
// Types
// ============================================

/**
 * View mode for displaying results.
 */
export type ResultViewMode = 'table' | 'json' | 'text';

/**
 * Sort direction.
 */
export type SortDirection = 'asc' | 'desc' | null;

/**
 * Column configuration.
 */
interface ColumnConfig {
  field: FieldInfo;
  width: number;
  sortDirection: SortDirection;
}

/**
 * Query Results state for serialization.
 */
export interface QueryResultsState {
  viewMode: ResultViewMode;
  scrollTop: number;
  scrollLeft: number;
  selectedRow: number;
}

/**
 * Callbacks for query results.
 */
export interface QueryResultsCallbacks {
  /** Called when export is requested */
  onExport?: (format: 'csv' | 'json', data: string) => void;
}

// ============================================
// Query Results Element
// ============================================

/**
 * Query Results display element.
 */
export class QueryResults extends BaseElement {
  // Result data
  private result: QueryResult | null = null;
  private displayRows: Record<string, unknown>[] = [];
  private columns: ColumnConfig[] = [];

  // View state
  private viewMode: ResultViewMode = 'table';
  private scrollTop: number = 0;
  private scrollLeft: number = 0;
  private selectedRow: number = 0;
  private selectedColumn: number = 0;

  // Sorting
  private sortColumn: number = -1;
  private sortDirection: SortDirection = null;

  // Callbacks
  private callbacks: QueryResultsCallbacks;

  // UI constants
  private readonly HEADER_HEIGHT = 1;
  private readonly STATUS_HEIGHT = 1;
  private readonly MIN_COLUMN_WIDTH = 8;
  private readonly MAX_COLUMN_WIDTH = 50;

  constructor(id: string, ctx: ElementContext, callbacks: QueryResultsCallbacks = {}) {
    super('QueryResults', id, 'Query Results', ctx);
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the query result to display.
   */
  setResult(result: QueryResult | null): void {
    this.result = result;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.selectedRow = 0;
    this.selectedColumn = 0;
    this.sortColumn = -1;
    this.sortDirection = null;

    if (result) {
      this.initializeColumns(result.fields);
      this.displayRows = [...result.rows];
      this.setTitle(`Results (${result.rowCount} rows)`);
    } else {
      this.columns = [];
      this.displayRows = [];
      this.setTitle('Query Results');
    }

    this.ctx.markDirty();
  }

  /**
   * Get the current result.
   */
  getResult(): QueryResult | null {
    return this.result;
  }

  /**
   * Set view mode.
   */
  setViewMode(mode: ResultViewMode): void {
    this.viewMode = mode;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.ctx.markDirty();
  }

  /**
   * Get view mode.
   */
  getViewMode(): ResultViewMode {
    return this.viewMode;
  }

  /**
   * Export results to string.
   */
  exportToCSV(): string {
    if (!this.result) return '';

    const headers = this.result.fields.map(f => this.escapeCSV(f.name)).join(',');
    const rows = this.result.rows.map(row =>
      this.result!.fields.map(f => this.escapeCSV(String(row[f.name] ?? ''))).join(',')
    );

    return [headers, ...rows].join('\n');
  }

  /**
   * Export results to JSON.
   */
  exportToJSON(): string {
    if (!this.result) return '[]';
    return JSON.stringify(this.result.rows, null, 2);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    // Colors
    const bg = this.ctx.getThemeColor('editor.background', '#1e1e1e');
    const fg = this.ctx.getThemeColor('editor.foreground', '#d4d4d4');

    // Clear background
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        buffer.set(x + col, y + row, { char: ' ', fg, bg });
      }
    }

    if (!this.result || this.result.rows.length === 0) {
      this.renderEmpty(buffer, x, y, width, height);
      return;
    }

    switch (this.viewMode) {
      case 'table':
        this.renderTable(buffer, x, y, width, height);
        break;
      case 'json':
        this.renderJSON(buffer, x, y, width, height);
        break;
      case 'text':
        this.renderText(buffer, x, y, width, height);
        break;
    }

    // Status bar
    this.renderStatusBar(buffer, x, y + height - 1, width);
  }

  private renderEmpty(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const fg = this.ctx.getThemeColor('descriptionForeground', '#858585');
    const bg = this.ctx.getThemeColor('editor.background', '#1e1e1e');

    const message = this.result ? 'No rows returned' : 'No results';
    const msgX = x + Math.floor((width - message.length) / 2);
    const msgY = y + Math.floor(height / 2);

    for (let i = 0; i < message.length; i++) {
      buffer.set(msgX + i, msgY, { char: message[i], fg, bg });
    }
  }

  private renderTable(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const bg = this.ctx.getThemeColor('editor.background', '#1e1e1e');
    const fg = this.ctx.getThemeColor('editor.foreground', '#d4d4d4');
    const headerBg = this.ctx.getThemeColor('editorGroupHeader.tabsBackground', '#252526');
    const headerFg = this.ctx.getThemeColor('tab.activeForeground', '#ffffff');
    const selectedBg = this.ctx.getThemeColor('list.activeSelectionBackground', '#094771');
    const selectedFg = this.ctx.getThemeColor('list.activeSelectionForeground', '#ffffff');
    const borderColor = this.ctx.getThemeColor('editorGroup.border', '#444444');

    const contentHeight = height - this.HEADER_HEIGHT - this.STATUS_HEIGHT;

    // Render header
    let colX = x - this.scrollLeft;
    for (let colIdx = 0; colIdx < this.columns.length; colIdx++) {
      const col = this.columns[colIdx];
      if (colX >= x + width) break;
      if (colX + col.width > x) {
        const startX = Math.max(x, colX);
        const endX = Math.min(x + width, colX + col.width);

        // Header cell
        for (let cx = startX; cx < endX; cx++) {
          const charIdx = cx - colX;
          let char = ' ';
          if (charIdx < col.field.name.length) {
            char = col.field.name[charIdx];
          } else if (charIdx === col.width - 1) {
            // Sort indicator
            if (this.sortColumn === colIdx) {
              char = this.sortDirection === 'asc' ? '▲' : '▼';
            } else {
              char = '│';
            }
          }
          buffer.set(cx, y, { char, fg: headerFg, bg: headerBg });
        }
      }
      colX += col.width;
    }

    // Render rows
    const visibleRows = Math.min(contentHeight, this.displayRows.length - this.scrollTop);
    for (let rowIdx = 0; rowIdx < visibleRows; rowIdx++) {
      const dataRowIdx = this.scrollTop + rowIdx;
      const row = this.displayRows[dataRowIdx];
      const screenY = y + this.HEADER_HEIGHT + rowIdx;
      const isSelected = dataRowIdx === this.selectedRow && this.focused;

      const rowBg = isSelected ? selectedBg : bg;
      const rowFg = isSelected ? selectedFg : fg;

      colX = x - this.scrollLeft;
      for (let colIdx = 0; colIdx < this.columns.length; colIdx++) {
        const col = this.columns[colIdx];
        if (colX >= x + width) break;
        if (colX + col.width > x) {
          const startX = Math.max(x, colX);
          const endX = Math.min(x + width, colX + col.width);

          const value = this.formatValue(row[col.field.name], col.width - 1);

          for (let cx = startX; cx < endX; cx++) {
            const charIdx = cx - colX;
            let char = ' ';
            if (charIdx < value.length) {
              char = value[charIdx];
            } else if (charIdx === col.width - 1) {
              char = '│';
            }

            // Highlight selected column
            const cellBg = isSelected && colIdx === this.selectedColumn
              ? this.ctx.getThemeColor('editor.selectionBackground', '#264f78')
              : rowBg;

            buffer.set(cx, screenY, { char, fg: rowFg, bg: cellBg });
          }
        }
        colX += col.width;
      }
    }
  }

  private renderJSON(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const fg = this.ctx.getThemeColor('editor.foreground', '#d4d4d4');
    const bg = this.ctx.getThemeColor('editor.background', '#1e1e1e');
    const keyColor = this.ctx.getThemeColor('variable', '#9cdcfe');
    const stringColor = this.ctx.getThemeColor('string', '#ce9178');
    const numberColor = this.ctx.getThemeColor('number', '#b5cea8');

    const json = JSON.stringify(this.displayRows, null, 2);
    const lines = json.split('\n');

    const contentHeight = height - this.STATUS_HEIGHT;
    const visibleLines = Math.min(contentHeight, lines.length - this.scrollTop);

    for (let i = 0; i < visibleLines; i++) {
      const lineIdx = this.scrollTop + i;
      const line = lines[lineIdx] || '';
      const screenY = y + i;

      for (let col = 0; col < Math.min(width, line.length - this.scrollLeft); col++) {
        const charIdx = this.scrollLeft + col;
        const char = line[charIdx] || ' ';

        // Simple syntax coloring for JSON
        let charFg = fg;
        if (char === '"') {
          // Check if it's a key (followed by :)
          const restOfLine = line.slice(charIdx);
          if (restOfLine.match(/^"[^"]+"\s*:/)) {
            charFg = keyColor;
          } else {
            charFg = stringColor;
          }
        } else if (/\d/.test(char)) {
          charFg = numberColor;
        }

        buffer.set(x + col, screenY, { char, fg: charFg, bg });
      }
    }
  }

  private renderText(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const fg = this.ctx.getThemeColor('editor.foreground', '#d4d4d4');
    const bg = this.ctx.getThemeColor('editor.background', '#1e1e1e');
    const headerFg = this.ctx.getThemeColor('tab.activeForeground', '#ffffff');

    // Generate psql-style output
    const lines: string[] = [];

    // Header
    const headers = this.columns.map(c => c.field.name.padEnd(c.width - 1));
    lines.push(headers.join('|'));
    lines.push(this.columns.map(c => '-'.repeat(c.width - 1)).join('+'));

    // Data rows
    for (const row of this.displayRows) {
      const values = this.columns.map(c =>
        this.formatValue(row[c.field.name], c.width - 1).padEnd(c.width - 1)
      );
      lines.push(values.join('|'));
    }

    // Footer
    lines.push(`(${this.displayRows.length} rows)`);

    const contentHeight = height - this.STATUS_HEIGHT;
    const visibleLines = Math.min(contentHeight, lines.length - this.scrollTop);

    for (let i = 0; i < visibleLines; i++) {
      const lineIdx = this.scrollTop + i;
      const line = lines[lineIdx] || '';
      const screenY = y + i;
      const isHeader = lineIdx < 2;

      for (let col = 0; col < Math.min(width, line.length - this.scrollLeft); col++) {
        const charIdx = this.scrollLeft + col;
        const char = line[charIdx] || ' ';
        buffer.set(x + col, screenY, {
          char,
          fg: isHeader ? headerFg : fg,
          bg,
        });
      }
    }
  }

  private renderStatusBar(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const bg = this.ctx.getThemeColor('statusBar.background', '#007acc');
    const fg = this.ctx.getThemeColor('statusBar.foreground', '#ffffff');

    // Clear status bar
    for (let col = 0; col < width; col++) {
      buffer.set(x + col, y, { char: ' ', fg, bg });
    }

    // View mode indicator
    const modeText = `[${this.viewMode.toUpperCase()}]`;
    for (let i = 0; i < modeText.length && i < width; i++) {
      buffer.set(x + i, y, { char: modeText[i], fg, bg });
    }

    // Row info
    if (this.result) {
      const rowInfo = ` Row ${this.selectedRow + 1}/${this.displayRows.length}`;
      const infoStart = modeText.length;
      for (let i = 0; i < rowInfo.length && infoStart + i < width; i++) {
        buffer.set(x + infoStart + i, y, { char: rowInfo[i], fg, bg });
      }
    }

    // Hints
    const hints = 'Tab: View  E: Export  S: Sort';
    const hintsStart = width - hints.length - 1;
    if (hintsStart > modeText.length + 20) {
      for (let i = 0; i < hints.length; i++) {
        buffer.set(x + hintsStart + i, y, {
          char: hints[i],
          fg: this.ctx.getThemeColor('descriptionForeground', '#cccccc'),
          bg,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper Methods
  // ─────────────────────────────────────────────────────────────────────────

  private initializeColumns(fields: FieldInfo[]): void {
    this.columns = fields.map(field => ({
      field,
      width: this.calculateColumnWidth(field),
      sortDirection: null,
    }));
  }

  private calculateColumnWidth(field: FieldInfo): number {
    // Start with header width
    let width = field.name.length + 2;

    // Sample some data rows to find max width
    const sampleSize = Math.min(100, this.result?.rows.length || 0);
    for (let i = 0; i < sampleSize; i++) {
      const row = this.result?.rows[i];
      if (row) {
        const value = String(row[field.name] ?? '');
        width = Math.max(width, value.length + 2);
      }
    }

    // Clamp to min/max
    return Math.min(this.MAX_COLUMN_WIDTH, Math.max(this.MIN_COLUMN_WIDTH, width));
  }

  private formatValue(value: unknown, maxWidth: number): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    let str: string;
    if (typeof value === 'object') {
      str = JSON.stringify(value);
    } else {
      str = String(value);
    }

    // Truncate if needed
    if (str.length > maxWidth) {
      return str.slice(0, maxWidth - 1) + '…';
    }

    return str;
  }

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private sortByColumn(columnIndex: number): void {
    if (columnIndex < 0 || columnIndex >= this.columns.length) return;

    const col = this.columns[columnIndex];

    // Toggle sort direction
    if (this.sortColumn === columnIndex) {
      if (this.sortDirection === 'asc') {
        this.sortDirection = 'desc';
      } else if (this.sortDirection === 'desc') {
        this.sortDirection = null;
        this.sortColumn = -1;
      }
    } else {
      this.sortColumn = columnIndex;
      this.sortDirection = 'asc';
    }

    // Apply sort
    if (this.sortDirection && this.result) {
      const fieldName = col.field.name;
      const dir = this.sortDirection === 'asc' ? 1 : -1;

      this.displayRows = [...this.result.rows].sort((a, b) => {
        const va = a[fieldName];
        const vb = b[fieldName];

        if (va === null || va === undefined) return dir;
        if (vb === null || vb === undefined) return -dir;

        if (typeof va === 'number' && typeof vb === 'number') {
          return (va - vb) * dir;
        }

        return String(va).localeCompare(String(vb)) * dir;
      });
    } else if (this.result) {
      // Reset to original order
      this.displayRows = [...this.result.rows];
    }

    // Update column states
    this.columns.forEach((c, i) => {
      c.sortDirection = i === this.sortColumn ? this.sortDirection : null;
    });

    this.ctx.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  handleKey(event: KeyEvent): boolean {
    // View mode toggle: Tab
    if (event.key === 'tab' && !event.ctrl && !event.shift) {
      const modes: ResultViewMode[] = ['table', 'json', 'text'];
      const currentIdx = modes.indexOf(this.viewMode);
      this.setViewMode(modes[(currentIdx + 1) % modes.length]);
      return true;
    }

    // Export: E
    if (event.key === 'e' && !event.ctrl) {
      this.handleExport();
      return true;
    }

    // Sort: S or click on header
    if (event.key === 's' && !event.ctrl && this.viewMode === 'table') {
      this.sortByColumn(this.selectedColumn);
      return true;
    }

    // Navigation
    if (event.key === 'up') {
      this.selectedRow = Math.max(0, this.selectedRow - 1);
      this.ensureRowVisible();
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'down') {
      this.selectedRow = Math.min(this.displayRows.length - 1, this.selectedRow + 1);
      this.ensureRowVisible();
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'left') {
      if (this.viewMode === 'table') {
        this.selectedColumn = Math.max(0, this.selectedColumn - 1);
        this.ensureColumnVisible();
      } else {
        this.scrollLeft = Math.max(0, this.scrollLeft - 1);
      }
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'right') {
      if (this.viewMode === 'table') {
        this.selectedColumn = Math.min(this.columns.length - 1, this.selectedColumn + 1);
        this.ensureColumnVisible();
      } else {
        this.scrollLeft++;
      }
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'pageup') {
      const pageSize = this.bounds.height - this.HEADER_HEIGHT - this.STATUS_HEIGHT;
      this.selectedRow = Math.max(0, this.selectedRow - pageSize);
      this.ensureRowVisible();
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'pagedown') {
      const pageSize = this.bounds.height - this.HEADER_HEIGHT - this.STATUS_HEIGHT;
      this.selectedRow = Math.min(this.displayRows.length - 1, this.selectedRow + pageSize);
      this.ensureRowVisible();
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'home') {
      this.selectedRow = 0;
      this.selectedColumn = 0;
      this.scrollTop = 0;
      this.scrollLeft = 0;
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'end') {
      this.selectedRow = this.displayRows.length - 1;
      this.ensureRowVisible();
      this.ctx.markDirty();
      return true;
    }

    return false;
  }

  handleMouse(event: MouseEvent): boolean {
    if (event.type === 'mousedown' && this.viewMode === 'table') {
      const relY = event.y - this.bounds.y;

      // Click on header to sort
      if (relY === 0) {
        const colIdx = this.getColumnAtX(event.x);
        if (colIdx >= 0) {
          this.sortByColumn(colIdx);
        }
        return true;
      }

      // Click on row to select
      const rowIdx = this.scrollTop + relY - this.HEADER_HEIGHT;
      if (rowIdx >= 0 && rowIdx < this.displayRows.length) {
        this.selectedRow = rowIdx;
        const colIdx = this.getColumnAtX(event.x);
        if (colIdx >= 0) {
          this.selectedColumn = colIdx;
        }
        this.ctx.markDirty();
        return true;
      }
    }

    if (event.type === 'wheel') {
      const delta = event.button === 4 ? -3 : 3;
      this.scrollTop = Math.max(0, Math.min(this.displayRows.length - 1, this.scrollTop + delta));
      this.ctx.markDirty();
      return true;
    }

    return false;
  }

  private getColumnAtX(screenX: number): number {
    let colX = this.bounds.x - this.scrollLeft;
    for (let i = 0; i < this.columns.length; i++) {
      if (screenX >= colX && screenX < colX + this.columns[i].width) {
        return i;
      }
      colX += this.columns[i].width;
    }
    return -1;
  }

  private ensureRowVisible(): void {
    const contentHeight = this.bounds.height - this.HEADER_HEIGHT - this.STATUS_HEIGHT;
    if (this.selectedRow < this.scrollTop) {
      this.scrollTop = this.selectedRow;
    } else if (this.selectedRow >= this.scrollTop + contentHeight) {
      this.scrollTop = this.selectedRow - contentHeight + 1;
    }
  }

  private ensureColumnVisible(): void {
    // Calculate column position
    let colStart = 0;
    for (let i = 0; i < this.selectedColumn; i++) {
      colStart += this.columns[i].width;
    }
    const colEnd = colStart + this.columns[this.selectedColumn].width;

    if (colStart < this.scrollLeft) {
      this.scrollLeft = colStart;
    } else if (colEnd > this.scrollLeft + this.bounds.width) {
      this.scrollLeft = colEnd - this.bounds.width;
    }
  }

  private handleExport(): void {
    if (!this.result) return;

    // Default to CSV export
    const csv = this.exportToCSV();
    this.callbacks.onExport?.('csv', csv);

    debugLog(`[QueryResults] Exported ${this.displayRows.length} rows to CSV`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): QueryResultsState {
    return {
      viewMode: this.viewMode,
      scrollTop: this.scrollTop,
      scrollLeft: this.scrollLeft,
      selectedRow: this.selectedRow,
    };
  }

  override setState(state: unknown): void {
    const s = state as QueryResultsState;
    if (s.viewMode) this.viewMode = s.viewMode;
    if (s.scrollTop !== undefined) this.scrollTop = s.scrollTop;
    if (s.scrollLeft !== undefined) this.scrollLeft = s.scrollLeft;
    if (s.selectedRow !== undefined) this.selectedRow = s.selectedRow;
  }
}

export default QueryResults;
