/**
 * Symbol Picker Dialog
 *
 * Quick go-to-symbol picker with fuzzy search.
 * Uses Promise-based result handling for document symbols.
 */

import { SearchableDialog, type ItemDisplay } from './searchable-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import { SymbolKind } from '../../../services/lsp/index.ts';

// ============================================
// Types
// ============================================

/**
 * A symbol entry for the symbol picker.
 */
export interface SymbolEntry {
  /** Symbol name */
  name: string;
  /** Symbol kind (from LSP SymbolKind) */
  kind: number;
  /** Optional detail (e.g., return type, parameters) */
  detail?: string;
  /** Container name (parent class/namespace) */
  containerName?: string;
  /** Source file URI */
  uri: string;
  /** Line number (0-indexed) */
  line: number;
  /** Column number (0-indexed) */
  column: number;
}

// ============================================
// Symbol Display Constants
// ============================================

/** Icons for symbol kinds */
const SYMBOL_ICONS: Record<number, string> = {
  [SymbolKind.File]: '📄',
  [SymbolKind.Module]: '📦',
  [SymbolKind.Namespace]: '🏷',
  [SymbolKind.Package]: '📦',
  [SymbolKind.Class]: '🔷',
  [SymbolKind.Method]: '🔶',
  [SymbolKind.Property]: '🔹',
  [SymbolKind.Field]: '🔹',
  [SymbolKind.Constructor]: '🔨',
  [SymbolKind.Enum]: '📋',
  [SymbolKind.Interface]: '🔷',
  [SymbolKind.Function]: '🔶',
  [SymbolKind.Variable]: '📌',
  [SymbolKind.Constant]: '🔒',
  [SymbolKind.String]: '📝',
  [SymbolKind.Number]: '#️',
  [SymbolKind.Boolean]: '✓',
  [SymbolKind.Array]: '📚',
  [SymbolKind.Object]: '📦',
  [SymbolKind.Key]: '🔑',
  [SymbolKind.Null]: '∅',
  [SymbolKind.EnumMember]: '🔸',
  [SymbolKind.Struct]: '🏗',
  [SymbolKind.Event]: '⚡',
  [SymbolKind.Operator]: '➕',
  [SymbolKind.TypeParameter]: '🔤',
};

/** Short labels for symbol kinds */
const SYMBOL_LABELS: Record<number, string> = {
  [SymbolKind.File]: 'file',
  [SymbolKind.Module]: 'module',
  [SymbolKind.Namespace]: 'namespace',
  [SymbolKind.Package]: 'package',
  [SymbolKind.Class]: 'class',
  [SymbolKind.Method]: 'method',
  [SymbolKind.Property]: 'property',
  [SymbolKind.Field]: 'field',
  [SymbolKind.Constructor]: 'constructor',
  [SymbolKind.Enum]: 'enum',
  [SymbolKind.Interface]: 'interface',
  [SymbolKind.Function]: 'function',
  [SymbolKind.Variable]: 'variable',
  [SymbolKind.Constant]: 'constant',
  [SymbolKind.String]: 'string',
  [SymbolKind.Number]: 'number',
  [SymbolKind.Boolean]: 'boolean',
  [SymbolKind.Array]: 'array',
  [SymbolKind.Object]: 'object',
  [SymbolKind.Key]: 'key',
  [SymbolKind.Null]: 'null',
  [SymbolKind.EnumMember]: 'enum member',
  [SymbolKind.Struct]: 'struct',
  [SymbolKind.Event]: 'event',
  [SymbolKind.Operator]: 'operator',
  [SymbolKind.TypeParameter]: 'type param',
};

// ============================================
// Symbol Picker Dialog
// ============================================

/**
 * Promise-based symbol picker with fuzzy search.
 * Returns selected symbol via Promise when closed.
 */
export class SymbolPickerDialog extends SearchableDialog<SymbolEntry> {
  /** Current file URI for context */
  private currentUri: string = '';

  /** Whether to show file paths (for workspace symbol search) */
  private showFilePaths: boolean = false;

  /** Workspace root for making paths relative */
  private workspaceRoot: string = '';

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
    this.zIndex = 200;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the current file URI for context display.
   */
  setCurrentUri(uri: string): void {
    this.currentUri = uri;
  }

  /**
   * Set whether to show file paths in the display.
   */
  setShowFilePaths(show: boolean, workspaceRoot?: string): void {
    this.showFilePaths = show;
    this.workspaceRoot = workspaceRoot ?? '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Abstract Implementation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Score a symbol against the query.
   */
  protected override scoreItem(symbol: SymbolEntry, query: string): number {
    // Score against symbol name (primary)
    const nameScore = this.combinedScore(symbol.name, query);

    // Score against container name (secondary)
    const containerScore = symbol.containerName
      ? this.combinedScore(symbol.containerName, query) * 0.3
      : 0;

    // Score against detail (tertiary)
    const detailScore = symbol.detail
      ? this.combinedScore(symbol.detail, query) * 0.2
      : 0;

    // Bonus for certain symbol types (classes, functions are more important)
    let kindBonus = 0;
    if (symbol.kind === SymbolKind.Class || symbol.kind === SymbolKind.Interface) {
      kindBonus = 2;
    } else if (symbol.kind === SymbolKind.Function || symbol.kind === SymbolKind.Method) {
      kindBonus = 1;
    }

    return Math.max(nameScore, containerScore, detailScore) + kindBonus;
  }

  /**
   * Get display for a symbol.
   */
  protected override getItemDisplay(symbol: SymbolEntry, _isSelected: boolean): ItemDisplay {
    const kindLabel = SYMBOL_LABELS[symbol.kind] ?? 'symbol';

    // Build secondary text
    let secondary = '';

    if (this.showFilePaths) {
      // Show file path for workspace symbols
      let filePath = symbol.uri;

      // Remove file:// prefix
      if (filePath.startsWith('file://')) {
        filePath = filePath.slice(7);
      }

      // Make relative to workspace root
      if (this.workspaceRoot && filePath.startsWith(this.workspaceRoot)) {
        filePath = filePath.slice(this.workspaceRoot.length);
        if (filePath.startsWith('/')) {
          filePath = filePath.slice(1);
        }
      }

      // Get just the filename for display
      const fileName = filePath.split('/').pop() ?? filePath;

      if (symbol.containerName) {
        secondary = `${symbol.containerName} · ${kindLabel} — ${fileName}`;
      } else {
        secondary = `${kindLabel} — ${fileName}`;
      }
    } else {
      // Simple display for document symbols
      secondary = symbol.containerName
        ? `${symbol.containerName} · ${kindLabel}`
        : kindLabel;
    }

    if (symbol.detail) {
      secondary += ` ${symbol.detail}`;
    }

    return {
      text: symbol.name,
      secondary,
      icon: SYMBOL_ICONS[symbol.kind] ?? '●',
      isCurrent: false,
    };
  }

  /**
   * Get unique ID for a symbol.
   */
  protected override getItemId(symbol: SymbolEntry): string {
    return `${symbol.uri}:${symbol.line}:${symbol.column}:${symbol.name}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Footer Override
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderFooter(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number
  ): void {
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const bg = this.callbacks.getThemeColor('panel.background', '#252526');

    // Item count (right aligned)
    const total = this.items.length;
    const filtered = this.filteredItems.length;
    const count = this.query ? `${filtered}/${total}` : `${total} symbols`;
    buffer.writeString(x + width - count.length - 1, y, count, dimFg, bg);
  }
}
