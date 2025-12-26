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

export {
  CommitDialog,
  type CommitDialogOptions,
  type CommitResult,
  type StagedFile,
} from './commit-dialog.ts';

export {
  SettingsDialog,
  type SettingsDialogOptions,
  type SettingsDialogCallbacks,
  type SettingItem,
} from './settings-dialog.ts';

export {
  inferSettingType,
  getEnumOptions,
  getSettingDescription,
  isMultilineSetting,
  getSettingCategory,
  buildSettingItem,
  parseSettingValue,
  validateNumberSetting,
  ENUM_OPTIONS,
  MULTILINE_SETTINGS,
  SETTING_DESCRIPTIONS,
  type SettingType,
} from './settings-utils.ts';

export {
  KeybindingsDialog,
  type KeybindingsDialogOptions,
  type KeybindingsDialogCallbacks,
  type KeybindingItem,
  type CommandInfo,
} from './keybindings-dialog.ts';

export {
  FileBrowserDialog,
  type FileBrowserConfig,
} from './file-browser-dialog.ts';

export {
  SaveAsDialog,
  type SaveAsConfig,
} from './save-as-dialog.ts';

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

// LSP overlays
export {
  AutocompletePopup,
  createAutocompletePopup,
  type AutocompleteItem,
  type CompletionSelectCallback,
  type CompletionDismissCallback,
} from './autocomplete-popup.ts';

export {
  HoverTooltip,
  createHoverTooltip,
} from './hover-tooltip.ts';

export {
  SignatureHelpOverlay,
  createSignatureHelp,
  type SignatureDisplayMode,
} from './signature-help.ts';

export {
  ReferencesPicker,
  createReferencesPicker,
  type ReferenceItem,
  type ReferencePreviewLoader,
} from './references-picker.ts';
