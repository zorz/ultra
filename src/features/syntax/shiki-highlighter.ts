/**
 * Shiki-based Syntax Highlighter
 * 
 * Uses Shiki for syntax highlighting - pure JS/TS, works great with Bun.
 */

import { createHighlighter, type Highlighter as ShikiHighlighter, type ThemedToken } from 'shiki';

export interface HighlightToken {
  start: number;  // Column start (0-indexed)
  end: number;    // Column end (exclusive)
  scope: string;  // TextMate-style scope (not used directly, we use color)
  color?: string; // Hex color from theme
}

// Map VS Code language IDs to Shiki language IDs
const LANGUAGE_MAP: Record<string, string> = {
  'typescript': 'typescript',
  'typescriptreact': 'tsx',
  'javascript': 'javascript',
  'javascriptreact': 'jsx',
  'json': 'json',
  'jsonc': 'jsonc',
  'python': 'python',
  'rust': 'rust',
  'go': 'go',
  'c': 'c',
  'cpp': 'cpp',
  'html': 'html',
  'css': 'css',
  'scss': 'scss',
  'less': 'less',
  'markdown': 'markdown',
  'yaml': 'yaml',
  'toml': 'toml',
  'shellscript': 'bash',
  'bash': 'bash',
  'sh': 'bash',
  'zsh': 'bash',
  'ruby': 'ruby',
  'java': 'java',
  'kotlin': 'kotlin',
  'swift': 'swift',
  'php': 'php',
  'sql': 'sql',
  'graphql': 'graphql',
  'dockerfile': 'dockerfile',
  'makefile': 'makefile',
  'lua': 'lua',
  'perl': 'perl',
  'r': 'r',
  'scala': 'scala',
  'elixir': 'elixir',
  'erlang': 'erlang',
  'haskell': 'haskell',
  'clojure': 'clojure',
  'vim': 'viml',
  'xml': 'xml',
  'svg': 'xml',
};

// Languages to preload for fast highlighting
const PRELOAD_LANGUAGES = [
  'typescript', 'tsx', 'javascript', 'jsx', 'json',
  'css', 'html', 'markdown', 'bash', 'python', 'rust', 'go'
];

// Shared Shiki instance - created once, reused across all Highlighter instances
let sharedShiki: ShikiHighlighter | null = null;
let sharedShikiPromise: Promise<ShikiHighlighter | null> | null = null;

/**
 * Get or create the shared Shiki highlighter instance.
 */
async function getSharedShiki(): Promise<ShikiHighlighter | null> {
  if (sharedShiki) return sharedShiki;

  if (!sharedShikiPromise) {
    sharedShikiPromise = createHighlighter({
      themes: ['catppuccin-frappe', 'catppuccin-mocha', 'catppuccin-macchiato', 'catppuccin-latte', 'github-dark', 'github-light'],
      langs: PRELOAD_LANGUAGES,
    }).then(highlighter => {
      sharedShiki = highlighter;
      return highlighter;
    }).catch(error => {
      console.error('Failed to initialize Shiki:', error);
      return null;
    });
  }

  return sharedShikiPromise;
}

export class Highlighter {
  private languageId: string | null = null;
  private content: string = '';
  private lineCache: Map<number, HighlightToken[]> = new Map();
  private tokenizedLines: ThemedToken[][] = [];
  private themeName: string = 'catppuccin-frappe';

  constructor() {
    // Trigger shared Shiki initialization if not already started
    getSharedShiki();
  }

  /**
   * Wait for Shiki to be ready
   */
  async waitForReady(): Promise<boolean> {
    const shiki = await getSharedShiki();
    return shiki !== null;
  }

  /**
   * Check if Shiki is ready
   */
  isReady(): boolean {
    return sharedShiki !== null;
  }

  /**
   * Set the theme
   */
  setTheme(themeName: string): void {
    // Map our theme names to Shiki theme names
    const themeMap: Record<string, string> = {
      'catppuccin-frappe': 'catppuccin-frappe',
      'catppuccin-mocha': 'catppuccin-mocha',
      'catppuccin-macchiato': 'catppuccin-macchiato',
      'catppuccin-latte': 'catppuccin-latte',
      'one-dark': 'github-dark', // Fallback
    };
    this.themeName = themeMap[themeName] || 'catppuccin-frappe';
    this.lineCache.clear();
    this.tokenizedLines = [];
  }

  /**
   * Set the language for highlighting
   */
  async setLanguage(languageId: string): Promise<boolean> {
    if (this.languageId === languageId) return true;

    const shiki = await getSharedShiki();
    if (!shiki) return false;

    const shikiLang = LANGUAGE_MAP[languageId] || languageId;

    // Load language if not already loaded
    try {
      const loadedLangs = shiki.getLoadedLanguages();
      if (!loadedLangs.includes(shikiLang as any)) {
        await shiki.loadLanguage(shikiLang as any);
      }
      this.languageId = languageId;
      this.lineCache.clear();
      this.tokenizedLines = [];
      return true;
    } catch (error) {
      // Language not supported
      this.languageId = null;
      return false;
    }
  }

  /**
   * Synchronous version - returns false if language needs async loading
   */
  setLanguageSync(languageId: string): boolean {
    if (this.languageId === languageId) return true;
    if (!sharedShiki) return false;

    const shikiLang = LANGUAGE_MAP[languageId] || languageId;
    const loadedLangs = sharedShiki.getLoadedLanguages();

    if (loadedLangs.includes(shikiLang as any)) {
      this.languageId = languageId;
      this.lineCache.clear();
      this.tokenizedLines = [];
      return true;
    }

    // Need async loading - trigger it and return false
    this.setLanguage(languageId);
    return false;
  }

  /**
   * Get current language
   */
  getLanguage(): string | null {
    return this.languageId;
  }

  /**
   * Parse/tokenize the document content
   */
  parse(content: string): void {
    this.content = content;
    this.lineCache.clear();
    this.tokenizedLines = [];

    if (!sharedShiki || !this.languageId) return;

    const shikiLang = LANGUAGE_MAP[this.languageId] || this.languageId;

    try {
      // Tokenize all lines at once
      this.tokenizedLines = sharedShiki.codeToTokensBase(content, {
        lang: shikiLang as any,
        theme: this.themeName as any,
      });
    } catch (error) {
      // Tokenization failed - clear tokens
      this.tokenizedLines = [];
    }
  }

  /**
   * Get highlight tokens for a specific line
   */
  highlightLine(lineNumber: number): HighlightToken[] {
    // Check cache
    const cached = this.lineCache.get(lineNumber);
    if (cached) return cached;

    if (lineNumber >= this.tokenizedLines.length) {
      return [];
    }

    const lineTokens = this.tokenizedLines[lineNumber];
    if (!lineTokens) return [];

    const tokens: HighlightToken[] = [];
    let offset = 0;

    for (const token of lineTokens) {
      const start = offset;
      const end = offset + token.content.length;
      offset = end;

      // Skip whitespace-only tokens with default color
      if (token.content.trim() === '' && !token.color) {
        continue;
      }

      tokens.push({
        start,
        end,
        scope: '', // Shiki gives us colors directly
        color: token.color,
      });
    }

    this.lineCache.set(lineNumber, tokens);
    return tokens;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.lineCache.clear();
    this.tokenizedLines = [];
  }

  /**
   * Get list of supported languages
   */
  getSupportedLanguages(): string[] {
    return Object.keys(LANGUAGE_MAP);
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(languageId: string): boolean {
    return languageId in LANGUAGE_MAP || sharedShiki?.getLoadedLanguages().includes(languageId as any) || false;
  }
}

// Export singleton instance
export const highlighter = new Highlighter();

export default highlighter;
