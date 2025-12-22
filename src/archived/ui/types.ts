/**
 * Shared UI Type Definitions
 *
 * Common types used across UI components for consistency.
 */

import type { Rect } from './layout.ts';

/**
 * Configuration passed to dialogs for positioning
 */
export interface DialogConfig {
  screenWidth: number;
  screenHeight: number;
  editorX?: number;
  editorWidth?: number;
}

/**
 * Result returned from a dialog interaction
 */
export interface DialogResult<T> {
  confirmed: boolean;
  value?: T;
}

/**
 * Standard callback type for dialog results
 */
export type DialogCallback<T> = (result: DialogResult<T>) => void;

/**
 * Border style options for dialogs
 */
export type BorderStyle = 'rounded' | 'square' | 'double' | 'none';

/**
 * Border characters for different styles
 */
export const BORDER_CHARS: Record<BorderStyle, {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
}> = {
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│'
  },
  square: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│'
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║'
  },
  none: {
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
    horizontal: ' ',
    vertical: ' '
  }
};

/**
 * Text alignment options
 */
export type TextAlign = 'left' | 'center' | 'right';

/**
 * Vertical alignment options
 */
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * Standard color scheme for dialogs
 */
export interface DialogColors {
  background: string;
  foreground: string;
  border: string;
  titleForeground: string;
  titleBackground: string;
  inputBackground: string;
  inputForeground: string;
  inputBorder: string;
  inputFocusBorder: string;
  selectedBackground: string;
  selectedForeground: string;
  hintForeground: string;
  successForeground: string;
  errorForeground: string;
}

/**
 * Default dialog colors (can be overridden by theme)
 */
export const DEFAULT_DIALOG_COLORS: DialogColors = {
  background: '#2d2d2d',
  foreground: '#d4d4d4',
  border: '#444444',
  titleForeground: '#c678dd',
  titleBackground: '#2d2d2d',
  inputBackground: '#3e3e3e',
  inputForeground: '#ffffff',
  inputBorder: '#3e3e3e',
  inputFocusBorder: '#007fd4',
  selectedBackground: '#3e5f8a',
  selectedForeground: '#ffffff',
  hintForeground: '#888888',
  successForeground: '#89d185',
  errorForeground: '#f48771'
};

/**
 * Re-export Rect for convenience
 */
export type { Rect };
