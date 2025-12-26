/**
 * Dialog Manager
 *
 * Central orchestrator for Promise-based dialogs.
 * Provides high-level API for showing dialogs and handling results.
 */

import type { OverlayManager, OverlayManagerCallbacks } from './overlay-manager.ts';
import type { DialogResult } from './promise-dialog.ts';
import { InputDialog, type InputDialogOptions } from './input-dialog.ts';
import { ConfirmDialog, type ConfirmDialogOptions } from './confirm-dialog.ts';
import { CommandPaletteDialog, type Command } from './command-palette.ts';
import { FilePickerDialog, type FileEntry } from './file-picker.ts';
import { GotoLineDialog, type GotoLineResult } from './goto-line-dialog.ts';
import { CommitDialog, type CommitDialogOptions, type CommitResult, type StagedFile } from './commit-dialog.ts';
import { SettingsDialog, type SettingsDialogOptions, type SettingItem } from './settings-dialog.ts';
import { KeybindingsDialog, type KeybindingsDialogOptions, type KeybindingItem } from './keybindings-dialog.ts';

// ============================================
// Types
// ============================================

/**
 * Command for the command palette.
 */
export type { Command };

/**
 * File entry for file picker.
 */
export type { FileEntry };

/**
 * Goto line result.
 */
export type { GotoLineResult };

/**
 * Commit result.
 */
export type { CommitResult, StagedFile };

/**
 * Setting item.
 */
export type { SettingItem };

/**
 * Keybinding item.
 */
export type { KeybindingItem };

/**
 * Options for command palette.
 */
export interface CommandPaletteOptions {
  /** Optional title */
  title?: string;
  /** Commands to display */
  commands: Command[];
  /** ID of command to highlight (e.g., current context) */
  highlightId?: string;
  /** Placeholder text */
  placeholder?: string;
}

/**
 * Options for file picker.
 */
export interface FilePickerOptions {
  /** Optional title */
  title?: string;
  /** Files to display */
  files: FileEntry[];
  /** Path of currently open file */
  currentPath?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Callback to load more files (async indexing) */
  onLoadMore?: () => Promise<FileEntry[]>;
}

// ============================================
// Dialog Manager
// ============================================

export class DialogManager {
  /** Overlay manager for registration */
  private overlayManager: OverlayManager;

  /** Callbacks for dialogs */
  private callbacks: OverlayManagerCallbacks;

  /** Lazily instantiated dialogs */
  private inputDialog: InputDialog | null = null;
  private confirmDialog: ConfirmDialog | null = null;
  private commandPaletteDialog: CommandPaletteDialog | null = null;
  private filePickerDialog: FilePickerDialog | null = null;
  private gotoLineDialog: GotoLineDialog | null = null;
  private commitDialog: CommitDialog | null = null;
  private settingsDialog: SettingsDialog | null = null;
  private keybindingsDialog: KeybindingsDialog | null = null;

  /** Currently active dialog ID */
  private activeDialogId: string | null = null;

  constructor(overlayManager: OverlayManager, callbacks: OverlayManagerCallbacks) {
    this.overlayManager = overlayManager;
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Queries
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if any dialog is currently active.
   */
  hasActiveDialog(): boolean {
    return this.activeDialogId !== null;
  }

  /**
   * Get the currently active dialog ID.
   */
  getActiveDialogId(): string | null {
    return this.activeDialogId;
  }

  /**
   * Dismiss the currently active dialog.
   */
  dismissActive(): void {
    if (this.activeDialogId) {
      const overlay = this.overlayManager.getOverlay(this.activeDialogId);
      if (overlay?.isVisible()) {
        overlay.hide();
      }
      this.activeDialogId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Dialog
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show an input dialog for text entry.
   */
  async showInput(options: InputDialogOptions): Promise<DialogResult<string>> {
    if (!this.inputDialog) {
      this.inputDialog = new InputDialog('dialog-input', this.callbacks);
      this.overlayManager.addOverlay(this.inputDialog);
    }

    this.activeDialogId = 'dialog-input';

    try {
      return await this.inputDialog.showWithOptions(options);
    } finally {
      this.activeDialogId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Confirm Dialog
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show a confirmation dialog.
   */
  async showConfirm(options: ConfirmDialogOptions): Promise<DialogResult<boolean>> {
    if (!this.confirmDialog) {
      this.confirmDialog = new ConfirmDialog('dialog-confirm', this.callbacks);
      this.overlayManager.addOverlay(this.confirmDialog);
    }

    this.activeDialogId = 'dialog-confirm';

    try {
      return await this.confirmDialog.showWithOptions(options);
    } finally {
      this.activeDialogId = null;
    }
  }

  /**
   * Show a "save before closing" confirmation dialog.
   * Returns: confirmed=true, value=true → Save
   *          confirmed=true, value=false → Don't Save
   *          cancelled=true → Cancel (abort close)
   */
  async showSaveConfirm(filename: string): Promise<DialogResult<boolean>> {
    return this.showConfirm({
      title: 'Save Changes',
      message: `Do you want to save the changes you made to ${filename}?\n\nYour changes will be lost if you don't save them.`,
      confirmText: 'Save',
      declineText: 'Discard',
      cancelText: 'Cancel',
      showCancel: true,
      defaultButton: 'confirm',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Command Palette
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the command palette.
   */
  async showCommandPalette(options: CommandPaletteOptions): Promise<DialogResult<Command>> {
    if (!this.commandPaletteDialog) {
      this.commandPaletteDialog = new CommandPaletteDialog('dialog-command-palette', this.callbacks);
      this.overlayManager.addOverlay(this.commandPaletteDialog);
    }

    this.activeDialogId = 'dialog-command-palette';

    try {
      return await this.commandPaletteDialog.showWithItems(
        {
          title: options.title ?? 'Command Palette',
          placeholder: options.placeholder ?? 'Type a command...',
          width: 60,
          height: 20,
        },
        options.commands,
        options.highlightId
      );
    } finally {
      this.activeDialogId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File Picker
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the file picker for quick open.
   */
  async showFilePicker(options: FilePickerOptions): Promise<DialogResult<FileEntry>> {
    if (!this.filePickerDialog) {
      this.filePickerDialog = new FilePickerDialog('dialog-file-picker', this.callbacks);
      this.overlayManager.addOverlay(this.filePickerDialog);
    }

    // Set the load more callback if provided
    if (options.onLoadMore) {
      this.filePickerDialog.setLoadMoreCallback(options.onLoadMore);
    }

    this.activeDialogId = 'dialog-file-picker';

    try {
      return await this.filePickerDialog.showWithItems(
        {
          title: options.title ?? 'Quick Open',
          placeholder: options.placeholder ?? 'Search files...',
          width: 70,
          height: 20,
        },
        options.files,
        options.currentPath
      );
    } finally {
      this.activeDialogId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Goto Line Dialog
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the goto line dialog.
   */
  async showGotoLine(currentLine?: number): Promise<DialogResult<GotoLineResult>> {
    if (!this.gotoLineDialog) {
      this.gotoLineDialog = new GotoLineDialog('dialog-goto-line', this.callbacks);
      this.overlayManager.addOverlay(this.gotoLineDialog);
    }

    this.activeDialogId = 'dialog-goto-line';

    try {
      return await this.gotoLineDialog.showWithCurrentLine(currentLine);
    } finally {
      this.activeDialogId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Commit Dialog
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the git commit dialog.
   */
  async showCommit(options: Omit<CommitDialogOptions, keyof import('./promise-dialog.ts').DialogConfig> & Partial<import('./promise-dialog.ts').DialogConfig>): Promise<DialogResult<CommitResult>> {
    if (!this.commitDialog) {
      this.commitDialog = new CommitDialog('dialog-commit', this.callbacks);
      this.overlayManager.addOverlay(this.commitDialog);
    }

    this.activeDialogId = 'dialog-commit';

    try {
      return await this.commitDialog.showWithOptions(options);
    } finally {
      this.activeDialogId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Settings Dialog
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the settings dialog.
   */
  async showSettings(options: Omit<SettingsDialogOptions, keyof import('./promise-dialog.ts').DialogConfig> & Partial<import('./promise-dialog.ts').DialogConfig>): Promise<DialogResult<SettingItem>> {
    if (!this.settingsDialog) {
      this.settingsDialog = new SettingsDialog('dialog-settings', this.callbacks);
      this.overlayManager.addOverlay(this.settingsDialog);
    }

    this.activeDialogId = 'dialog-settings';

    try {
      return await this.settingsDialog.showWithSettings(options);
    } finally {
      this.activeDialogId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keybindings Dialog
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the keybindings dialog.
   */
  async showKeybindings(options: Omit<KeybindingsDialogOptions, keyof import('./promise-dialog.ts').DialogConfig> & Partial<import('./promise-dialog.ts').DialogConfig>): Promise<DialogResult<KeybindingItem>> {
    if (!this.keybindingsDialog) {
      this.keybindingsDialog = new KeybindingsDialog('dialog-keybindings', this.callbacks);
      this.overlayManager.addOverlay(this.keybindingsDialog);
    }

    this.activeDialogId = 'dialog-keybindings';

    try {
      return await this.keybindingsDialog.showWithKeybindings(options);
    } finally {
      this.activeDialogId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove all dialogs from overlay manager.
   */
  dispose(): void {
    if (this.inputDialog) {
      this.overlayManager.removeOverlay('dialog-input');
      this.inputDialog = null;
    }
    if (this.confirmDialog) {
      this.overlayManager.removeOverlay('dialog-confirm');
      this.confirmDialog = null;
    }
    if (this.commandPaletteDialog) {
      this.overlayManager.removeOverlay('dialog-command-palette');
      this.commandPaletteDialog = null;
    }
    if (this.filePickerDialog) {
      this.overlayManager.removeOverlay('dialog-file-picker');
      this.filePickerDialog = null;
    }
    if (this.gotoLineDialog) {
      this.overlayManager.removeOverlay('dialog-goto-line');
      this.gotoLineDialog = null;
    }
    if (this.commitDialog) {
      this.overlayManager.removeOverlay('dialog-commit');
      this.commitDialog = null;
    }
    if (this.settingsDialog) {
      this.overlayManager.removeOverlay('dialog-settings');
      this.settingsDialog = null;
    }
    if (this.keybindingsDialog) {
      this.overlayManager.removeOverlay('dialog-keybindings');
      this.keybindingsDialog = null;
    }
    this.activeDialogId = null;
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new dialog manager.
 */
export function createDialogManager(
  overlayManager: OverlayManager,
  callbacks: OverlayManagerCallbacks
): DialogManager {
  return new DialogManager(overlayManager, callbacks);
}
