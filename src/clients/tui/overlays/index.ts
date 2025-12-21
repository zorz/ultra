/**
 * TUI Overlays
 *
 * Overlay management for dialogs, command palette, and notifications.
 */

// Overlay manager and base dialog
export {
  OverlayManager,
  BaseDialog,
  createOverlayManager,
  type Overlay,
  type OverlayManagerCallbacks,
  type NotificationType,
  type Notification,
} from './overlay-manager.ts';

// Promise-based dialog base classes
export {
  PromiseDialog,
  type DialogResult,
  type DialogCloseReason,
  type DialogConfig,
} from './promise-dialog.ts';

export {
  SearchableDialog,
  type ScoredItem,
  type ItemDisplay,
  type SearchableDialogConfig,
} from './searchable-dialog.ts';

// Dialog manager
export {
  DialogManager,
  createDialogManager,
  type CommandPaletteOptions,
  type FilePickerOptions,
} from './dialog-manager.ts';

// Concrete dialogs
export {
  InputDialog,
  type InputDialogOptions,
} from './input-dialog.ts';

export {
  ConfirmDialog,
  type ConfirmDialogOptions,
} from './confirm-dialog.ts';

export {
  GotoLineDialog as GotoLineDialogNew,
  type GotoLineResult,
} from './goto-line-dialog.ts';

export {
  CommandPaletteDialog,
  type Command,
} from './command-palette.ts';

export {
  FilePickerDialog,
  type FileEntry,
} from './file-picker.ts';

// Other overlays
export {
  SearchReplaceDialog,
  createSearchReplaceDialog,
  type SearchOptions,
  type SearchMatch,
  type SearchReplaceCallbacks,
} from './search-replace.ts';

export {
  GotoLineDialog,
  createGotoLineDialog,
  type GotoLineCallbacks,
} from './goto-line.ts';
