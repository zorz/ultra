/**
 * TUI Overlays
 *
 * Overlay management for dialogs, command palette, and notifications.
 */

export {
  OverlayManager,
  BaseDialog,
  createOverlayManager,
  type Overlay,
  type OverlayManagerCallbacks,
  type NotificationType,
  type Notification,
} from './overlay-manager.ts';

export {
  CommandPalette,
  createCommandPalette,
  type Command,
  type CommandPaletteCallbacks,
} from './command-palette.ts';

export {
  FilePicker,
  createFilePicker,
  type FileEntry,
  type FilePickerCallbacks,
} from './file-picker.ts';

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
