/**
 * Palette Entry Types
 *
 * Discriminated union types for command palette entries.
 * Using the 'entryType' discriminator field enables reliable type narrowing
 * without fragile type guards.
 *
 * @example
 * // Type narrowing is trivial with discriminated unions
 * if (entry.entryType === 'command') {
 *   // TypeScript knows entry is CommandEntry
 *   entry.command.handler();
 * } else {
 *   // TypeScript knows entry is PaletteItemEntry
 *   entry.item.handler();
 * }
 */

import type { Command } from '../../input/commands.ts';

/**
 * Custom palette item for non-command selections
 */
export interface PaletteItem {
  /** Unique identifier */
  id: string;
  /** Display title */
  title: string;
  /** Optional category for grouping */
  category?: string;
  /** Handler function */
  handler: () => void | Promise<void>;
  /** Optional description */
  description?: string;
  /** Optional icon */
  icon?: string;
  /** Optional keybinding display string */
  keybinding?: string;
}

/**
 * Wrapper for Command entries with discriminator
 */
export interface CommandEntry {
  /** Discriminator field for type narrowing */
  entryType: 'command';
  /** The command */
  command: Command;
  /** Optional highlight (for showing current selection) */
  highlight?: boolean;
}

/**
 * Wrapper for PaletteItem entries with discriminator
 */
export interface PaletteItemEntry {
  /** Discriminator field for type narrowing */
  entryType: 'item';
  /** The palette item */
  item: PaletteItem;
  /** Optional highlight (for showing current selection) */
  highlight?: boolean;
}

/**
 * Discriminated union of palette entries
 *
 * Using the entryType field, TypeScript can narrow types reliably:
 * ```typescript
 * if (entry.entryType === 'command') {
 *   // entry.command is available
 * } else {
 *   // entry.item is available
 * }
 * ```
 */
export type PaletteEntry = CommandEntry | PaletteItemEntry;

/**
 * Type guard using discriminator (safe and reliable)
 */
export function isCommandEntry(entry: PaletteEntry): entry is CommandEntry {
  return entry.entryType === 'command';
}

/**
 * Type guard using discriminator (safe and reliable)
 */
export function isPaletteItemEntry(entry: PaletteEntry): entry is PaletteItemEntry {
  return entry.entryType === 'item';
}

/**
 * Create a command entry from a Command
 */
export function createCommandEntry(command: Command, highlight?: boolean): CommandEntry {
  return {
    entryType: 'command',
    command,
    highlight,
  };
}

/**
 * Create a palette item entry
 */
export function createPaletteItemEntry(item: PaletteItem, highlight?: boolean): PaletteItemEntry {
  return {
    entryType: 'item',
    item,
    highlight,
  };
}

/**
 * Convert commands to palette entries
 */
export function commandsToEntries(commands: Command[]): CommandEntry[] {
  return commands.map(command => createCommandEntry(command));
}

/**
 * Convert palette items to entries
 */
export function itemsToEntries(items: PaletteItem[], highlightId?: string): PaletteItemEntry[] {
  return items.map(item => createPaletteItemEntry(item, item.id === highlightId));
}

/**
 * Get the display title from any entry type
 */
export function getEntryTitle(entry: PaletteEntry): string {
  return entry.entryType === 'command' ? entry.command.title : entry.item.title;
}

/**
 * Get the ID from any entry type
 */
export function getEntryId(entry: PaletteEntry): string {
  return entry.entryType === 'command' ? entry.command.id : entry.item.id;
}

/**
 * Get the category from any entry type
 */
export function getEntryCategory(entry: PaletteEntry): string | undefined {
  return entry.entryType === 'command' ? entry.command.category : entry.item.category;
}

/**
 * Execute the handler for any entry type
 */
export async function executeEntry(entry: PaletteEntry): Promise<void> {
  if (entry.entryType === 'command') {
    await entry.command.handler();
  } else {
    await entry.item.handler();
  }
}

/**
 * Check if entry should be highlighted
 */
export function isHighlighted(entry: PaletteEntry): boolean {
  return entry.highlight ?? false;
}
