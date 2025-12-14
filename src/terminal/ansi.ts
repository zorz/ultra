/**
 * ANSI Escape Code Constants and Utilities
 * 
 * Provides low-level ANSI escape sequences for terminal control.
 */

// Control characters
export const ESC = '\x1b';
export const CSI = `${ESC}[`;  // Control Sequence Introducer

// Cursor control
export const CURSOR = {
  hide: `${CSI}?25l`,
  show: `${CSI}?25h`,
  save: `${CSI}s`,
  restore: `${CSI}u`,
  // Position: row and col are 1-indexed
  moveTo: (row: number, col: number) => `${CSI}${row};${col}H`,
  moveUp: (n: number = 1) => `${CSI}${n}A`,
  moveDown: (n: number = 1) => `${CSI}${n}B`,
  moveRight: (n: number = 1) => `${CSI}${n}C`,
  moveLeft: (n: number = 1) => `${CSI}${n}D`,
  // Cursor shapes
  shape: {
    block: `${CSI}2 q`,
    underline: `${CSI}4 q`,
    bar: `${CSI}6 q`,
    blinkingBlock: `${CSI}1 q`,
    blinkingUnderline: `${CSI}3 q`,
    blinkingBar: `${CSI}5 q`,
  }
};

// Screen control
export const SCREEN = {
  clear: `${CSI}2J`,
  clearLine: `${CSI}2K`,
  clearToEnd: `${CSI}0K`,
  clearToStart: `${CSI}1K`,
  clearBelow: `${CSI}0J`,
  clearAbove: `${CSI}1J`,
  // Alternate screen buffer (for fullscreen apps)
  enterAlt: `${CSI}?1049h`,
  exitAlt: `${CSI}?1049l`,
  // Scroll region
  setScrollRegion: (top: number, bottom: number) => `${CSI}${top};${bottom}r`,
  resetScrollRegion: `${CSI}r`,
};

// Text styles
export const STYLE = {
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  italic: `${CSI}3m`,
  underline: `${CSI}4m`,
  blink: `${CSI}5m`,
  inverse: `${CSI}7m`,
  hidden: `${CSI}8m`,
  strikethrough: `${CSI}9m`,
  // Reset individual styles
  noBold: `${CSI}22m`,
  noItalic: `${CSI}23m`,
  noUnderline: `${CSI}24m`,
  noBlink: `${CSI}25m`,
  noInverse: `${CSI}27m`,
  noHidden: `${CSI}28m`,
  noStrikethrough: `${CSI}29m`,
};

// Basic 16 colors (foreground)
export const FG = {
  black: `${CSI}30m`,
  red: `${CSI}31m`,
  green: `${CSI}32m`,
  yellow: `${CSI}33m`,
  blue: `${CSI}34m`,
  magenta: `${CSI}35m`,
  cyan: `${CSI}36m`,
  white: `${CSI}37m`,
  default: `${CSI}39m`,
  // Bright variants
  brightBlack: `${CSI}90m`,
  brightRed: `${CSI}91m`,
  brightGreen: `${CSI}92m`,
  brightYellow: `${CSI}93m`,
  brightBlue: `${CSI}94m`,
  brightMagenta: `${CSI}95m`,
  brightCyan: `${CSI}96m`,
  brightWhite: `${CSI}97m`,
  // 256 color
  color256: (n: number) => `${CSI}38;5;${n}m`,
  // True color (24-bit)
  rgb: (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`,
};

// Basic 16 colors (background)
export const BG = {
  black: `${CSI}40m`,
  red: `${CSI}41m`,
  green: `${CSI}42m`,
  yellow: `${CSI}43m`,
  blue: `${CSI}44m`,
  magenta: `${CSI}45m`,
  cyan: `${CSI}46m`,
  white: `${CSI}47m`,
  default: `${CSI}49m`,
  // Bright variants
  brightBlack: `${CSI}100m`,
  brightRed: `${CSI}101m`,
  brightGreen: `${CSI}102m`,
  brightYellow: `${CSI}103m`,
  brightBlue: `${CSI}104m`,
  brightMagenta: `${CSI}105m`,
  brightCyan: `${CSI}106m`,
  brightWhite: `${CSI}107m`,
  // 256 color
  color256: (n: number) => `${CSI}48;5;${n}m`,
  // True color (24-bit)
  rgb: (r: number, g: number, b: number) => `${CSI}48;2;${r};${g};${b}m`,
};

// Mouse tracking
export const MOUSE = {
  // Basic mouse tracking (X10 mode)
  enableBasic: `${CSI}?9h`,
  disableBasic: `${CSI}?9l`,
  // Button event tracking
  enableButton: `${CSI}?1000h`,
  disableButton: `${CSI}?1000l`,
  // Any event tracking (includes motion while button pressed)
  enableAny: `${CSI}?1003h`,
  disableAny: `${CSI}?1003l`,
  // SGR extended mode (for coordinates > 223)
  enableSGR: `${CSI}?1006h`,
  disableSGR: `${CSI}?1006l`,
  // UTF-8 mode
  enableUTF8: `${CSI}?1005h`,
  disableUTF8: `${CSI}?1005l`,
};

// Bracketed paste mode
export const PASTE = {
  enable: `${CSI}?2004h`,
  disable: `${CSI}?2004l`,
  start: `${ESC}[200~`,
  end: `${ESC}[201~`,
};

/**
 * Convert hex color to RGB tuple
 */
export function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return [
      parseInt(result[1]!, 16),
      parseInt(result[2]!, 16),
      parseInt(result[3]!, 16)
    ];
  }
  return [255, 255, 255];  // Default to white
}

/**
 * Create foreground color from hex
 */
export function fgHex(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return FG.rgb(r, g, b);
}

/**
 * Create background color from hex
 */
export function bgHex(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return BG.rgb(r, g, b);
}

/**
 * Combine multiple style codes
 */
export function style(...codes: string[]): string {
  return codes.join('');
}

/**
 * Style text and reset after
 */
export function styled(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${STYLE.reset}`;
}

/**
 * Get display width of a string (accounting for wide chars)
 */
export function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    // Simple heuristic: CJK characters and some others are double-width
    if (
      (code >= 0x1100 && code <= 0x115F) ||  // Hangul Jamo
      (code >= 0x2E80 && code <= 0xA4CF) ||  // CJK, Yi, etc.
      (code >= 0xAC00 && code <= 0xD7A3) ||  // Hangul Syllables
      (code >= 0xF900 && code <= 0xFAFF) ||  // CJK Compatibility
      (code >= 0xFE10 && code <= 0xFE1F) ||  // Vertical forms
      (code >= 0xFE30 && code <= 0xFE6F) ||  // CJK Compatibility Forms
      (code >= 0xFF00 && code <= 0xFF60) ||  // Fullwidth Forms
      (code >= 0xFFE0 && code <= 0xFFE6) ||  // Fullwidth Forms
      (code >= 0x20000 && code <= 0x2FFFF)   // CJK Extension B-F
    ) {
      width += 2;
    } else if (code >= 0x20) {  // Printable characters
      width += 1;
    }
    // Control characters and combining marks have width 0
  }
  return width;
}

/**
 * Truncate string to fit display width
 */
export function truncateToWidth(str: string, maxWidth: number, ellipsis: string = '…'): string {
  const ellipsisWidth = getDisplayWidth(ellipsis);
  if (getDisplayWidth(str) <= maxWidth) {
    return str;
  }
  
  let width = 0;
  let result = '';
  for (const char of str) {
    const charWidth = getDisplayWidth(char);
    if (width + charWidth + ellipsisWidth > maxWidth) {
      return result + ellipsis;
    }
    result += char;
    width += charWidth;
  }
  return result;
}

/**
 * Pad string to exact display width
 */
export function padToWidth(str: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const currentWidth = getDisplayWidth(str);
  if (currentWidth >= width) {
    return truncateToWidth(str, width);
  }
  
  const padding = width - currentWidth;
  switch (align) {
    case 'right':
      return ' '.repeat(padding) + str;
    case 'center':
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return ' '.repeat(left) + str + ' '.repeat(right);
    default:
      return str + ' '.repeat(padding);
  }
}
