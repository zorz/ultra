/**
 * Input Dialog Component
 * 
 * Simple text input dialog for prompts like "Save As" filename.
 */

import type { RenderContext } from '../renderer.ts';
import { themeLoader } from '../themes/theme-loader.ts';

export class InputDialog {
  private isVisible: boolean = false;
  private title: string = '';
  private value: string = '';
  private placeholder: string = '';
  private x: number = 0;
  private y: number = 0;
  private width: number = 60;
  private onConfirmCallback: ((value: string) => void) | null = null;
  private onCancelCallback: (() => void) | null = null;

  /**
   * Show the input dialog
   */
  show(options: {
    title: string;
    placeholder?: string;
    initialValue?: string;
    screenWidth: number;
    screenHeight: number;
    onConfirm: (value: string) => void;
    onCancel?: () => void;
  }): void {
    this.isVisible = true;
    this.title = options.title;
    this.placeholder = options.placeholder || '';
    this.value = options.initialValue || '';
    this.onConfirmCallback = options.onConfirm;
    this.onCancelCallback = options.onCancel || null;

    // Center the dialog
    this.width = Math.min(60, options.screenWidth - 4);
    this.x = Math.floor((options.screenWidth - this.width) / 2) + 1;
    this.y = Math.floor(options.screenHeight / 3);
  }

  /**
   * Hide the dialog
   */
  hide(): void {
    this.isVisible = false;
  }

  /**
   * Check if dialog is open
   */
  isOpen(): boolean {
    return this.isVisible;
  }

  /**
   * Get current value
   */
  getValue(): string {
    return this.value;
  }

  /**
   * Set value
   */
  setValue(value: string): void {
    this.value = value;
  }

  /**
   * Append character to value
   */
  appendChar(char: string): void {
    this.value += char;
  }

  /**
   * Delete last character
   */
  backspace(): void {
    if (this.value.length > 0) {
      this.value = this.value.slice(0, -1);
    }
  }

  /**
   * Confirm the input
   */
  confirm(): void {
    if (this.onConfirmCallback && this.value.length > 0) {
      this.onConfirmCallback(this.value);
    }
    this.hide();
  }

  /**
   * Cancel the input
   */
  cancel(): void {
    if (this.onCancelCallback) {
      this.onCancelCallback();
    }
    this.hide();
  }

  /**
   * Render the dialog
   */
  render(ctx: RenderContext): void {
    if (!this.isVisible) return;

    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const moveTo = (x: number, y: number) => `\x1b[${y};${x}H`;
    const reset = '\x1b[0m';

    // Get theme colors
    const inputBg = this.hexToRgb(themeLoader.getColor('input.background')) || { r: 60, g: 60, b: 60 };
    const inputFg = this.hexToRgb(themeLoader.getColor('input.foreground')) || { r: 204, g: 204, b: 204 };
    const titleFg = this.hexToRgb(themeLoader.getColor('sideBarTitle.foreground')) || { r: 187, g: 187, b: 187 };
    const sidebarBg = this.hexToRgb(themeLoader.getColor('sideBar.background')) || { r: 37, g: 37, b: 38 };

    let output = '';

    // Dialog background (5 lines: border, title, input, hint, border)
    const dialogHeight = 5;
    for (let i = 0; i < dialogHeight; i++) {
      output += moveTo(this.x, this.y + i);
      output += reset;
      output += bgRgb(sidebarBg.r, sidebarBg.g, sidebarBg.b);
      output += ' '.repeat(this.width);
    }

    // Title
    output += moveTo(this.x + 2, this.y + 1);
    output += reset;
    output += bgRgb(sidebarBg.r, sidebarBg.g, sidebarBg.b);
    output += fgRgb(titleFg.r, titleFg.g, titleFg.b);
    output += this.title.slice(0, this.width - 4);

    // Input field background
    output += moveTo(this.x + 2, this.y + 2);
    output += reset;
    output += bgRgb(inputBg.r, inputBg.g, inputBg.b);
    output += fgRgb(inputFg.r, inputFg.g, inputFg.b);
    
    const inputWidth = this.width - 4;
    const displayValue = this.value || this.placeholder;
    const paddedValue = displayValue.slice(0, inputWidth).padEnd(inputWidth, ' ');
    output += paddedValue;

    // Cursor (show as inverse character)
    const cursorPos = this.value.length;
    if (cursorPos < inputWidth) {
      output += moveTo(this.x + 2 + cursorPos, this.y + 2);
      output += reset;
      output += '\x1b[7m'; // Inverse
      output += bgRgb(inputBg.r, inputBg.g, inputBg.b);
      const charUnderCursor = cursorPos < this.value.length ? this.value[cursorPos] : ' ';
      output += charUnderCursor;
      output += reset;
    }

    // Hint
    output += moveTo(this.x + 2, this.y + 4);
    output += reset;
    output += bgRgb(sidebarBg.r, sidebarBg.g, sidebarBg.b);
    output += fgRgb(100, 100, 100);
    output += 'Enter to confirm, Escape to cancel'.slice(0, this.width - 4);

    output += reset;
    ctx.buffer(output);
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    if (!hex || !hex.startsWith('#')) return null;
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1]!, 16),
      g: parseInt(result[2]!, 16),
      b: parseInt(result[3]!, 16)
    } : null;
  }
}

export const inputDialog = new InputDialog();
