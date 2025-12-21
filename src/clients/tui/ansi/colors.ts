/**
 * ANSI Color Utilities
 *
 * Color conversion and ANSI color escape sequence generation.
 */

import { CSI } from './sequences.ts';

// ============================================
// Types
// ============================================

export interface RGB {
  r: number;
  g: number;
  b: number;
}

// ============================================
// Named Colors
// ============================================

/**
 * Standard terminal color names mapped to RGB values.
 */
export const NAMED_COLORS: Record<string, RGB> = {
  // Standard colors
  black: { r: 0, g: 0, b: 0 },
  red: { r: 205, g: 49, b: 49 },
  green: { r: 13, g: 188, b: 121 },
  yellow: { r: 229, g: 229, b: 16 },
  blue: { r: 36, g: 114, b: 200 },
  magenta: { r: 188, g: 63, b: 188 },
  cyan: { r: 17, g: 168, b: 205 },
  white: { r: 229, g: 229, b: 229 },

  // Bright colors
  brightBlack: { r: 102, g: 102, b: 102 },
  brightRed: { r: 241, g: 76, b: 76 },
  brightGreen: { r: 35, g: 209, b: 139 },
  brightYellow: { r: 245, g: 245, b: 67 },
  brightBlue: { r: 59, g: 142, b: 234 },
  brightMagenta: { r: 214, g: 112, b: 214 },
  brightCyan: { r: 41, g: 184, b: 219 },
  brightWhite: { r: 255, g: 255, b: 255 },

  // Aliases
  gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 },
  orange: { r: 255, g: 165, b: 0 },
  pink: { r: 255, g: 192, b: 203 },
  purple: { r: 128, g: 0, b: 128 },
  brown: { r: 139, g: 69, b: 19 },
};

// ============================================
// Color Parsing
// ============================================

/**
 * Parse a hex color string to RGB.
 * Supports formats: #RGB, #RRGGBB
 */
export function hexToRgb(hex: string): RGB | null {
  if (!hex.startsWith('#')) {
    return null;
  }

  const cleaned = hex.slice(1);

  if (cleaned.length === 3) {
    // Short form: #RGB -> #RRGGBB
    const c0 = cleaned[0]!;
    const c1 = cleaned[1]!;
    const c2 = cleaned[2]!;
    const r = parseInt(c0 + c0, 16);
    const g = parseInt(c1 + c1, 16);
    const b = parseInt(c2 + c2, 16);

    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      return null;
    }

    return { r, g, b };
  }

  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);

    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      return null;
    }

    return { r, g, b };
  }

  return null;
}

/**
 * Convert RGB to hex string.
 */
export function rgbToHex(rgb: RGB): string {
  const r = Math.max(0, Math.min(255, Math.round(rgb.r)));
  const g = Math.max(0, Math.min(255, Math.round(rgb.g)));
  const b = Math.max(0, Math.min(255, Math.round(rgb.b)));

  return (
    '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0')
  );
}

/**
 * Parse a color string to RGB.
 * Supports: hex (#RGB, #RRGGBB), named colors, 'default'
 */
export function parseColor(color: string): RGB | null {
  if (color === 'default') {
    return null;
  }

  // Try hex
  const hex = hexToRgb(color);
  if (hex) {
    return hex;
  }

  // Try named color
  const named = NAMED_COLORS[color.toLowerCase()];
  if (named) {
    return named;
  }

  return null;
}

// ============================================
// ANSI Color Sequences
// ============================================

/**
 * Reset all attributes.
 */
export function resetColor(): string {
  return `${CSI}0m`;
}

/**
 * Set foreground color to default.
 */
export function defaultFg(): string {
  return `${CSI}39m`;
}

/**
 * Set background color to default.
 */
export function defaultBg(): string {
  return `${CSI}49m`;
}

/**
 * Set 24-bit foreground color.
 */
export function fg24bit(r: number, g: number, b: number): string {
  return `${CSI}38;2;${r};${g};${b}m`;
}

/**
 * Set 24-bit background color.
 */
export function bg24bit(r: number, g: number, b: number): string {
  return `${CSI}48;2;${r};${g};${b}m`;
}

/**
 * Set foreground color from RGB.
 */
export function fgRgb(rgb: RGB): string {
  return fg24bit(rgb.r, rgb.g, rgb.b);
}

/**
 * Set background color from RGB.
 */
export function bgRgb(rgb: RGB): string {
  return bg24bit(rgb.r, rgb.g, rgb.b);
}

/**
 * Set foreground color from color string.
 * Returns empty string for 'default'.
 */
export function fgColor(color: string): string {
  if (color === 'default') {
    return defaultFg();
  }

  const rgb = parseColor(color);
  if (!rgb) {
    return defaultFg();
  }

  return fgRgb(rgb);
}

/**
 * Set background color from color string.
 * Returns empty string for 'default'.
 */
export function bgColor(color: string): string {
  if (color === 'default') {
    return defaultBg();
  }

  const rgb = parseColor(color);
  if (!rgb) {
    return defaultBg();
  }

  return bgRgb(rgb);
}

/**
 * Set 256-color foreground.
 */
export function fg256(colorIndex: number): string {
  return `${CSI}38;5;${colorIndex}m`;
}

/**
 * Set 256-color background.
 */
export function bg256(colorIndex: number): string {
  return `${CSI}48;5;${colorIndex}m`;
}

// ============================================
// Color Manipulation
// ============================================

/**
 * Lighten a color by a percentage (0-1).
 */
export function lighten(rgb: RGB, amount: number): RGB {
  return {
    r: Math.min(255, rgb.r + (255 - rgb.r) * amount),
    g: Math.min(255, rgb.g + (255 - rgb.g) * amount),
    b: Math.min(255, rgb.b + (255 - rgb.b) * amount),
  };
}

/**
 * Darken a color by a percentage (0-1).
 */
export function darken(rgb: RGB, amount: number): RGB {
  return {
    r: Math.max(0, rgb.r * (1 - amount)),
    g: Math.max(0, rgb.g * (1 - amount)),
    b: Math.max(0, rgb.b * (1 - amount)),
  };
}

/**
 * Mix two colors.
 */
export function mix(a: RGB, b: RGB, ratio = 0.5): RGB {
  return {
    r: a.r * (1 - ratio) + b.r * ratio,
    g: a.g * (1 - ratio) + b.g * ratio,
    b: a.b * (1 - ratio) + b.b * ratio,
  };
}

/**
 * Calculate relative luminance.
 */
export function luminance(rgb: RGB): number {
  const rsRGB = rgb.r / 255;
  const gsRGB = rgb.g / 255;
  const bsRGB = rgb.b / 255;

  const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : ((rsRGB + 0.055) / 1.055) ** 2.4;
  const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : ((gsRGB + 0.055) / 1.055) ** 2.4;
  const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : ((bsRGB + 0.055) / 1.055) ** 2.4;

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors.
 */
export function contrastRatio(a: RGB, b: RGB): number {
  const lumA = luminance(a);
  const lumB = luminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if a color is considered "dark".
 */
export function isDark(rgb: RGB): boolean {
  return luminance(rgb) < 0.5;
}

/**
 * Check if a color is considered "light".
 */
export function isLight(rgb: RGB): boolean {
  return luminance(rgb) >= 0.5;
}
