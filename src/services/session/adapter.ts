/**
 * Session Service ECP Adapter
 *
 * Maps ECP JSON-RPC calls to SessionService methods.
 */

import type { SessionService } from './interface.ts';
import { SessionError } from './errors.ts';
import type { EditorSettings } from '../../config/settings.ts';
import type { KeyBinding, ParsedKey } from './types.ts';

/**
 * ECP error codes (JSON-RPC 2.0 compatible).
 */
export const SessionECPErrorCodes = {
  // Standard JSON-RPC errors
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,

  // Session service errors (-32300 to -32399)
  SettingNotFound: -32300,
  InvalidValue: -32301,
  SessionNotFound: -32302,
  ThemeNotFound: -32303,
  InvalidKeybinding: -32304,
  NotInitialized: -32305,
} as const;

/**
 * JSON-RPC error response.
 */
interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Handler result type.
 */
type HandlerResult<T> = { result: T } | { error: JsonRpcError };

/**
 * Session Service Adapter for ECP protocol.
 *
 * Handles JSON-RPC method routing and error conversion.
 */
export class SessionServiceAdapter {
  constructor(private readonly service: SessionService) {}

  /**
   * Handle an ECP request.
   *
   * @param method The method name (e.g., "config/get")
   * @param params The request parameters
   * @returns The method result
   */
  async handleRequest(method: string, params: unknown): Promise<HandlerResult<unknown>> {
    try {
      switch (method) {
        // Settings
        case 'config/get':
          return this.configGet(params);
        case 'config/set':
          return this.configSet(params);
        case 'config/getAll':
          return this.configGetAll();
        case 'config/reset':
          return this.configReset(params);
        case 'config/schema':
          return this.configSchema();

        // Sessions (async methods must be awaited for try/catch to work)
        case 'session/save':
          return await this.sessionSave(params);
        case 'session/load':
          return await this.sessionLoad(params);
        case 'session/list':
          return await this.sessionList();
        case 'session/delete':
          return await this.sessionDelete(params);
        case 'session/current':
          return this.sessionCurrent();

        // Keybindings
        case 'keybindings/get':
          return this.keybindingsGet();
        case 'keybindings/set':
          return this.keybindingsSet(params);
        case 'keybindings/add':
          return this.keybindingsAdd(params);
        case 'keybindings/remove':
          return this.keybindingsRemove(params);
        case 'keybindings/resolve':
          return this.keybindingsResolve(params);

        // Themes
        case 'theme/list':
          return this.themeList();
        case 'theme/get':
          return this.themeGet(params);
        case 'theme/set':
          return this.themeSet(params);
        case 'theme/current':
          return this.themeCurrent();

        default:
          return {
            error: {
              code: SessionECPErrorCodes.MethodNotFound,
              message: `Method not found: ${method}`,
            },
          };
      }
    } catch (error) {
      return { error: this.toJsonRpcError(error) };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Settings handlers
  // ─────────────────────────────────────────────────────────────────────────

  private configGet(params: unknown): HandlerResult<{ value: unknown }> {
    const p = params as { key: string };
    if (!p?.key) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'key is required' } };
    }

    const value = this.service.getSetting(p.key as keyof EditorSettings);
    return { result: { value } };
  }

  private configSet(params: unknown): HandlerResult<{ success: boolean }> {
    const p = params as { key: string; value: unknown };
    if (!p?.key || p.value === undefined) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'key and value are required' } };
    }

    this.service.setSetting(p.key as keyof EditorSettings, p.value as EditorSettings[keyof EditorSettings]);
    return { result: { success: true } };
  }

  private configGetAll(): HandlerResult<{ settings: EditorSettings }> {
    const settings = this.service.getAllSettings();
    return { result: { settings } };
  }

  private configReset(params: unknown): HandlerResult<{ success: boolean }> {
    const p = params as { key?: string };
    this.service.resetSettings(p?.key as keyof EditorSettings | undefined);
    return { result: { success: true } };
  }

  private configSchema(): HandlerResult<unknown> {
    const schema = this.service.getSettingsSchema();
    return { result: { schema } };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Session handlers
  // ─────────────────────────────────────────────────────────────────────────

  private async sessionSave(params: unknown): Promise<HandlerResult<{ sessionId: string }>> {
    const p = params as { name?: string };
    const sessionId = await this.service.saveSession(p?.name);
    return { result: { sessionId } };
  }

  private async sessionLoad(params: unknown): Promise<HandlerResult<unknown>> {
    const p = params as { sessionId: string };
    if (!p?.sessionId) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'sessionId is required' } };
    }

    const state = await this.service.loadSession(p.sessionId);
    return { result: state };
  }

  private async sessionList(): Promise<HandlerResult<unknown>> {
    const sessions = await this.service.listSessions();
    return { result: { sessions } };
  }

  private async sessionDelete(params: unknown): Promise<HandlerResult<{ success: boolean }>> {
    const p = params as { sessionId: string };
    if (!p?.sessionId) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'sessionId is required' } };
    }

    await this.service.deleteSession(p.sessionId);
    return { result: { success: true } };
  }

  private sessionCurrent(): HandlerResult<unknown> {
    const state = this.service.getCurrentSession();
    return { result: state };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keybindings handlers
  // ─────────────────────────────────────────────────────────────────────────

  private keybindingsGet(): HandlerResult<{ bindings: KeyBinding[] }> {
    const bindings = this.service.getKeybindings();
    return { result: { bindings } };
  }

  private keybindingsSet(params: unknown): HandlerResult<{ success: boolean }> {
    const p = params as { bindings: KeyBinding[] };
    if (!p?.bindings || !Array.isArray(p.bindings)) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'bindings array is required' } };
    }

    this.service.setKeybindings(p.bindings);
    return { result: { success: true } };
  }

  private keybindingsAdd(params: unknown): HandlerResult<{ success: boolean }> {
    const p = params as { binding: KeyBinding };
    if (!p?.binding || !p.binding.key || !p.binding.command) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'binding with key and command is required' } };
    }

    this.service.addKeybinding(p.binding);
    return { result: { success: true } };
  }

  private keybindingsRemove(params: unknown): HandlerResult<{ success: boolean }> {
    const p = params as { key: string };
    if (!p?.key) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'key is required' } };
    }

    this.service.removeKeybinding(p.key);
    return { result: { success: true } };
  }

  private keybindingsResolve(params: unknown): HandlerResult<{ command: string | null }> {
    const p = params as { key: ParsedKey };
    if (!p?.key) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'key is required' } };
    }

    const command = this.service.resolveKeybinding(p.key);
    return { result: { command } };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Theme handlers
  // ─────────────────────────────────────────────────────────────────────────

  private themeList(): HandlerResult<unknown> {
    const themes = this.service.listThemes();
    return { result: { themes } };
  }

  private themeGet(params: unknown): HandlerResult<unknown> {
    const p = params as { themeId: string };
    if (!p?.themeId) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'themeId is required' } };
    }

    const theme = this.service.getTheme(p.themeId);
    if (!theme) {
      return { error: { code: SessionECPErrorCodes.ThemeNotFound, message: `Theme not found: ${p.themeId}` } };
    }

    return { result: { theme } };
  }

  private themeSet(params: unknown): HandlerResult<{ success: boolean }> {
    const p = params as { themeId: string };
    if (!p?.themeId) {
      return { error: { code: SessionECPErrorCodes.InvalidParams, message: 'themeId is required' } };
    }

    this.service.setTheme(p.themeId);
    return { result: { success: true } };
  }

  private themeCurrent(): HandlerResult<unknown> {
    const theme = this.service.getCurrentTheme();
    return { result: { theme } };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private toJsonRpcError(error: unknown): JsonRpcError {
    if (error instanceof SessionError) {
      // Map SessionError codes to ECP error codes
      let code: number = SessionECPErrorCodes.InternalError;
      switch (error.code) {
        case 'SETTING_NOT_FOUND':
          code = SessionECPErrorCodes.SettingNotFound;
          break;
        case 'INVALID_VALUE':
          code = SessionECPErrorCodes.InvalidValue;
          break;
        case 'SESSION_NOT_FOUND':
          code = SessionECPErrorCodes.SessionNotFound;
          break;
        case 'THEME_NOT_FOUND':
          code = SessionECPErrorCodes.ThemeNotFound;
          break;
        case 'INVALID_KEYBINDING':
          code = SessionECPErrorCodes.InvalidKeybinding;
          break;
        case 'NOT_INITIALIZED':
          code = SessionECPErrorCodes.NotInitialized;
          break;
      }

      return {
        code,
        message: error.message,
        data: error.data,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      code: SessionECPErrorCodes.InternalError,
      message,
    };
  }
}
