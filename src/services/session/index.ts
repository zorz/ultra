/**
 * Session Service
 *
 * Provides settings, session, keybinding, and theme management.
 */

// Types
export type {
  EditorSettings,
  SessionDocumentState,
  SessionUIState,
  SessionLayoutNode,
  SessionState,
  SessionInfo,
  KeyBinding,
  ParsedKey,
  ThemeInfo,
  ThemeColors,
  Theme,
  TokenColor,
  SettingsSchemaProperty,
  SettingsSchema,
  ValidationResult,
  SettingChangeEvent,
  SessionChangeEvent,
  SettingChangeCallback,
  SessionChangeCallback,
  Unsubscribe,
} from './types.ts';

// Errors
export { SessionError, SessionErrorCode } from './errors.ts';

// Schema
export {
  settingsSchema,
  getDefaultValue,
  getAllDefaults,
  validateSetting,
  isValidSettingKey,
} from './schema.ts';

// Interface
export type { SessionService } from './interface.ts';

// Implementation
export { LocalSessionService, localSessionService, type SessionPathsConfig } from './local.ts';

// Adapter
export { SessionServiceAdapter, SessionECPErrorCodes } from './adapter.ts';
