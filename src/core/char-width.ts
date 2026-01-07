/**
 * Character Width Utilities
 *
 * Shared utilities for calculating the display width of Unicode characters
 * in terminal cells. Used by both PTY and TUI rendering layers to ensure
 * consistent width calculations.
 */

/**
 * Get display width of a single character in terminal cells.
 * Handles emoji, CJK, zero-width characters, and other wide characters.
 *
 * @param char - A single Unicode character (may be multiple UTF-16 code units)
 * @returns 0 for zero-width, 1 for normal, 2 for wide characters
 */
export function getCharWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;

  // ASCII control chars
  if (code < 32) return 0;

  // Basic ASCII (most common case)
  if (code < 127) return 1;

  // Zero-width characters (must check before other ranges)
  if (
    (code >= 0x200b && code <= 0x200f) || // Zero-width space, joiners, direction marks
    (code >= 0x2028 && code <= 0x202f) || // Line/paragraph separators, embedding controls
    (code >= 0x2060 && code <= 0x206f) || // Word joiner, invisible operators
    (code >= 0xfe00 && code <= 0xfe0f) || // Variation Selectors (VS1-VS16)
    (code >= 0xfeff && code <= 0xfeff) || // BOM / Zero-width no-break space
    (code >= 0xe0100 && code <= 0xe01ef) || // Variation Selectors Supplement
    (code >= 0x0300 && code <= 0x036f) || // Combining Diacritical Marks
    (code >= 0x0483 && code <= 0x0489) || // Combining Cyrillic marks
    (code >= 0x0591 && code <= 0x05bd) || // Hebrew combining marks
    (code >= 0x1ab0 && code <= 0x1aff) || // Combining Diacritical Marks Extended
    (code >= 0x1dc0 && code <= 0x1dff) || // Combining Diacritical Marks Supplement
    (code >= 0x20d0 && code <= 0x20ff) || // Combining Diacritical Marks for Symbols
    (code >= 0xfe20 && code <= 0xfe2f) // Combining Half Marks
  ) {
    return 0;
  }

  // Common emoji ranges (2 cells wide)
  // Note: Most characters in Geometric shapes (U+25xx), Misc Symbols (U+26xx),
  // and Dingbats (U+27xx) are width 1. Only specific characters with
  // Emoji_Presentation=Yes are width 2. Characters like ⚠, ✓, ✗, ● are width 1.
  if (
    (code >= 0x1f300 && code <= 0x1f9ff) || // Misc Symbols, Emoticons, Symbols & Pictographs
    (code >= 0x1f600 && code <= 0x1f64f) || // Emoticons
    (code >= 0x1f680 && code <= 0x1f6ff) || // Transport/Map
    (code >= 0x1f1e0 && code <= 0x1f1ff) || // Flags
    (code >= 0x231a && code <= 0x231b) || // Watch, Hourglass
    (code >= 0x23e9 && code <= 0x23f3) || // Media control symbols (includes ⏸)
    (code >= 0x23f8 && code <= 0x23fa) || // Media control symbols (pause, record, etc.)
    (code >= 0x2934 && code <= 0x2935) || // Arrows
    (code >= 0x2b05 && code <= 0x2b07) || // Arrows
    (code >= 0x2b1b && code <= 0x2b1c) || // Large squares
    (code >= 0x2b50 && code <= 0x2b55) || // Star, circles
    (code >= 0x3030 && code <= 0x303d) || // CJK symbols
    (code >= 0x1f004 && code <= 0x1f0cf) || // Mahjong, Playing cards
    // Specific Dingbats emoji (Emoji_Presentation=Yes)
    code === 0x2705 || // ✅ White Heavy Check Mark
    code === 0x274c || // ❌ Cross Mark
    code === 0x274e || // ❎ Cross Mark Button
    (code >= 0x2753 && code <= 0x2755) || // ❓❔❕ Question/Exclamation marks
    code === 0x2757 || // ❗ Heavy Exclamation Mark
    // Specific Misc Symbols emoji (Emoji_Presentation=Yes)
    (code >= 0x26aa && code <= 0x26ab) || // ⚪⚫ White/Black circles
    (code >= 0x26bd && code <= 0x26be) || // ⚽⚾ Soccer/Baseball
    (code >= 0x26c4 && code <= 0x26c5) || // ⛄⛅ Snowman/Sun behind cloud
    code === 0x26ce || // ⛎ Ophiuchus
    code === 0x26d4 || // ⛔ No Entry
    code === 0x26ea || // ⛪ Church
    (code >= 0x26f2 && code <= 0x26f3) || // ⛲⛳ Fountain/Golf
    code === 0x26f5 || // ⛵ Sailboat
    code === 0x26fa || // ⛺ Tent
    code === 0x26fd // ⛽ Fuel pump
  ) {
    return 2;
  }

  // CJK and other wide characters (2 cells wide)
  if (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK, Yi, etc.
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility
    (code >= 0xfe10 && code <= 0xfe1f) || // Vertical forms
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Forms
    (code >= 0x20000 && code <= 0x2ffff) // CJK Extension B-F
  ) {
    return 2;
  }

  // Default to 1 for other printable characters
  return code >= 0x20 ? 1 : 0;
}

/**
 * Get display width of a string (accounting for wide chars).
 *
 * @param str - The string to measure
 * @returns Total display width in terminal cells
 */
export function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    width += getCharWidth(char);
  }
  return width;
}

/**
 * Truncate string to fit display width.
 *
 * @param str - The string to truncate
 * @param maxWidth - Maximum display width
 * @param ellipsis - Ellipsis character to append (default: '...')
 * @returns Truncated string fitting within maxWidth
 */
export function truncateToWidth(
  str: string,
  maxWidth: number,
  ellipsis: string = '...'
): string {
  const ellipsisWidth = getDisplayWidth(ellipsis);
  if (getDisplayWidth(str) <= maxWidth) {
    return str;
  }

  let width = 0;
  let result = '';
  for (const char of str) {
    const charWidth = getCharWidth(char);
    if (width + charWidth + ellipsisWidth > maxWidth) {
      return result + ellipsis;
    }
    result += char;
    width += charWidth;
  }
  return result;
}

/**
 * Pad string to exact display width.
 *
 * @param str - The string to pad
 * @param width - Target display width
 * @param align - Alignment: 'left', 'right', or 'center'
 * @returns Padded string at exact width
 */
export function padToWidth(
  str: string,
  width: number,
  align: 'left' | 'right' | 'center' = 'left'
): string {
  const currentWidth = getDisplayWidth(str);
  if (currentWidth >= width) {
    return truncateToWidth(str, width);
  }

  const padding = width - currentWidth;
  switch (align) {
    case 'right':
      return ' '.repeat(padding) + str;
    case 'center': {
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return ' '.repeat(left) + str + ' '.repeat(right);
    }
    default:
      return str + ' '.repeat(padding);
  }
}
