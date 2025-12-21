/**
 * LSP Integration
 *
 * Manages Language Server Protocol integration for the TUI client.
 * Provides autocomplete, hover, go to definition, signature help, and diagnostics.
 */

import { debugLog } from '../../../debug.ts';
import type { OverlayManager, OverlayManagerCallbacks } from '../overlays/overlay-manager.ts';
import {
  AutocompletePopup,
  createAutocompletePopup,
} from '../overlays/autocomplete-popup.ts';
import { HoverTooltip, createHoverTooltip } from '../overlays/hover-tooltip.ts';
import {
  SignatureHelpOverlay,
  createSignatureHelp,
  type SignatureDisplayMode,
} from '../overlays/signature-help.ts';
import {
  localLSPService,
  type LSPService,
  type LSPPosition,
  type LSPCompletionItem,
  type LSPDiagnostic,
  EXTENSION_TO_LANGUAGE,
} from '../../../services/lsp/index.ts';
import type { TUISettings } from '../config/config-manager.ts';

// ============================================
// Types
// ============================================

export interface LSPIntegrationCallbacks {
  /** Called when overlays need re-render */
  onDirty: () => void;
  /** Get a theme color */
  getThemeColor: (key: string, fallback?: string) => string;
  /** Get screen size */
  getScreenSize: () => { width: number; height: number };
  /** Get a setting value */
  getSetting: <K extends keyof TUISettings>(key: K) => TUISettings[K];
  /** Open a file at a location */
  openFile: (uri: string, line?: number, column?: number) => Promise<void>;
  /** Show a notification */
  showNotification: (message: string, type: 'info' | 'warning' | 'error') => void;
  /** Update status bar with signature help */
  setStatusBarSignature?: (text: string) => void;
  /** Called when diagnostics update for a document */
  onDiagnosticsUpdate?: (uri: string, diagnostics: LSPDiagnostic[]) => void;
}

export interface DocumentInfo {
  uri: string;
  languageId: string;
  version: number;
}

// ============================================
// LSP Integration
// ============================================

export class LSPIntegration {
  /** LSP service instance */
  private lspService: LSPService;

  /** Overlay manager */
  private overlayManager: OverlayManager;

  /** Callbacks */
  private callbacks: LSPIntegrationCallbacks;

  /** Autocomplete popup overlay */
  private autocompletePopup: AutocompletePopup;

  /** Hover tooltip overlay */
  private hoverTooltip: HoverTooltip;

  /** Signature help overlay */
  private signatureHelp: SignatureHelpOverlay;

  /** Current document info */
  private currentDocument: DocumentInfo | null = null;

  /** Workspace root */
  private workspaceRoot: string;

  /** Debounce timer for completion */
  private completionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Active language servers */
  private activeServers = new Set<string>();

  /** Diagnostics unsubscribe function */
  private diagnosticsUnsubscribe: (() => void) | null = null;

  /** Diagnostics by URI */
  private diagnosticsByUri = new Map<string, LSPDiagnostic[]>();

  /** Completion trigger characters */
  private triggerCharacters = '.:/<@(';

  constructor(
    overlayManager: OverlayManager,
    callbacks: LSPIntegrationCallbacks,
    workspaceRoot: string
  ) {
    this.overlayManager = overlayManager;
    this.callbacks = callbacks;
    this.workspaceRoot = workspaceRoot;
    this.lspService = localLSPService;

    // Create overlay callbacks
    const overlayCallbacks: OverlayManagerCallbacks = {
      onDirty: callbacks.onDirty,
      getThemeColor: callbacks.getThemeColor,
      getScreenSize: callbacks.getScreenSize,
    };

    // Create overlays
    this.autocompletePopup = createAutocompletePopup('lsp-autocomplete', overlayCallbacks);
    this.hoverTooltip = createHoverTooltip('lsp-hover', overlayCallbacks);
    this.signatureHelp = createSignatureHelp('lsp-signature', overlayCallbacks);

    // Register overlays with manager
    this.overlayManager.addOverlay(this.autocompletePopup);
    this.overlayManager.addOverlay(this.hoverTooltip);
    this.overlayManager.addOverlay(this.signatureHelp);

    // Setup signature help status bar callback
    if (callbacks.setStatusBarSignature) {
      this.signatureHelp.onStatusBarUpdate(callbacks.setStatusBarSignature);
    }

    // Set workspace root
    this.lspService.setWorkspaceRoot(workspaceRoot);

    // Subscribe to diagnostics
    this.diagnosticsUnsubscribe = this.lspService.onDiagnostics((uri, diagnostics) => {
      this.diagnosticsByUri.set(uri, diagnostics);
      this.callbacks.onDiagnosticsUpdate?.(uri, diagnostics);
      this.callbacks.onDirty();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialize LSP for a document.
   */
  async initForDocument(uri: string, content: string): Promise<void> {
    const languageId = this.getLanguageId(uri);
    if (!languageId) {
      debugLog(`[LSPIntegration] No language detected for ${uri}`);
      return;
    }

    // Check if LSP is enabled
    if (!this.isEnabled()) {
      debugLog('[LSPIntegration] LSP is disabled');
      return;
    }

    // Start server for this language if not already running
    if (!this.activeServers.has(languageId) && this.lspService.hasServerFor(languageId)) {
      try {
        await this.lspService.startServer(languageId, this.workspaceRoot);
        this.activeServers.add(languageId);
        debugLog(`[LSPIntegration] Started server for ${languageId}`);
      } catch (error) {
        debugLog(`[LSPIntegration] Failed to start server for ${languageId}: ${error}`);
        return;
      }
    }

    // Notify document opened
    try {
      await this.lspService.documentOpened(uri, languageId, content);
      this.currentDocument = { uri, languageId, version: 1 };
      debugLog(`[LSPIntegration] Document opened: ${uri}`);
    } catch (error) {
      debugLog(`[LSPIntegration] Failed to notify document opened: ${error}`);
    }
  }

  /**
   * Notify document content changed.
   */
  async documentChanged(uri: string, content: string): Promise<void> {
    if (!this.currentDocument || this.currentDocument.uri !== uri) {
      return;
    }

    this.currentDocument.version++;

    try {
      await this.lspService.documentChanged(uri, content, this.currentDocument.version);
    } catch (error) {
      debugLog(`[LSPIntegration] Failed to notify document changed: ${error}`);
    }
  }

  /**
   * Notify document saved.
   */
  async documentSaved(uri: string, content: string): Promise<void> {
    try {
      await this.lspService.documentSaved(uri, content);
    } catch (error) {
      debugLog(`[LSPIntegration] Failed to notify document saved: ${error}`);
    }
  }

  /**
   * Notify document closed.
   */
  async documentClosed(uri: string): Promise<void> {
    try {
      await this.lspService.documentClosed(uri);
      if (this.currentDocument?.uri === uri) {
        this.currentDocument = null;
      }
      this.diagnosticsByUri.delete(uri);
    } catch (error) {
      debugLog(`[LSPIntegration] Failed to notify document closed: ${error}`);
    }
  }

  /**
   * Shutdown LSP integration.
   */
  async shutdown(): Promise<void> {
    // Cancel any pending completion
    this.cancelCompletion();

    // Hide all overlays
    this.autocompletePopup.hide();
    this.hoverTooltip.hide();
    this.signatureHelp.hide();

    // Unsubscribe from diagnostics
    this.diagnosticsUnsubscribe?.();

    // Shutdown LSP service
    try {
      await this.lspService.shutdown();
    } catch (error) {
      debugLog(`[LSPIntegration] Failed to shutdown LSP service: ${error}`);
    }

    this.activeServers.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Completion
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Trigger completion at position.
   */
  async triggerCompletion(
    uri: string,
    position: LSPPosition,
    screenX: number,
    screenY: number
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const completions = await this.lspService.getCompletions(uri, position);

      if (completions.length === 0) {
        this.autocompletePopup.hide();
        return;
      }

      // Show popup with LSP completion items
      this.autocompletePopup.showCompletions(completions, screenX, screenY);
    } catch (error) {
      debugLog(`[LSPIntegration] Completion failed: ${error}`);
      this.autocompletePopup.hide();
    }
  }

  /**
   * Trigger completion with debounce.
   */
  triggerCompletionDebounced(
    uri: string,
    position: LSPPosition,
    screenX: number,
    screenY: number
  ): void {
    this.cancelCompletion();

    const debounceMs = this.callbacks.getSetting('lsp.completionDebounceMs') ?? 250;

    this.completionDebounceTimer = setTimeout(() => {
      this.completionDebounceTimer = null;
      this.triggerCompletion(uri, position, screenX, screenY);
    }, debounceMs);
  }

  /**
   * Cancel pending completion.
   */
  cancelCompletion(): void {
    if (this.completionDebounceTimer) {
      clearTimeout(this.completionDebounceTimer);
      this.completionDebounceTimer = null;
    }
  }

  /**
   * Check if a character should trigger completion.
   */
  shouldTriggerCompletion(char: string): boolean {
    const triggers = this.callbacks.getSetting('lsp.triggerCharacters') ?? this.triggerCharacters;
    return triggers.includes(char);
  }

  /**
   * Get the selected completion item.
   */
  getSelectedCompletion(): LSPCompletionItem | null {
    return this.autocompletePopup.getSelectedItem();
  }

  /**
   * Accept the selected completion.
   */
  acceptCompletion(): LSPCompletionItem | null {
    const item = this.autocompletePopup.getSelectedItem();
    this.autocompletePopup.hide();
    return item;
  }

  /**
   * Dismiss completion popup.
   */
  dismissCompletion(): void {
    this.autocompletePopup.hide();
  }

  /**
   * Update completion filter.
   */
  updateCompletionFilter(prefix: string): void {
    if (this.autocompletePopup.isVisible()) {
      this.autocompletePopup.updatePrefix(prefix);
    }
  }

  /**
   * Check if completion popup is visible.
   */
  isCompletionVisible(): boolean {
    return this.autocompletePopup.isVisible();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hover
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show hover information at position.
   */
  async showHover(
    uri: string,
    position: LSPPosition,
    screenX: number,
    screenY: number
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const hoverEnabled = this.callbacks.getSetting('lsp.hover.enabled') ?? true;
    if (!hoverEnabled) return;

    try {
      const hover = await this.lspService.getHover(uri, position);

      if (!hover) {
        this.hoverTooltip.hide();
        return;
      }

      this.hoverTooltip.showHover(hover, screenX, screenY);
    } catch (error) {
      debugLog(`[LSPIntegration] Hover failed: ${error}`);
      this.hoverTooltip.hide();
    }
  }

  /**
   * Hide hover tooltip.
   */
  hideHover(): void {
    this.hoverTooltip.hide();
  }

  /**
   * Check if hover is visible.
   */
  isHoverVisible(): boolean {
    return this.hoverTooltip.isVisible();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Signature Help
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Trigger signature help at position.
   */
  async triggerSignatureHelp(
    uri: string,
    position: LSPPosition,
    screenX: number,
    screenY: number
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const signatureEnabled = this.callbacks.getSetting('lsp.signatureHelp.enabled') ?? true;
    if (!signatureEnabled) return;

    try {
      const help = await this.lspService.getSignatureHelp(uri, position);

      if (!help) {
        this.signatureHelp.hide();
        return;
      }

      // Apply display mode setting
      const displayMode =
        (this.callbacks.getSetting('lsp.signatureHelp.display') as SignatureDisplayMode) ?? 'popup';
      this.signatureHelp.setDisplayMode(displayMode);

      this.signatureHelp.showSignatureHelp(help, screenX, screenY);
    } catch (error) {
      debugLog(`[LSPIntegration] Signature help failed: ${error}`);
      this.signatureHelp.hide();
    }
  }

  /**
   * Hide signature help.
   */
  hideSignatureHelp(): void {
    this.signatureHelp.hide();
  }

  /**
   * Check if signature help is visible.
   */
  isSignatureHelpVisible(): boolean {
    return this.signatureHelp.isVisible();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Go to Definition
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Go to definition at position.
   */
  async goToDefinition(uri: string, position: LSPPosition): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const locations = await this.lspService.getDefinition(uri, position);

      if (locations.length === 0) {
        this.callbacks.showNotification('No definition found', 'info');
        return;
      }

      // Use first location
      const loc = locations[0]!;
      await this.callbacks.openFile(loc.uri, loc.range.start.line, loc.range.start.character);
    } catch (error) {
      debugLog(`[LSPIntegration] Go to definition failed: ${error}`);
      this.callbacks.showNotification('Failed to find definition', 'error');
    }
  }

  /**
   * Find references at position.
   */
  async findReferences(uri: string, position: LSPPosition): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const locations = await this.lspService.getReferences(uri, position, true);

      if (locations.length === 0) {
        this.callbacks.showNotification('No references found', 'info');
        return;
      }

      if (locations.length === 1) {
        const loc = locations[0]!;
        await this.callbacks.openFile(loc.uri, loc.range.start.line, loc.range.start.character);
      } else {
        // TODO: Show references picker
        this.callbacks.showNotification(`Found ${locations.length} references`, 'info');
      }
    } catch (error) {
      debugLog(`[LSPIntegration] Find references failed: ${error}`);
      this.callbacks.showNotification('Failed to find references', 'error');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Diagnostics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get diagnostics for a URI.
   */
  getDiagnostics(uri: string): LSPDiagnostic[] {
    return this.diagnosticsByUri.get(uri) ?? [];
  }

  /**
   * Get all diagnostics.
   */
  getAllDiagnostics(): Map<string, LSPDiagnostic[]> {
    return new Map(this.diagnosticsByUri);
  }

  /**
   * Get diagnostics summary.
   */
  getDiagnosticsSummary(): { errors: number; warnings: number } {
    return this.lspService.getDiagnosticsSummary();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if LSP is enabled.
   */
  isEnabled(): boolean {
    const enabled = this.callbacks.getSetting('lsp.enabled');
    return enabled !== false;
  }

  /**
   * Get language ID from file URI.
   */
  private getLanguageId(uri: string): string | null {
    const path = uri.replace(/^file:\/\//, '');
    const ext = path.split('.').pop()?.toLowerCase();
    if (!ext) return null;

    return EXTENSION_TO_LANGUAGE[`.${ext}`] ?? null;
  }

  /**
   * Get the autocomplete popup (for input handling).
   */
  getAutocompletePopup(): AutocompletePopup {
    return this.autocompletePopup;
  }

  /**
   * Get the hover tooltip (for input handling).
   */
  getHoverTooltip(): HoverTooltip {
    return this.hoverTooltip;
  }

  /**
   * Get the signature help overlay (for input handling).
   */
  getSignatureHelpOverlay(): SignatureHelpOverlay {
    return this.signatureHelp;
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create an LSP integration instance.
 */
export function createLSPIntegration(
  overlayManager: OverlayManager,
  callbacks: LSPIntegrationCallbacks,
  workspaceRoot: string
): LSPIntegration {
  return new LSPIntegration(overlayManager, callbacks, workspaceRoot);
}
