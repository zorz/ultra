/**
 * Command Palette Dialog
 *
 * Searchable command list with fuzzy matching.
 * Uses Promise-based result handling.
 */

import { SearchableDialog, type ItemDisplay } from './searchable-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';

// ============================================
// Types
// ============================================

/**
 * A command for the command palette.
 */
export interface Command {
  /** Unique command ID */
  id: string;
  /** Display label */
  label: string;
  /** Optional category for grouping */
  category?: string;
  /** Keyboard shortcut hint */
  keybinding?: string;
  /** Optional description */
  description?: string;
}

// ============================================
// Command Palette Dialog
// ============================================

/**
 * Promise-based command palette with fuzzy search.
 * Returns selected command via Promise when closed.
 */
export class CommandPaletteDialog extends SearchableDialog<Command> {
  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
    this.zIndex = 200; // Above other dialogs
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Abstract Implementation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Score a command against the query.
   */
  protected override scoreItem(command: Command, query: string): number {
    // Score against label (primary)
    const labelScore = this.combinedScore(command.label, query);

    // Score against category if present
    let categoryScore = 0;
    if (command.category) {
      categoryScore = this.combinedScore(command.category, query) * 0.5;
    }

    // Score against command ID (e.g., "file.save" matches "fs")
    const idScore = this.combinedScore(command.id, query) * 0.3;

    // Score against description
    let descScore = 0;
    if (command.description) {
      descScore = this.combinedScore(command.description, query) * 0.2;
    }

    return Math.max(labelScore, categoryScore, idScore, descScore);
  }

  /**
   * Get display for a command.
   */
  protected override getItemDisplay(command: Command, _isSelected: boolean): ItemDisplay {
    // Label is the main text, keybinding field contains "^S  File" style suffix
    return {
      text: command.label,
      secondary: command.keybinding,
    };
  }

  /**
   * Get unique ID for a command.
   */
  protected override getItemId(command: Command): string {
    return command.id;
  }
}
