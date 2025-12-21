/**
 * TUI Client
 *
 * Main entry point for the Terminal User Interface client.
 */

export { TUIClient, createTUIClient, type TUIClientOptions, type OpenFileOptions } from './tui-client.ts';

export {
  ThemeAdapter,
  createThemeAdapter,
  DEFAULT_THEME,
  DEFAULT_THEME_COLORS,
  type ThemeChangeCallback,
} from './theme-adapter.ts';

export {
  KeybindingAdapter,
  createKeybindingAdapter,
  DEFAULT_KEYBINDINGS,
  type CommandHandler,
  type ContextProvider,
} from './keybinding-adapter.ts';
