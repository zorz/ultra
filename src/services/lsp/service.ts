/**
 * Local LSP Service Implementation
 *
 * Implements LSPService using local language server processes.
 * Wraps the existing LSPClient and provides a clean service interface.
 */

import { debugLog as globalDebugLog } from '../../debug.ts';
import { LSPClient } from './client.ts';
import type { LSPService } from './interface.ts';
import { LSPError, LSPErrorCode } from './errors.ts';
import {
  type LSPPosition,
  type LSPLocation,
  type LSPDiagnostic,
  type LSPCompletionItem,
  type LSPHover,
  type LSPSignatureHelp,
  type LSPDocumentSymbol,
  type LSPSymbolInformation,
  type ServerConfig,
  type ServerStatus,
  type ServerInfo,
  type WorkspaceEdit,
  type DiagnosticsCallback,
  type ServerStatusCallback,
  type Unsubscribe,
  EXTENSION_TO_LANGUAGE,
  DEFAULT_SERVERS,
} from './types.ts';

/**
 * Local LSP Service.
 *
 * Manages language server lifecycle and provides code intelligence features.
 */
export class LocalLSPService implements LSPService {
  private _debugName = 'LocalLSPService';
  private clients = new Map<string, LSPClient>();
  private documentVersions = new Map<string, number>();
  private documentLanguages = new Map<string, string>();
  private workspaceRoot: string = process.cwd();
  private enabled = true;
  private failedServers = new Set<string>();
  private customConfigs = new Map<string, ServerConfig>();

  // Diagnostics
  private diagnosticsStore = new Map<string, LSPDiagnostic[]>();
  private diagnosticsCallbacks = new Set<DiagnosticsCallback>();

  // Status events
  private statusCallbacks = new Set<ServerStatusCallback>();

  constructor() {
    this.debugLog('Initialized');
  }

  protected debugLog(msg: string): void {
    globalDebugLog(`[${this._debugName}] ${msg}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Server Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async startServer(languageId: string, workspaceUri: string): Promise<ServerInfo> {
    if (!this.enabled) {
      throw LSPError.disabled();
    }

    // Already have a running client
    if (this.clients.has(languageId)) {
      const client = this.clients.get(languageId)!;
      return {
        languageId,
        ready: client.isInitialized(),
        capabilities: client.getCapabilities(),
      };
    }

    // Get server config
    const config = this.getServerConfig(languageId);
    if (!config) {
      throw LSPError.serverNotFound(languageId);
    }

    // Check if command exists
    const exists = await this.commandExists(config.command);
    if (!exists) {
      this.failedServers.add(languageId);
      this.emitStatusChange({
        languageId,
        status: 'error',
        error: `Command not found: ${config.command}`,
      });
      throw LSPError.serverStartFailed(languageId, `Command not found: ${config.command}`);
    }

    // Extract workspace path from URI
    const workspacePath = workspaceUri.replace(/^file:\/\//, '');

    // Emit starting status
    this.emitStatusChange({ languageId, status: 'starting' });

    // Start the client
    const client = new LSPClient(config.command, config.args, workspacePath);

    // Set up notification handler
    client.onNotification((method, params) => {
      this.handleNotification(languageId, method, params);
    });

    const started = await client.start();
    if (!started) {
      this.failedServers.add(languageId);
      this.emitStatusChange({
        languageId,
        status: 'error',
        error: 'Failed to start language server',
      });
      throw LSPError.serverStartFailed(languageId);
    }

    this.clients.set(languageId, client);
    this.debugLog(`Started server for ${languageId}`);

    // Emit ready status
    this.emitStatusChange({
      languageId,
      status: 'ready',
      capabilities: client.getCapabilities(),
    });

    return {
      languageId,
      ready: true,
      capabilities: client.getCapabilities(),
    };
  }

  async stopServer(languageId: string): Promise<void> {
    const client = this.clients.get(languageId);
    if (client) {
      await client.shutdown();
      this.clients.delete(languageId);
      this.debugLog(`Stopped server for ${languageId}`);

      // Emit stopped status
      this.emitStatusChange({ languageId, status: 'stopped' });
    }
  }

  getServerStatus(languageId?: string): ServerStatus[] {
    const statuses: ServerStatus[] = [];

    if (languageId) {
      // Single language
      const client = this.clients.get(languageId);
      if (client) {
        statuses.push({
          languageId,
          status: client.isInitialized() ? 'ready' : 'starting',
          capabilities: client.getCapabilities(),
        });
      } else if (this.failedServers.has(languageId)) {
        statuses.push({
          languageId,
          status: 'error',
          error: 'Server failed to start',
        });
      } else {
        statuses.push({
          languageId,
          status: 'stopped',
        });
      }
    } else {
      // All languages
      for (const [lang, client] of this.clients) {
        statuses.push({
          languageId: lang,
          status: client.isInitialized() ? 'ready' : 'starting',
          capabilities: client.getCapabilities(),
        });
      }

      for (const lang of this.failedServers) {
        if (!this.clients.has(lang)) {
          statuses.push({
            languageId: lang,
            status: 'error',
            error: 'Server failed to start',
          });
        }
      }
    }

    return statuses;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.shutdown();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Document Sync
  // ─────────────────────────────────────────────────────────────────────────

  async documentOpened(uri: string, languageId: string, content: string): Promise<void> {
    this.debugLog(`documentOpened: ${uri} (${languageId})`);

    // Try to start server if not already running
    let client = this.clients.get(languageId);
    if (!client && !this.failedServers.has(languageId)) {
      try {
        await this.startServer(languageId, `file://${this.workspaceRoot}`);
        client = this.clients.get(languageId);
      } catch {
        // Server failed to start, continue without LSP
        return;
      }
    }

    if (!client) {
      return;
    }

    const version = 1;
    this.documentVersions.set(uri, version);
    this.documentLanguages.set(uri, languageId);

    client.didOpen(uri, languageId, version, content);
  }

  async documentChanged(uri: string, content: string, version: number): Promise<void> {
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) {
      return;
    }

    const client = this.clients.get(languageId);
    if (!client) {
      return;
    }

    this.documentVersions.set(uri, version);
    client.didChange(uri, version, content);
  }

  async documentSaved(uri: string, content?: string): Promise<void> {
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) {
      return;
    }

    const client = this.clients.get(languageId);
    if (!client) {
      return;
    }

    client.didSave(uri, content);
  }

  async documentClosed(uri: string): Promise<void> {
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) {
      return;
    }

    const client = this.clients.get(languageId);
    if (client) {
      client.didClose(uri);
    }

    this.documentVersions.delete(uri);
    this.documentLanguages.delete(uri);
    this.diagnosticsStore.delete(uri);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Code Intelligence
  // ─────────────────────────────────────────────────────────────────────────

  async getCompletions(uri: string, position: LSPPosition): Promise<LSPCompletionItem[]> {
    const client = this.getClientForDocument(uri);
    if (!client) {
      return [];
    }

    try {
      return await client.getCompletions(uri, position);
    } catch (error) {
      this.debugLog(`getCompletions error: ${error}`);
      return [];
    }
  }

  async getHover(uri: string, position: LSPPosition): Promise<LSPHover | null> {
    const client = this.getClientForDocument(uri);
    if (!client) {
      return null;
    }

    try {
      return await client.getHover(uri, position);
    } catch (error) {
      this.debugLog(`getHover error: ${error}`);
      return null;
    }
  }

  async getSignatureHelp(uri: string, position: LSPPosition): Promise<LSPSignatureHelp | null> {
    const client = this.getClientForDocument(uri);
    if (!client) {
      return null;
    }

    try {
      return await client.getSignatureHelp(uri, position);
    } catch (error) {
      this.debugLog(`getSignatureHelp error: ${error}`);
      return null;
    }
  }

  async getDefinition(uri: string, position: LSPPosition): Promise<LSPLocation[]> {
    const client = this.getClientForDocument(uri);
    if (!client) {
      return [];
    }

    try {
      const result = await client.getDefinition(uri, position);
      if (!result) {
        return [];
      }
      return Array.isArray(result) ? result : [result];
    } catch (error) {
      this.debugLog(`getDefinition error: ${error}`);
      return [];
    }
  }

  async getReferences(
    uri: string,
    position: LSPPosition,
    includeDeclaration = true
  ): Promise<LSPLocation[]> {
    const client = this.getClientForDocument(uri);
    if (!client) {
      return [];
    }

    try {
      return await client.getReferences(uri, position, includeDeclaration);
    } catch (error) {
      this.debugLog(`getReferences error: ${error}`);
      return [];
    }
  }

  async getDocumentSymbols(uri: string): Promise<LSPDocumentSymbol[] | LSPSymbolInformation[]> {
    const client = this.getClientForDocument(uri);
    if (!client) {
      return [];
    }

    try {
      return await client.getDocumentSymbols(uri);
    } catch (error) {
      this.debugLog(`getDocumentSymbols error: ${error}`);
      return [];
    }
  }

  async rename(uri: string, position: LSPPosition, newName: string): Promise<WorkspaceEdit | null> {
    const client = this.getClientForDocument(uri);
    if (!client) {
      return null;
    }

    try {
      const result = await client.rename(uri, position, newName);
      return result as WorkspaceEdit | null;
    } catch (error) {
      this.debugLog(`rename error: ${error}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Diagnostics
  // ─────────────────────────────────────────────────────────────────────────

  getDiagnostics(uri: string): LSPDiagnostic[] {
    return this.diagnosticsStore.get(uri) || [];
  }

  getAllDiagnostics(): Map<string, LSPDiagnostic[]> {
    return new Map(this.diagnosticsStore);
  }

  getDiagnosticsSummary(): { errors: number; warnings: number } {
    let errors = 0;
    let warnings = 0;

    for (const diagnostics of this.diagnosticsStore.values()) {
      for (const d of diagnostics) {
        if (d.severity === 1) errors++;
        else if (d.severity === 2) warnings++;
      }
    }

    return { errors, warnings };
  }

  onDiagnostics(callback: DiagnosticsCallback): Unsubscribe {
    this.diagnosticsCallbacks.add(callback);
    return () => {
      this.diagnosticsCallbacks.delete(callback);
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  setServerConfig(languageId: string, config: ServerConfig): void {
    this.customConfigs.set(languageId, config);
    this.debugLog(`Set custom config for ${languageId}`);
  }

  getServerConfig(languageId: string): ServerConfig | null {
    // Check custom config first
    const custom = this.customConfigs.get(languageId);
    if (custom) {
      return custom;
    }

    // Use default
    return DEFAULT_SERVERS[languageId] || null;
  }

  getLanguageId(filePath: string): string | null {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    return EXTENSION_TO_LANGUAGE[ext] || null;
  }

  hasServerFor(languageId: string): boolean {
    return this.customConfigs.has(languageId) || languageId in DEFAULT_SERVERS;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  onServerStatusChange(callback: ServerStatusCallback): Unsubscribe {
    this.statusCallbacks.add(callback);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  async shutdown(): Promise<void> {
    const shutdownPromises = Array.from(this.clients.values()).map((client) =>
      client.shutdown()
    );
    await Promise.all(shutdownPromises);

    this.clients.clear();
    this.documentVersions.clear();
    this.documentLanguages.clear();
    this.diagnosticsStore.clear();
    this.failedServers.clear();

    this.debugLog('Shutdown complete');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private getClientForDocument(uri: string): LSPClient | null {
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) {
      return null;
    }
    return this.clients.get(languageId) || null;
  }

  private async commandExists(command: string): Promise<boolean> {
    try {
      const proc = Bun.spawn(['which', command], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  private handleNotification(languageId: string, method: string, params: unknown): void {
    this.debugLog(`Notification from ${languageId}: ${method}`);

    if (method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = params as { uri: string; diagnostics: LSPDiagnostic[] };
      this.diagnosticsStore.set(uri, diagnostics);

      // Notify callbacks
      for (const callback of this.diagnosticsCallbacks) {
        try {
          callback(uri, diagnostics);
        } catch (error) {
          this.debugLog(`Diagnostics callback error: ${error}`);
        }
      }
    }
  }

  private emitStatusChange(status: ServerStatus): void {
    for (const callback of this.statusCallbacks) {
      try {
        callback(status);
      } catch (error) {
        this.debugLog(`Status callback error: ${error}`);
      }
    }
  }
}

export const localLSPService = new LocalLSPService();
export default localLSPService;
