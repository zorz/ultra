/**
 * Shared Color Utilities
 *
 * Centralized color manipulation functions used throughout the UI.
 * Replaces duplicate hexToRgb implementations across components.
 *
 * Supports:
 * - Hex to RGB conversion (object and tuple formats)
 * - RGB to hex conversion
 * - Color manipulation (lighten, darken, blend)
 * - ANSI escape sequences for terminal output
 */

// ==================== Types ====================

/**
 * RGB color as object with named properties
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * RGBA color with alpha channel
 */
export interface RGBA extends RGB {
  a: number;
}

/**
 * RGB color as tuple [r, g, b]
 */
export type RGBTuple = [number, number, number];

// ==================== Conversion Functions ====================

/**
 * Parse hex color to RGB object
 *
 * @param hex - Color in #RRGGBB or RRGGBB format
 * @returns RGB object or null if invalid
 *
 * @example
 * hexToRgb('#ff5500') // { r: 255, g: 85, b: 0 }
 * hexToRgb('ff5500')  // { r: 255, g: 85, b: 0 }
 * hexToRgb(undefined) // null
 */
export function hexToRgb(hex: string | undefined): RGB | null {
  if (!hex) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1]!, 16),
        g: parseInt(result[2]!, 16),
        b: parseInt(result[3]!, 16),
      }
    : null;
}

/**
 * Parse hex color to RGB tuple
 *
 * @param hex - Color in #RRGGBB or RRGGBB format
 * @returns RGB tuple or default white [255, 255, 255] if invalid
 *
 * @example
 * hexToRgbTuple('#ff5500') // [255, 85, 0]
 */
export function hexToRgbTuple(hex: string): RGBTuple {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return [
      parseInt(result[1]!, 16),
      parseInt(result[2]!, 16),
      parseInt(result[3]!, 16),
    ];
  }
  return [255, 255, 255]; // Default to white
}

/**
 * Convert RGB object to hex string
 *
 * @param rgb - RGB color object
 * @returns Hex string in #RRGGBB format
 *
 * @example
 * rgbToHex({ r: 255, g: 85, b: 0 }) // '#ff5500'
 */
export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Convert RGB tuple to hex string
 *
 * @param tuple - RGB values as [r, g, b]
 * @returns Hex string in #RRGGBB format
 */
export function rgbTupleToHex(tuple: RGBTuple): string {
  return rgbToHex({ r: tuple[0], g: tuple[1], b: tuple[2] });
}

// ==================== Color Manipulation ====================

/**
 * Lighten a hex color by a percentage
 *
 * @param hex - Base color in hex format
 * @param percent - Amount to lighten (0-100)
 * @returns Lightened color in hex format
 *
 * @example
 * lighten('#000000', 50) // '#808080'
 */
export function lighten(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = percent / 100;
  return rgbToHex({
    r: rgb.r + (255 - rgb.r) * factor,
    g: rgb.g + (255 - rgb.g) * factor,
    b: rgb.b + (255 - rgb.b) * factor,
  });
}

/**
 * Darken a hex color by a percentage
 *
 * @param hex - Base color in hex format
 * @param percent - Amount to darken (0-100)
 * @returns Darkened color in hex format
 *
 * @example
 * darken('#ffffff', 50) // '#808080'
 */
export function darken(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = 1 - percent / 100;
  return rgbToHex({
    r: rgb.r * factor,
    g: rgb.g * factor,
    b: rgb.b * factor,
  });
}

/**
 * Blend two hex colors together
 *
 * @param base - Base color in hex format
 * @param blend - Color to blend in
 * @param amount - Blend ratio (0 = all base, 1 = all blend)
 * @returns Blended color in hex format
 *
 * @example
 * blendColors('#000000', '#ffffff', 0.5) // '#808080'
 */
export function blendColors(base: string, blend: string, amount: number): string {
  const baseRgb = hexToRgb(base);
  const blendRgb = hexToRgb(blend);
  if (!baseRgb || !blendRgb) return base;

  return rgbToHex({
    r: baseRgb.r + (blendRgb.r - baseRgb.r) * amount,
    g: baseRgb.g + (blendRgb.g - baseRgb.g) * amount,
    b: baseRgb.b + (blendRgb.b - baseRgb.b) * amount,
  });
}

/**
 * Adjust brightness of a color
 *
 * @param hex - Color in hex format
 * @param amount - Brightness adjustment (-100 to 100)
 * @returns Adjusted color in hex format
 *
 * @example
 * adjustBrightness('#808080', 50)  // lighter
 * adjustBrightness('#808080', -50) // darker
 */
export function adjustBrightness(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  return rgbToHex({
    r: Math.max(0, Math.min(255, rgb.r + amount)),
    g: Math.max(0, Math.min(255, rgb.g + amount)),
    b: Math.max(0, Math.min(255, rgb.b + amount)),
  });
}

/**
 * Calculate relative luminance of a color (for contrast calculations)
 *
 * @param hex - Color in hex format
 * @returns Luminance value (0-1)
 */
export function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Calculate contrast ratio between two colors
 *
 * @param hex1 - First color in hex format
 * @param hex2 - Second color in hex format
 * @returns Contrast ratio (1-21)
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determine if a color is "light" (for choosing contrasting text)
 *
 * @param hex - Color in hex format
 * @returns true if the color is light
 */
export function isLightColor(hex: string): boolean {
  return getLuminance(hex) > 0.5;
}

// ==================== ANSI Terminal Sequences ====================

/**
 * Create ANSI foreground color escape sequence from hex
 *
 * @param hex - Color in hex format
 * @returns ANSI escape sequence string
 */
export function fgAnsi(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

/**
 * Create ANSI background color escape sequence from hex
 *
 * @param hex - Color in hex format
 * @returns ANSI escape sequence string
 */
export function bgAnsi(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

// ==================== Default Color Values ====================

/**
 * Default RGB values for fallbacks
 */
export const DEFAULT_RGB: RGB = { r: 255, g: 255, b: 255 };

/**
 * Default colors for common UI elements
 */
export const DEFAULT_COLORS = {
  background: { r: 37, g: 37, b: 38 },
  foreground: { r: 204, g: 204, b: 204 },
  selection: { r: 62, g: 68, b: 81 },
  cursor: { r: 82, g: 139, b: 255 },
  lineHighlight: { r: 44, g: 49, b: 60 },
  border: { r: 35, g: 38, b: 52 },
} as const;

// ==================== Helper for Safe Color Retrieval ====================

/**
 * Get RGB from hex with a fallback default
 *
 * @param hex - Color in hex format (may be undefined)
 * @param defaultRgb - Fallback RGB value
 * @returns RGB object (never null)
 *
 * @example
 * const bg = getColorOrDefault(themeLoader.getColor('editor.background'), { r: 40, g: 44, b: 52 });
 */
export function getColorOrDefault(hex: string | undefined, defaultRgb: RGB): RGB {
  return hexToRgb(hex) ?? defaultRgb;
}
