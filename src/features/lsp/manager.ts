/**
 * LSP Manager
 * 
 * Manages language server instances per language.
 * Handles server detection, lifecycle, and document routing.
 */

import { LSPClient, type LSPDiagnostic, type LSPPosition, type LSPCompletionItem, type LSPHover, type LSPLocation } from './client.ts';
import { settings } from '../../config/settings.ts';
import * as fs from 'fs';
import * as path from 'path';

// Language server configurations
interface ServerConfig {
  command: string;
  args: string[];
}

// Default server configurations
// Requires: npm install -g typescript-language-server typescript
const DEFAULT_SERVERS: Record<string, ServerConfig> = {
  typescript: { command: 'typescript-language-server', args: ['--stdio'] },
  javascript: { command: 'typescript-language-server', args: ['--stdio'] },
  typescriptreact: { command: 'typescript-language-server', args: ['--stdio'] },
  javascriptreact: { command: 'typescript-language-server', args: ['--stdio'] },
  rust: { command: 'rust-analyzer', args: [] },
  python: { command: 'pylsp', args: [] },
  go: { command: 'gopls', args: [] },
  ruby: { command: 'solargraph', args: ['stdio'] },
  c: { command: 'clangd', args: [] },
  cpp: { command: 'clangd', args: [] },
  json: { command: 'vscode-json-language-server', args: ['--stdio'] },
  html: { command: 'vscode-html-language-server', args: ['--stdio'] },
  css: { command: 'vscode-css-language-server', args: ['--stdio'] },
};

// File extension to language ID mapping
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.rs': 'rust',
  '.py': 'python',
  '.go': 'go',
  '.rb': 'ruby',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'hpp',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
};

import { appendFileSync } from 'fs';

// Diagnostics callback type
export type DiagnosticsCallback = (uri: string, diagnostics: LSPDiagnostic[]) => void;

// Debug log file path
const DEBUG_LOG_PATH = './debug.log';

// Debug log function - writes to file
// Enable by default for now to debug LSP issues
let debugEnabled = true;
const debugLog = (...args: unknown[]) => {
  if (debugEnabled) {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [LSP] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
    try {
      appendFileSync(DEBUG_LOG_PATH, message);
    } catch {
      // Ignore write errors
    }
  }
};

// Export for use by client
export { debugLog, DEBUG_LOG_PATH };

/**
 * LSP Manager - singleton that manages all language servers
 */
export class LSPManager {
  private clients = new Map<string, LSPClient>();  // languageId -> client
  private documentVersions = new Map<string, number>();  // uri -> version
  private documentLanguages = new Map<string, string>();  // uri -> languageId
  private workspaceRoot: string = process.cwd();
  private enabled: boolean = true;
  private failedServers = new Set<string>();  // Servers we failed to start
  private diagnosticsCallback: DiagnosticsCallback | null = null;
  private diagnosticsStore = new Map<string, LSPDiagnostic[]>();  // uri -> diagnostics
  private startupErrors: string[] = [];  // Track startup errors

  /**
   * Enable debug logging
   */
  setDebug(enabled: boolean): void {
    debugEnabled = enabled;
    // Also enable on existing clients
    for (const client of this.clients.values()) {
      client.debugEnabled = enabled;
    }
  }

  /**
   * Get debug status info
   */
  getDebugInfo(): string {
    const info: string[] = [];
    info.push(`Workspace: ${this.workspaceRoot}`);
    info.push(`Enabled: ${this.enabled}`);
    info.push(`Active clients: ${this.clients.size}`);
    for (const [lang, client] of this.clients) {
      info.push(`  - ${lang}: ${client.isInitialized() ? 'ready' : 'initializing'}`);
    }
    info.push(`Open documents: ${this.documentLanguages.size}`);
    for (const [uri, lang] of this.documentLanguages) {
      const version = this.documentVersions.get(uri) || 0;
      info.push(`  - ${uri} (${lang}) v${version}`);
    }
    info.push(`Failed servers: ${this.failedServers.size}`);
    for (const server of this.failedServers) {
      info.push(`  - ${server}`);
    }
    if (this.startupErrors.length > 0) {
      info.push(`Startup errors:`);
      for (const err of this.startupErrors) {
        info.push(`  - ${err}`);
      }
    }
    return info.join('\n');
  }

  /**
   * Set the workspace root directory
   */
  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  /**
   * Enable or disable LSP
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.shutdownAll();
    }
  }

  /**
   * Check if LSP is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set diagnostics callback
   */
  onDiagnostics(callback: DiagnosticsCallback): void {
    this.diagnosticsCallback = callback;
  }

  /**
   * Get language ID from file path
   */
  getLanguageId(filePath: string): string | null {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    return EXTENSION_TO_LANGUAGE[ext] || null;
  }

  /**
   * Check if a language server is available for a language
   */
  hasServerFor(languageId: string): boolean {
    return languageId in DEFAULT_SERVERS || this.getCustomServerConfig(languageId) !== null;
  }

  /**
   * Get custom server config from settings
   */
  private getCustomServerConfig(_languageId: string): ServerConfig | null {
    // TODO: Add 'lsp.servers' to EditorSettings type
    // For now, return null - only default servers are supported
    return null;
  }

  /**
   * Get server config for a language
   */
  private getServerConfig(languageId: string): ServerConfig | null {
    // Check custom config first
    const custom = this.getCustomServerConfig(languageId);
    if (custom) return custom;

    // Use default
    return DEFAULT_SERVERS[languageId] || null;
  }

  /**
   * Check if server command exists
   */
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

  /**
   * Get or start a client for a language
   */
  private async getClient(languageId: string): Promise<LSPClient | null> {
    if (!this.enabled) {
      debugLog('LSP disabled');
      return null;
    }

    // Already have a running client
    if (this.clients.has(languageId)) {
      debugLog(`Using existing client for ${languageId}`);
      return this.clients.get(languageId)!;
    }

    // Already tried and failed
    if (this.failedServers.has(languageId)) {
      debugLog(`Server previously failed for ${languageId}`);
      return null;
    }

    // Get server config
    const config = this.getServerConfig(languageId);
    if (!config) {
      debugLog(`No server config for ${languageId}`);
      return null;
    }

    debugLog(`Checking if ${config.command} exists...`);
    
    // Check if command exists
    if (!(await this.commandExists(config.command))) {
      debugLog(`Command not found: ${config.command}`);
      this.failedServers.add(languageId);
      this.startupErrors.push(`${languageId}: command not found: ${config.command}`);
      return null;
    }

    debugLog(`Starting ${config.command} for ${languageId}...`);
    
    // Start the client
    const client = new LSPClient(config.command, config.args, this.workspaceRoot);
    client.debugEnabled = debugEnabled;
    
    // Set up notification handler
    client.onNotification((method, params) => {
      this.handleNotification(languageId, method, params);
    });

    // Try to start
    const started = await client.start();
    if (!started) {
      debugLog(`Failed to start ${config.command}`);
      this.failedServers.add(languageId);
      this.startupErrors.push(`${languageId}: failed to start ${config.command}`);
      return null;
    }

    debugLog(`Successfully started ${config.command} for ${languageId}`);
    this.clients.set(languageId, client);
    return client;
  }

  /**
   * Handle notifications from language servers
   */
  private handleNotification(languageId: string, method: string, params: unknown): void {
    debugLog(`Notification from ${languageId}: ${method}`);
    if (method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = params as { uri: string; diagnostics: LSPDiagnostic[] };
      debugLog(`Diagnostics for ${uri}: ${diagnostics.length} items`);
      this.diagnosticsStore.set(uri, diagnostics);
      if (this.diagnosticsCallback) {
        this.diagnosticsCallback(uri, diagnostics);
      }
    }
  }

  /**
   * Get diagnostics for a URI
   */
  getDiagnostics(uri: string): LSPDiagnostic[] {
    return this.diagnosticsStore.get(uri) || [];
  }

  /**
   * Get all diagnostics
   */
  getAllDiagnostics(): Map<string, LSPDiagnostic[]> {
    return this.diagnosticsStore;
  }

  /**
   * Get diagnostics summary (error/warning counts)
   */
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

  // ============ Document Lifecycle ============

  /**
   * Notify that a document was opened
   */
  async documentOpened(filePath: string, content: string): Promise<void> {
    debugLog(`documentOpened: ${filePath}`);
    const languageId = this.getLanguageId(filePath);
    if (!languageId) {
      debugLog(`No language ID for ${filePath}`);
      return;
    }
    debugLog(`Language ID: ${languageId}`);

    const client = await this.getClient(languageId);
    if (!client) {
      debugLog(`No client available for ${languageId}`);
      return;
    }

    const uri = `file://${filePath}`;
    const version = 1;
    
    this.documentVersions.set(uri, version);
    this.documentLanguages.set(uri, languageId);
    
    debugLog(`Sending didOpen for ${uri}`);
    client.didOpen(uri, languageId, version, content);
  }

  /**
   * Notify that a document changed
   */
  async documentChanged(filePath: string, content: string): Promise<void> {
    const uri = `file://${filePath}`;
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) return;

    const client = this.clients.get(languageId);
    if (!client) return;

    const version = (this.documentVersions.get(uri) || 0) + 1;
    this.documentVersions.set(uri, version);
    
    client.didChange(uri, version, content);
  }

  /**
   * Notify that a document was saved
   */
  async documentSaved(filePath: string, content?: string): Promise<void> {
    const uri = `file://${filePath}`;
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) return;

    const client = this.clients.get(languageId);
    if (!client) return;
    
    client.didSave(uri, content);
  }

  /**
   * Notify that a document was closed
   */
  async documentClosed(filePath: string): Promise<void> {
    const uri = `file://${filePath}`;
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) return;

    const client = this.clients.get(languageId);
    if (client) {
      client.didClose(uri);
    }
    
    this.documentVersions.delete(uri);
    this.documentLanguages.delete(uri);
    this.diagnosticsStore.delete(uri);
  }

  // ============ LSP Features ============

  /**
   * Get completions at position
   */
  async getCompletions(filePath: string, line: number, character: number): Promise<LSPCompletionItem[]> {
    const uri = `file://${filePath}`;
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) return [];

    const client = this.clients.get(languageId);
    if (!client) return [];

    const position: LSPPosition = { line, character };
    return client.getCompletions(uri, position);
  }

  /**
   * Get hover info at position
   */
  async getHover(filePath: string, line: number, character: number): Promise<LSPHover | null> {
    const uri = `file://${filePath}`;
    debugLog(`getHover: uri=${uri}, line=${line}, char=${character}`);
    
    const languageId = this.documentLanguages.get(uri);
    debugLog(`getHover: languageId=${languageId}, registered docs:`, Array.from(this.documentLanguages.keys()));
    
    if (!languageId) {
      debugLog('getHover: No languageId found for URI');
      return null;
    }

    const client = this.clients.get(languageId);
    if (!client) {
      debugLog('getHover: No client found for languageId');
      return null;
    }

    const position: LSPPosition = { line, character };
    debugLog('getHover: Calling client.getHover...');
    const result = await client.getHover(uri, position);
    debugLog(`getHover: Result: ${result ? 'got hover' : 'null'}`);
    return result;
  }

  /**
   * Get definition location
   */
  async getDefinition(filePath: string, line: number, character: number): Promise<LSPLocation | LSPLocation[] | null> {
    const uri = `file://${filePath}`;
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) return null;

    const client = this.clients.get(languageId);
    if (!client) return null;

    const position: LSPPosition = { line, character };
    return client.getDefinition(uri, position);
  }

  /**
   * Get references
   */
  async getReferences(filePath: string, line: number, character: number): Promise<LSPLocation[]> {
    const uri = `file://${filePath}`;
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) return [];

    const client = this.clients.get(languageId);
    if (!client) return [];

    const position: LSPPosition = { line, character };
    return client.getReferences(uri, position);
  }

  /**
   * Rename symbol
   */
  async rename(filePath: string, line: number, character: number, newName: string): Promise<Record<string, unknown> | null> {
    const uri = `file://${filePath}`;
    const languageId = this.documentLanguages.get(uri);
    if (!languageId) return null;

    const client = this.clients.get(languageId);
    if (!client) return null;

    const position: LSPPosition = { line, character };
    return client.rename(uri, position, newName);
  }

  /**
   * Shutdown all language servers
   */
  async shutdownAll(): Promise<void> {
    const shutdownPromises = Array.from(this.clients.values()).map(client => client.shutdown());
    await Promise.all(shutdownPromises);
    this.clients.clear();
    this.documentVersions.clear();
    this.documentLanguages.clear();
    this.diagnosticsStore.clear();
    this.failedServers.clear();
  }

  /**
   * Alias for shutdownAll
   */
  async shutdown(): Promise<void> {
    return this.shutdownAll();
  }

  /**
   * Shutdown server for a specific language
   */
  async shutdownLanguage(languageId: string): Promise<void> {
    const client = this.clients.get(languageId);
    if (client) {
      await client.shutdown();
      this.clients.delete(languageId);
    }
  }

  // ============ Convenience Aliases ============

  /**
   * Alias for documentOpened - uses provided languageId instead of detecting from path
   */
  async openDocument(uri: string, languageId: string, content: string): Promise<void> {
    debugLog(`openDocument: ${uri}, language: ${languageId}`);
    // Extract file path from URI
    const filePath = uri.replace('file://', '');
    
    // Use provided languageId to get client
    const client = await this.getClient(languageId);
    if (!client) {
      debugLog(`No client for language ${languageId}`);
      return;
    }

    const version = 1;
    this.documentVersions.set(uri, version);
    this.documentLanguages.set(uri, languageId);
    
    debugLog(`Sending didOpen for ${uri}`);
    client.didOpen(uri, languageId, version, content);
  }

  /**
   * Alias for documentChanged
   */
  async changeDocument(uri: string, content: string): Promise<void> {
    const filePath = uri.replace('file://', '');
    await this.documentChanged(filePath, content);
  }

  /**
   * Alias for documentClosed
   */
  async closeDocument(uri: string): Promise<void> {
    const filePath = uri.replace('file://', '');
    await this.documentClosed(filePath);
  }
}

// Singleton instance
export const lspManager = new LSPManager();

export default lspManager;
