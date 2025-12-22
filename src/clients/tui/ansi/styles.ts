/**
 * ANSI Text Styles
 *
 * Text styling escape sequences and utilities for combining styles.
 */

import { CSI } from './sequences.ts';
import { fgColor, bgColor, resetColor, parseColor } from './colors.ts';
import type { Cell, UnderlineStyle } from '../types.ts';

// ============================================
// Individual Style Codes
// ============================================

/** Enable bold (increased intensity) */
export function bold(): string {
  return `${CSI}1m`;
}

/** Disable bold */
export function boldOff(): string {
  return `${CSI}22m`;
}

/** Enable dim (decreased intensity) */
export function dim(): string {
  return `${CSI}2m`;
}

/** Disable dim */
export function dimOff(): string {
  return `${CSI}22m`;
}

/** Enable italic */
export function italic(): string {
  return `${CSI}3m`;
}

/** Disable italic */
export function italicOff(): string {
  return `${CSI}23m`;
}

/** Enable underline (single style) */
export function underline(): string {
  return `${CSI}4m`;
}

/**
 * Enable underline with specific style.
 * Uses extended SGR codes (CSI 4:<style>m) for different underline styles.
 * Supported by: Kitty, WezTerm, iTerm2, foot, Alacritty (0.13+), etc.
 * Terminals that don't support will typically fall back to single underline.
 *
 * Style codes:
 * - 0 = no underline (same as CSI 24m)
 * - 1 = single underline (default)
 * - 2 = double underline
 * - 3 = curly/wavy underline (squiggly)
 * - 4 = dotted underline
 * - 5 = dashed underline
 */
export function underlineStyled(style: UnderlineStyle): string {
  const styleCode: Record<UnderlineStyle, number> = {
    single: 1,
    double: 2,
    curly: 3,
    dotted: 4,
    dashed: 5,
  };
  return `${CSI}4:${styleCode[style]}m`;
}

/**
 * Set underline color using 24-bit RGB.
 * Uses extended SGR code (CSI 58:2::r:g:bm).
 * Supported by: Kitty, WezTerm, iTerm2, foot, Alacritty (0.13+), etc.
 */
export function underlineColor24bit(r: number, g: number, b: number): string {
  return `${CSI}58:2::${r}:${g}:${b}m`;
}

/**
 * Set underline color from color string.
 * Returns empty string if color is 'default' or invalid.
 */
export function underlineColorFromString(color: string): string {
  if (color === 'default') {
    return '';
  }
  const rgb = parseColor(color);
  if (!rgb) {
    return '';
  }
  return underlineColor24bit(rgb.r, rgb.g, rgb.b);
}

/**
 * Reset underline color to default.
 */
export function underlineColorDefault(): string {
  return `${CSI}59m`;
}

/** Disable underline */
export function underlineOff(): string {
  return `${CSI}24m`;
}

/** Enable blinking */
export function blink(): string {
  return `${CSI}5m`;
}

/** Disable blinking */
export function blinkOff(): string {
  return `${CSI}25m`;
}

/** Enable inverse (swap fg/bg) */
export function inverse(): string {
  return `${CSI}7m`;
}

/** Disable inverse */
export function inverseOff(): string {
  return `${CSI}27m`;
}

/** Enable hidden (invisible) */
export function hidden(): string {
  return `${CSI}8m`;
}

/** Disable hidden */
export function hiddenOff(): string {
  return `${CSI}28m`;
}

/** Enable strikethrough */
export function strikethrough(): string {
  return `${CSI}9m`;
}

/** Disable strikethrough */
export function strikethroughOff(): string {
  return `${CSI}29m`;
}

// ============================================
// Style Options Interface
// ============================================

export interface StyleOptions {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  underlineStyle?: UnderlineStyle;
  underlineColor?: string;
  blink?: boolean;
  inverse?: boolean;
  hidden?: boolean;
  strikethrough?: boolean;
}

// ============================================
// Combined Style Sequences
// ============================================

/**
 * Build a style sequence from options.
 */
export function buildStyle(options: StyleOptions): string {
  const parts: string[] = [];

  if (options.fg) {
    parts.push(fgColor(options.fg));
  }

  if (options.bg) {
    parts.push(bgColor(options.bg));
  }

  if (options.bold) {
    parts.push(bold());
  }

  if (options.dim) {
    parts.push(dim());
  }

  if (options.italic) {
    parts.push(italic());
  }

  if (options.underline) {
    // Use styled underline if a style is specified, otherwise use simple underline
    if (options.underlineStyle) {
      parts.push(underlineStyled(options.underlineStyle));
    } else {
      parts.push(underline());
    }
    // Apply underline color if specified
    if (options.underlineColor) {
      parts.push(underlineColorFromString(options.underlineColor));
    }
  }

  if (options.blink) {
    parts.push(blink());
  }

  if (options.inverse) {
    parts.push(inverse());
  }

  if (options.hidden) {
    parts.push(hidden());
  }

  if (options.strikethrough) {
    parts.push(strikethrough());
  }

  return parts.join('');
}

/**
 * Build a style sequence from a Cell.
 */
export function cellStyle(cell: Cell): string {
  return buildStyle({
    fg: cell.fg,
    bg: cell.bg,
    bold: cell.bold,
    dim: cell.dim,
    italic: cell.italic,
    underline: cell.underline,
    underlineStyle: cell.underlineStyle,
    underlineColor: cell.underlineColor,
    strikethrough: cell.strikethrough,
  });
}

/**
 * Wrap text with style and reset.
 */
export function styled(text: string, options: StyleOptions): string {
  return buildStyle(options) + text + resetColor();
}

// ============================================
// Diff-based Style Updates
// ============================================

/**
 * Attributes that changed between two cells.
 */
export interface StyleDiff {
  fgChanged: boolean;
  bgChanged: boolean;
  boldChanged: boolean;
  dimChanged: boolean;
  italicChanged: boolean;
  underlineChanged: boolean;
  underlineStyleChanged: boolean;
  underlineColorChanged: boolean;
  strikethroughChanged: boolean;
}

/**
 * Compare two cells and determine what changed.
 */
export function diffCells(prev: Cell | null, next: Cell): StyleDiff {
  if (!prev) {
    return {
      fgChanged: true,
      bgChanged: true,
      boldChanged: !!next.bold,
      dimChanged: !!next.dim,
      italicChanged: !!next.italic,
      underlineChanged: !!next.underline,
      underlineStyleChanged: !!next.underlineStyle,
      underlineColorChanged: !!next.underlineColor,
      strikethroughChanged: !!next.strikethrough,
    };
  }

  return {
    fgChanged: prev.fg !== next.fg,
    bgChanged: prev.bg !== next.bg,
    boldChanged: prev.bold !== next.bold,
    dimChanged: prev.dim !== next.dim,
    italicChanged: prev.italic !== next.italic,
    underlineChanged: prev.underline !== next.underline,
    underlineStyleChanged: prev.underlineStyle !== next.underlineStyle,
    underlineColorChanged: prev.underlineColor !== next.underlineColor,
    strikethroughChanged: prev.strikethrough !== next.strikethrough,
  };
}

/**
 * Build minimal style sequence for transition from prev to next cell.
 * Returns empty string if no style changes needed.
 */
export function transitionStyle(prev: Cell | null, next: Cell): string {
  const diff = diffCells(prev, next);
  const parts: string[] = [];

  // Check if we need a full reset (going from styled to unstyled)
  const prevHasStyle = prev && (prev.bold || prev.dim || prev.italic || prev.underline || prev.strikethrough);
  const nextHasStyle = next.bold || next.dim || next.italic || next.underline || next.strikethrough;

  // If previous had styles that next doesn't have, we might need individual off sequences
  // For simplicity, if any style is being turned off, we could reset and reapply
  // But more optimally, we apply individual off sequences

  if (diff.fgChanged) {
    parts.push(fgColor(next.fg));
  }

  if (diff.bgChanged) {
    parts.push(bgColor(next.bg));
  }

  if (diff.boldChanged) {
    parts.push(next.bold ? bold() : boldOff());
  }

  if (diff.dimChanged) {
    parts.push(next.dim ? dim() : dimOff());
  }

  if (diff.italicChanged) {
    parts.push(next.italic ? italic() : italicOff());
  }

  // Handle underline changes (including style and color)
  if (diff.underlineChanged || diff.underlineStyleChanged) {
    if (next.underline) {
      // Apply underline with style
      if (next.underlineStyle) {
        parts.push(underlineStyled(next.underlineStyle));
      } else {
        parts.push(underline());
      }
    } else {
      parts.push(underlineOff());
    }
  }

  // Handle underline color changes (only if underline is on)
  if (next.underline && (diff.underlineColorChanged || diff.underlineChanged)) {
    if (next.underlineColor) {
      parts.push(underlineColorFromString(next.underlineColor));
    } else if (prev?.underlineColor) {
      // Reset underline color if it was previously set
      parts.push(underlineColorDefault());
    }
  }

  if (diff.strikethroughChanged) {
    parts.push(next.strikethrough ? strikethrough() : strikethroughOff());
  }

  return parts.join('');
}

/**
 * Check if any style attribute differs between cells.
 */
export function stylesMatch(a: Cell, b: Cell): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.underlineStyle === b.underlineStyle &&
    a.underlineColor === b.underlineColor &&
    a.strikethrough === b.strikethrough
  );
}
