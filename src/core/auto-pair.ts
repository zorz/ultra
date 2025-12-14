/**
 * Auto-Pairing Logic
 * 
 * Automatically inserts closing brackets, quotes, and other pairs
 * when the user types an opening character.
 */

export interface PairConfig {
  open: string;
  close: string;
  /** Only auto-pair if the next char matches this pattern (or end of line) */
  notBefore?: RegExp;
}

// Default pairs to auto-complete
const DEFAULT_PAIRS: PairConfig[] = [
  { open: '{', close: '}', notBefore: /^[^\s\}\]\)]/ },
  { open: '[', close: ']', notBefore: /^[^\s\}\]\)]/ },
  { open: '(', close: ')', notBefore: /^[^\s\}\]\)]/ },
  { open: '"', close: '"', notBefore: /^[^\s\}\]\)"]/ },
  { open: "'", close: "'", notBefore: /^[^\s\}\]\)']/ },
  { open: '`', close: '`', notBefore: /^[^\s\}\]\)`]/ },
];

// Map for quick lookup
const PAIR_MAP = new Map<string, PairConfig>();
for (const pair of DEFAULT_PAIRS) {
  PAIR_MAP.set(pair.open, pair);
}

// Closing chars that can be "typed over"
const CLOSING_CHARS = new Set(['}', ']', ')', '"', "'", '`']);

/**
 * Check if we should auto-pair when typing a character
 */
export function shouldAutoPair(
  char: string,
  charAfterCursor: string | undefined
): PairConfig | null {
  const pair = PAIR_MAP.get(char);
  if (!pair) return null;
  
  // Check if the character after cursor would prevent pairing
  if (pair.notBefore && charAfterCursor) {
    if (pair.notBefore.test(charAfterCursor)) {
      return null;
    }
  }
  
  // For quotes, don't auto-pair if we're likely inside a string already
  // Simple heuristic: if the char before is alphanumeric, don't pair quotes
  // (This would need the char before cursor, but we'll handle this in the caller)
  
  return pair;
}

/**
 * Check if we should skip over a closing character instead of inserting it
 * (e.g., typing ) when cursor is before an existing ))
 */
export function shouldSkipClosing(
  char: string,
  charAfterCursor: string | undefined
): boolean {
  return CLOSING_CHARS.has(char) && charAfterCursor === char;
}

/**
 * Check if a character is a closing pair character
 */
export function isClosingChar(char: string): boolean {
  return CLOSING_CHARS.has(char);
}

/**
 * Get the closing character for an opening character
 */
export function getClosingChar(openChar: string): string | null {
  const pair = PAIR_MAP.get(openChar);
  return pair ? pair.close : null;
}

/**
 * Check if backspace should delete both characters of a pair
 * e.g., deleting { when cursor is between {} should delete both
 */
export function shouldDeletePair(
  charBeforeCursor: string | undefined,
  charAfterCursor: string | undefined
): boolean {
  if (!charBeforeCursor || !charAfterCursor) return false;
  
  const pair = PAIR_MAP.get(charBeforeCursor);
  return pair !== undefined && pair.close === charAfterCursor;
}
