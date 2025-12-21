/**
 * Signature Help
 *
 * Displays function/method signature with active parameter highlighting.
 * Supports multiple display modes: inline, status bar, and popup.
 */

import type { Overlay, OverlayManagerCallbacks } from './overlay-manager.ts';
import type { Rect, KeyEvent, InputEvent } from '../types.ts';
import { isKeyEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { LSPSignatureHelp, LSPSignatureInformation } from '../../../services/lsp/types.ts';

// ============================================
// Types
// ============================================

export type SignatureDisplayMode = 'inline' | 'statusBar' | 'popup';

// ============================================
// Signature Help
// ============================================

export class SignatureHelpOverlay implements Overlay {
  readonly id: string;
  zIndex = 275; // Between hover and autocomplete

  /** Current signature help data */
  private signatureHelp: LSPSignatureHelp | null = null;
  /** Display mode */
  private displayMode: SignatureDisplayMode = 'popup';
  /** Maximum width */
  private maxWidth = 80;

  /** Visibility state */
  private visible = false;
  /** Overlay bounds */
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };

  /** Callbacks */
  private callbacks: OverlayManagerCallbacks;

  /** Callback for status bar display mode */
  private statusBarCallback: ((text: string) => void) | null = null;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    this.id = id;
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the display mode.
   */
  setDisplayMode(mode: SignatureDisplayMode): void {
    this.displayMode = mode;
  }

  /**
   * Set callback for status bar display mode.
   */
  onStatusBarUpdate(callback: (text: string) => void): void {
    this.statusBarCallback = callback;
  }

  /**
   * Show signature help.
   *
   * @param signatureHelp LSP signature help response
   * @param x Screen X position (cursor column)
   * @param y Screen Y position (cursor line)
   */
  showSignatureHelp(signatureHelp: LSPSignatureHelp, x: number, y: number): void {
    if (!signatureHelp.signatures || signatureHelp.signatures.length === 0) {
      this.hide();
      return;
    }

    this.signatureHelp = signatureHelp;

    if (this.displayMode === 'statusBar') {
      // Display in status bar instead of overlay
      const text = this.formatForStatusBar(signatureHelp);
      this.statusBarCallback?.(text);
      this.visible = false;
    } else {
      this.visible = true;
      this.calculateBounds(x, y);
    }

    this.callbacks.onDirty();
  }

  /**
   * Get the current active signature index.
   */
  getActiveSignatureIndex(): number {
    return this.signatureHelp?.activeSignature ?? 0;
  }

  /**
   * Cycle to next signature (if multiple available).
   */
  nextSignature(): void {
    if (!this.signatureHelp || this.signatureHelp.signatures.length <= 1) return;

    const current = this.signatureHelp.activeSignature ?? 0;
    this.signatureHelp.activeSignature = (current + 1) % this.signatureHelp.signatures.length;
    this.callbacks.onDirty();
  }

  /**
   * Cycle to previous signature (if multiple available).
   */
  prevSignature(): void {
    if (!this.signatureHelp || this.signatureHelp.signatures.length <= 1) return;

    const current = this.signatureHelp.activeSignature ?? 0;
    const len = this.signatureHelp.signatures.length;
    this.signatureHelp.activeSignature = (current - 1 + len) % len;
    this.callbacks.onDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay Interface
  // ─────────────────────────────────────────────────────────────────────────

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.callbacks.onDirty();
  }

  hide(): void {
    if (this.visible || this.signatureHelp) {
      this.visible = false;
      this.signatureHelp = null;
      if (this.displayMode === 'statusBar') {
        this.statusBarCallback?.('');
      }
      this.callbacks.onDirty();
    }
  }

  setBounds(bounds: Rect): void {
    this.bounds = bounds;
  }

  getBounds(): Rect {
    return this.bounds;
  }

  onDismiss(): void {
    this.hide();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    if (!this.visible || !this.signatureHelp || this.displayMode === 'statusBar') return;

    const { x, y, width, height } = this.bounds;
    const bgColor = this.callbacks.getThemeColor('editorHoverWidget.background', '#252526');
    const fgColor = this.callbacks.getThemeColor('editorHoverWidget.foreground', '#cccccc');
    const borderColor = this.callbacks.getThemeColor('editorHoverWidget.border', '#454545');
    const highlightColor = this.callbacks.getThemeColor('editorSuggestWidget.highlightForeground', '#18a3ff');
    const dimColor = this.callbacks.getThemeColor('descriptionForeground', '#717171');

    const activeIndex = this.signatureHelp.activeSignature ?? 0;
    const activeSignature = this.signatureHelp.signatures[activeIndex];
    if (!activeSignature) return;

    const activeParam = this.signatureHelp.activeParameter ?? 0;

    // Draw border and background
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const screenX = x + col;
        const screenY = y + row;

        // Border
        if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
          let char = ' ';
          if (row === 0 && col === 0) char = '┌';
          else if (row === 0 && col === width - 1) char = '┐';
          else if (row === height - 1 && col === 0) char = '└';
          else if (row === height - 1 && col === width - 1) char = '┘';
          else if (row === 0 || row === height - 1) char = '─';
          else char = '│';

          buffer.set(screenX, screenY, { char, fg: borderColor, bg: bgColor });
        } else {
          buffer.set(screenX, screenY, { char: ' ', fg: fgColor, bg: bgColor });
        }
      }
    }

    // Draw signature label with active parameter highlighted
    const signatureLabel = activeSignature.label;
    const paramRanges = this.getParameterRanges(activeSignature, activeParam);

    let col = 0;
    const contentWidth = width - 4;
    const rowY = y + 1;

    for (let i = 0; i < signatureLabel.length && col < contentWidth; i++) {
      const char = signatureLabel[i] ?? ' ';
      let charFg = fgColor;

      // Check if this character is in the active parameter range
      if (paramRanges && i >= paramRanges.start && i < paramRanges.end) {
        charFg = highlightColor;
      }

      buffer.set(x + 2 + col, rowY, { char, fg: charFg, bg: bgColor });
      col++;
    }

    // If there are multiple signatures, show indicator
    if (this.signatureHelp.signatures.length > 1) {
      const indicator = ` (${activeIndex + 1}/${this.signatureHelp.signatures.length})`;
      const indicatorY = y + 1;
      const indicatorX = x + width - 2 - indicator.length;

      if (indicatorX > x + 2 + col) {
        for (let i = 0; i < indicator.length; i++) {
          buffer.set(indicatorX + i, indicatorY, { char: indicator[i] ?? ' ', fg: dimColor, bg: bgColor });
        }
      }
    }

    // Draw parameter documentation if available
    if (height > 3 && activeSignature.parameters && activeSignature.parameters[activeParam]) {
      const param = activeSignature.parameters[activeParam];
      if (param) {
        const doc = this.getDocumentation(param.documentation);

        if (doc) {
          const docY = y + 2;
          const wrappedDoc = this.wrapText(doc, contentWidth);

          for (let i = 0; i < wrappedDoc.length && i < height - 4; i++) {
            const line = wrappedDoc[i];
            if (!line) continue;
            for (let c = 0; c < line.length && c < contentWidth; c++) {
              buffer.set(x + 2 + c, docY + i, { char: line[c] ?? ' ', fg: dimColor, bg: bgColor });
            }
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  handleInput(event: InputEvent): boolean {
    if (!this.visible) return false;

    if (isKeyEvent(event)) {
      // Escape dismisses
      if (event.key === 'Escape') {
        this.hide();
        return true;
      }

      // Arrow keys cycle signatures if multiple
      if (this.signatureHelp && this.signatureHelp.signatures.length > 1) {
        if (event.key === 'ArrowUp' && event.alt) {
          this.prevSignature();
          return true;
        }
        if (event.key === 'ArrowDown' && event.alt) {
          this.nextSignature();
          return true;
        }
      }

      // Don't consume other keys
      return false;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper Methods
  // ─────────────────────────────────────────────────────────────────────────

  private getParameterRanges(
    signature: LSPSignatureInformation,
    activeParam: number
  ): { start: number; end: number } | null {
    if (!signature.parameters || activeParam >= signature.parameters.length) {
      return null;
    }

    const param = signature.parameters[activeParam];
    if (!param) return null;

    if (Array.isArray(param.label)) {
      // Label is [start, end] offsets
      return { start: param.label[0], end: param.label[1] };
    } else {
      // Label is a string - find it in the signature
      const paramLabel = param.label;
      const start = signature.label.indexOf(paramLabel);
      if (start !== -1) {
        return { start, end: start + paramLabel.length };
      }
    }

    return null;
  }

  private getDocumentation(doc: string | { kind: string; value: string } | undefined): string {
    if (!doc) return '';
    if (typeof doc === 'string') return doc;
    return doc.value || '';
  }

  private formatForStatusBar(signatureHelp: LSPSignatureHelp): string {
    const activeIndex = signatureHelp.activeSignature ?? 0;
    const activeSignature = signatureHelp.signatures[activeIndex];
    if (!activeSignature) return '';
    const activeParam = signatureHelp.activeParameter ?? 0;

    let label = activeSignature.label;

    // Try to highlight active parameter with brackets
    const paramRanges = this.getParameterRanges(activeSignature, activeParam);
    if (paramRanges) {
      const before = label.slice(0, paramRanges.start);
      const param = label.slice(paramRanges.start, paramRanges.end);
      const after = label.slice(paramRanges.end);
      label = `${before}[${param}]${after}`;
    }

    // Add signature count if multiple
    if (signatureHelp.signatures.length > 1) {
      label = `(${activeIndex + 1}/${signatureHelp.signatures.length}) ${label}`;
    }

    return label;
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    const words = text.split(' ');
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length === 0) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Positioning
  // ─────────────────────────────────────────────────────────────────────────

  private calculateBounds(cursorX: number, cursorY: number): void {
    if (!this.signatureHelp) return;

    const screenSize = this.callbacks.getScreenSize();
    const activeIndex = this.signatureHelp.activeSignature ?? 0;
    const activeSignature = this.signatureHelp.signatures[activeIndex];
    if (!activeSignature) return;
    const activeParam = this.signatureHelp.activeParameter ?? 0;

    // Calculate width based on signature label
    let contentWidth = Math.min(activeSignature.label.length + 4, this.maxWidth);

    // Check if we need extra height for parameter documentation
    let contentHeight = 1;
    const activeParamInfo = activeSignature.parameters?.[activeParam];
    if (activeParamInfo) {
      const doc = this.getDocumentation(activeParamInfo.documentation);
      if (doc) {
        const wrappedDoc = this.wrapText(doc, contentWidth - 4);
        contentHeight += wrappedDoc.length + 1; // +1 for blank line
      }
    }

    const width = contentWidth;
    const height = contentHeight + 2; // +2 for borders

    // Position above cursor (inline style)
    let x = cursorX;
    let y = cursorY - height;

    // Adjust horizontal position
    if (x + width > screenSize.width) {
      x = Math.max(0, screenSize.width - width);
    }

    // Adjust vertical position
    if (y < 0) {
      y = cursorY + 1;
      if (y + height > screenSize.height) {
        y = Math.max(0, screenSize.height - height);
      }
    }

    this.bounds = { x, y, width, height };
  }
}

/**
 * Create a signature help overlay instance.
 */
export function createSignatureHelp(id: string, callbacks: OverlayManagerCallbacks): SignatureHelpOverlay {
  return new SignatureHelpOverlay(id, callbacks);
}
