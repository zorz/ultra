/**
 * Auto-Indentation Logic
 * 
 * Provides smart indentation for new lines and bracket handling.
 */

export interface IndentOptions {
  tabSize: number;
  insertSpaces: boolean;
  autoIndent: 'none' | 'keep' | 'full';
}

export interface NewLineIndent {
  /** The indentation string for the new line */
  indent: string;
  /** Extra line to insert (e.g., for closing bracket) */
  extraLine?: string;
  /** Cursor should be on the first new line (true) or after extraLine (false) */
  cursorOnFirstLine: boolean;
}

// Characters that increase indentation on the next line
const INDENT_INCREASE_CHARS = ['{', '[', '(', ':'];
const INDENT_INCREASE_PATTERNS = [
  /=>\s*$/,           // Arrow functions
  /\bthen\s*$/,       // Lua, some shells
  /\bdo\s*$/,         // Ruby, Lua
  /\bbegin\s*$/,      // Ruby
  /\belse\s*$/,       // Various languages
];

// Opening/closing bracket pairs
const BRACKET_PAIRS: Record<string, string> = {
  '{': '}',
  '[': ']',
  '(': ')',
};

const CLOSING_BRACKETS = new Set(['}', ']', ')']);

/**
 * Get the leading whitespace from a line
 */
export function getLeadingWhitespace(line: string): string {
  const match = line.match(/^[\t ]*/);
  return match ? match[0] : '';
}

/**
 * Create an indent unit string
 */
export function getIndentUnit(tabSize: number, insertSpaces: boolean): string {
  return insertSpaces ? ' '.repeat(tabSize) : '\t';
}

/**
 * Check if cursor is between a bracket pair (e.g., {|})
 */
export function isBetweenBrackets(
  charBefore: string | undefined,
  charAfter: string | undefined
): boolean {
  if (!charBefore || !charAfter) return false;
  return BRACKET_PAIRS[charBefore] === charAfter;
}

/**
 * Check if a line should increase indent on the next line
 */
export function shouldIncreaseIndent(line: string): boolean {
  const trimmed = line.trimEnd();
  if (!trimmed) return false;
  
  // Check for ending characters
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar && INDENT_INCREASE_CHARS.includes(lastChar)) {
    return true;
  }
  
  // Check patterns
  for (const pattern of INDENT_INCREASE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if typing a character should trigger dedent
 */
export function shouldDedentOnChar(
  lineBeforeCursor: string,
  char: string
): boolean {
  // Only dedent if the line before cursor is all whitespace
  // and we're typing a closing bracket
  return /^[\t ]*$/.test(lineBeforeCursor) && CLOSING_BRACKETS.has(char);
}

/**
 * Find the matching indent for a closing bracket
 * by scanning backwards through lines
 */
export function findMatchingBracketIndent(
  lines: string[],
  currentLine: number,
  closingBracket: string
): string | null {
  const openingBracket = Object.entries(BRACKET_PAIRS)
    .find(([_, close]) => close === closingBracket)?.[0];
  
  if (!openingBracket) return null;
  
  let depth = 1;
  
  // Scan backwards from current line
  for (let i = currentLine - 1; i >= 0; i--) {
    const line = lines[i]!;
    
    // Count brackets in this line (right to left for proper nesting)
    for (let j = line.length - 1; j >= 0; j--) {
      const char = line[j];
      if (char === closingBracket) {
        depth++;
      } else if (char === openingBracket) {
        depth--;
        if (depth === 0) {
          // Found the matching bracket - return its line's indent
          return getLeadingWhitespace(line);
        }
      }
    }
  }
  
  return null;
}

/**
 * Calculate indentation for a new line after pressing Enter
 */
export function calculateNewLineIndent(
  prevLine: string,
  charBeforeCursor: string | undefined,
  charAfterCursor: string | undefined,
  options: IndentOptions
): NewLineIndent {
  const { tabSize, insertSpaces, autoIndent } = options;
  
  // No auto-indent
  if (autoIndent === 'none') {
    return { indent: '', cursorOnFirstLine: true };
  }
  
  const baseIndent = getLeadingWhitespace(prevLine);
  const indentUnit = getIndentUnit(tabSize, insertSpaces);
  
  // Keep mode - just maintain current indent
  if (autoIndent === 'keep') {
    return { indent: baseIndent, cursorOnFirstLine: true };
  }
  
  // Full auto-indent mode
  const betweenBrackets = isBetweenBrackets(charBeforeCursor, charAfterCursor);
  const shouldIncrease = shouldIncreaseIndent(prevLine);
  
  if (betweenBrackets) {
    // Between brackets: create indented line with closing bracket on next line
    // e.g., {|} becomes:
    // {
    //   |
    // }
    return {
      indent: baseIndent + indentUnit,
      extraLine: baseIndent,  // Closing bracket gets base indent
      cursorOnFirstLine: true
    };
  }
  
  if (shouldIncrease) {
    // Line ends with indent-increasing character
    return {
      indent: baseIndent + indentUnit,
      cursorOnFirstLine: true
    };
  }
  
  // Default: maintain indent
  return {
    indent: baseIndent,
    cursorOnFirstLine: true
  };
}

/**
 * Calculate the dedented text when typing a closing bracket
 */
export function calculateDedent(
  lines: string[],
  currentLine: number,
  closingBracket: string,
  options: IndentOptions
): string | null {
  const matchingIndent = findMatchingBracketIndent(lines, currentLine, closingBracket);
  
  if (matchingIndent !== null) {
    return matchingIndent + closingBracket;
  }
  
  return null;
}
