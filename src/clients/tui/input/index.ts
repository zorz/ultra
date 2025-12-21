/**
 * TUI Input
 *
 * Input handling and focus management.
 */

export {
  FocusManager,
  createFocusManager,
  type FocusChangeCallback,
  type FocusResolver,
} from './focus-manager.ts';

export {
  TUIInputHandler,
  createInputHandler,
  type KeyEventCallback,
  type MouseEventCallback,
  type ResizeCallback,
  type InputEventCallback,
} from './input-handler.ts';
