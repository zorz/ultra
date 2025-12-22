/**
 * AI Approval Dialog
 *
 * Dialog for approving or denying AI tool calls.
 * Supports different approval scopes: once, session, always.
 */

import { BaseDialog, type BaseDialogConfig } from './base-dialog.ts';
import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { PendingToolCall, ApprovalEntry } from '../../features/mcp/mcp-types.ts';
import { RenderUtils } from '../render-utils.ts';
import { themeLoader } from '../themes/theme-loader.ts';

// ==================== Types ====================

export type ApprovalScope = 'once' | 'session' | 'always';

export interface ApprovalResult {
  approved: boolean;
  scope?: ApprovalScope;
}

export interface AIApprovalDialogConfig extends BaseDialogConfig {
  toolCall: PendingToolCall;
}

// ==================== Button Definition ====================

interface DialogButton {
  label: string;
  key: string;
  scope?: ApprovalScope;
  approved: boolean;
  color: string;
}

// ==================== AI Approval Dialog ====================

export class AIApprovalDialog extends BaseDialog {
  private _toolCall: PendingToolCall | null = null;
  private _selectedButtonIndex: number = 0;
  private _resolveCallback: ((result: ApprovalResult) => void) | null = null;

  // Buttons
  private readonly _buttons: DialogButton[] = [
    { label: 'Allow Once', key: '1', scope: 'once', approved: true, color: '#4CAF50' },
    { label: 'Allow Session', key: '2', scope: 'session', approved: true, color: '#2196F3' },
    { label: 'Always Allow', key: '3', scope: 'always', approved: true, color: '#9C27B0' },
    { label: 'Deny', key: 'd', scope: undefined, approved: false, color: '#F44336' },
  ];

  constructor() {
    super();
    this._debugName = 'AIApprovalDialog';
  }

  // ==================== Show/Hide ====================

  /**
   * Show the approval dialog and return a promise that resolves with the user's decision
   */
  show(config: AIApprovalDialogConfig): Promise<ApprovalResult> {
    return new Promise((resolve) => {
      this._toolCall = config.toolCall;
      this._selectedButtonIndex = 0;
      this._resolveCallback = resolve;

      // Calculate dialog size based on content
      const width = Math.max(60, Math.min(80, config.screenWidth - 10));
      const height = Math.min(20, config.screenHeight - 6);

      this.showBase({
        ...config,
        title: '🤖 AI Action Request',
        width,
        height,
      });

      this.debugLog(`Showing approval for tool: ${config.toolCall.toolName}`);
    });
  }

  /**
   * Hide and resolve with denial
   */
  hide(): void {
    if (this._isVisible && this._resolveCallback) {
      this._resolveCallback({ approved: false });
      this._resolveCallback = null;
    }
    super.hide();
    this._toolCall = null;
  }

  // ==================== Selection ====================

  private selectButton(index: number): void {
    if (index >= 0 && index < this._buttons.length) {
      this._selectedButtonIndex = index;
    }
  }

  private confirmSelection(): void {
    const button = this._buttons[this._selectedButtonIndex];
    if (!button || !this._resolveCallback) return;

    const result: ApprovalResult = {
      approved: button.approved,
      scope: button.scope,
    };

    this.debugLog(
      `User selected: ${button.label} (approved=${result.approved}, scope=${result.scope})`
    );

    this._resolveCallback(result);
    this._resolveCallback = null;
    super.hide();
    this._toolCall = null;
  }

  // ==================== Rendering ====================

  render(ctx: RenderContext): void {
    if (!this._isVisible || !this._toolCall) return;

    // Background and border
    this.renderBackground(ctx);
    this.renderTitle(ctx);

    const colors = this.getColors();
    const contentRect = this.getContentRect();
    let y = contentRect.y + 1;

    // Tool name
    const toolNameLabel = 'Tool: ';
    const toolName = this._toolCall.toolName;
    ctx.drawStyled(contentRect.x + 1, y, toolNameLabel, colors.hintForeground, colors.background);
    ctx.drawStyled(
      contentRect.x + 1 + toolNameLabel.length,
      y,
      toolName,
      themeLoader.getColor('terminal.ansiCyan') || '#00BFFF',
      colors.background
    );
    y += 2;

    // Arguments section
    ctx.drawStyled(contentRect.x + 1, y, 'Arguments:', colors.hintForeground, colors.background);
    y += 1;

    // Display arguments (truncated if too long)
    const args = this._toolCall.arguments;
    const argKeys = Object.keys(args);
    const maxArgsToShow = Math.min(argKeys.length, contentRect.height - 10);

    for (let i = 0; i < maxArgsToShow; i++) {
      const key = argKeys[i]!;
      const value = args[key];
      const valueStr = this.formatValue(value, contentRect.width - 6 - key.length);

      ctx.drawStyled(
        contentRect.x + 2,
        y,
        `${key}: `,
        themeLoader.getColor('terminal.ansiYellow') || '#FFD700',
        colors.background
      );
      ctx.drawStyled(
        contentRect.x + 2 + key.length + 2,
        y,
        valueStr,
        colors.foreground,
        colors.background
      );
      y += 1;
    }

    if (argKeys.length > maxArgsToShow) {
      ctx.drawStyled(
        contentRect.x + 2,
        y,
        `... and ${argKeys.length - maxArgsToShow} more`,
        colors.hintForeground,
        colors.background
      );
      y += 1;
    }

    // Separator
    y = this._rect.y + this._rect.height - 5;
    this.renderSeparator(ctx, y - this._rect.y);

    // Instruction text
    y += 1;
    const instruction = 'Choose an action:';
    ctx.drawStyled(contentRect.x + 1, y, instruction, colors.foreground, colors.background);
    y += 2;

    // Buttons
    this.renderButtons(ctx, y);
  }

  private renderButtons(ctx: RenderContext, y: number): void {
    const colors = this.getColors();
    const contentRect = this.getContentRect();

    let x = contentRect.x + 1;
    for (let i = 0; i < this._buttons.length; i++) {
      const button = this._buttons[i]!;
      const isSelected = i === this._selectedButtonIndex;

      // Button styling
      const buttonText = ` [${button.key}] ${button.label} `;
      const bgColor = isSelected ? button.color : colors.background;
      const fgColor = isSelected ? '#FFFFFF' : colors.foreground;

      ctx.drawStyled(x, y, buttonText, fgColor, bgColor);

      // Underline if selected
      if (isSelected) {
        ctx.drawStyled(x, y, buttonText, fgColor, bgColor, { bold: true });
      }

      x += buttonText.length + 1;
    }

    // Keyboard hint
    y += 2;
    const hint = 'Tab/Arrow: navigate • Enter: confirm • Esc: deny';
    ctx.drawStyled(contentRect.x + 1, y, hint, colors.hintForeground, colors.background);
  }

  private formatValue(value: unknown, maxLength: number): string {
    let str: string;
    if (typeof value === 'string') {
      str = value.length > 50 ? value.substring(0, 47) + '...' : value;
      // Replace newlines with visible representation
      str = str.replace(/\n/g, '↵').replace(/\r/g, '');
    } else if (typeof value === 'object') {
      str = JSON.stringify(value);
      if (str.length > maxLength) {
        str = str.substring(0, maxLength - 3) + '...';
      }
    } else {
      str = String(value);
    }
    return str.substring(0, maxLength);
  }

  // ==================== Mouse Handling ====================

  onMouseEvent(event: MouseEvent): boolean {
    if (!this._isVisible) return false;

    if (!this.containsPoint(event.x, event.y)) {
      // Click outside - deny
      if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
        this.hide();
        return true;
      }
      return false;
    }

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      // Check if clicking on a button
      const buttonY = this._rect.y + this._rect.height - 3;
      if (event.y === buttonY) {
        // Find which button was clicked
        let x = this._rect.x + 2;
        for (let i = 0; i < this._buttons.length; i++) {
          const button = this._buttons[i]!;
          const buttonText = ` [${button.key}] ${button.label} `;
          if (event.x >= x && event.x < x + buttonText.length) {
            this._selectedButtonIndex = i;
            this.confirmSelection();
            return true;
          }
          x += buttonText.length + 1;
        }
      }
      return true;
    }

    return this.handleBaseMouseEvent(event);
  }

  // ==================== Keyboard Handling ====================

  handleKey(event: KeyEvent): boolean {
    if (!this._isVisible) return false;

    switch (event.key) {
      case 'ESCAPE':
        this.hide();
        return true;

      case 'ENTER':
        this.confirmSelection();
        return true;

      case 'TAB':
        if (event.shift) {
          this.selectButton(
            (this._selectedButtonIndex - 1 + this._buttons.length) % this._buttons.length
          );
        } else {
          this.selectButton((this._selectedButtonIndex + 1) % this._buttons.length);
        }
        return true;

      case 'LEFT':
        this.selectButton(Math.max(0, this._selectedButtonIndex - 1));
        return true;

      case 'RIGHT':
        this.selectButton(Math.min(this._buttons.length - 1, this._selectedButtonIndex + 1));
        return true;

      // Number keys for quick selection
      case '1':
        this._selectedButtonIndex = 0;
        this.confirmSelection();
        return true;

      case '2':
        this._selectedButtonIndex = 1;
        this.confirmSelection();
        return true;

      case '3':
        this._selectedButtonIndex = 2;
        this.confirmSelection();
        return true;

      case 'D':
      case 'd':
        this._selectedButtonIndex = 3;
        this.confirmSelection();
        return true;
    }

    return false;
  }

  // ==================== Utilities ====================

  /**
   * Create an approval entry from the result
   */
  static createApprovalEntry(
    toolName: string,
    scope: ApprovalScope,
    toolArgs?: Record<string, unknown>
  ): ApprovalEntry {
    const entry: ApprovalEntry = {
      toolName,
      approvedAt: Date.now(),
      scope,
    };

    // For 'always' scope, we might want to store the argument pattern
    // For now, we approve the tool name regardless of arguments
    if (scope === 'always' && toolArgs) {
      // Could add argument pattern matching here
    }

    return entry;
  }
}

// ==================== Singleton ====================

export const aiApprovalDialog = new AIApprovalDialog();
export default aiApprovalDialog;
