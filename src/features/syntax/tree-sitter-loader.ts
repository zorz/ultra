/**
 * Tree-sitter Grammar Loader
 * 
 * Loads Tree-sitter grammars for syntax highlighting.
 */

// Use require for native Node-API modules
let Parser: any = null;
let TypeScript: any = null;
let JavaScript: any = null;
let JSON_LANG: any = null;
let Python: any = null;
let Rust: any = null;
let Go: any = null;
let C: any = null;
let Cpp: any = null;
let HTML: any = null;
let Ruby: any = null;
let Bash: any = null;

let treeSitterLoadError: string | null = null;

try {
  // @ts-ignore - Native module loading
  Parser = require('tree-sitter');
  // @ts-ignore
  TypeScript = require('tree-sitter-typescript');
  // @ts-ignore
  JavaScript = require('tree-sitter-javascript');
  // @ts-ignore
  JSON_LANG = require('tree-sitter-json');
  // @ts-ignore
  Python = require('tree-sitter-python');
  // @ts-ignore
  Rust = require('tree-sitter-rust');
  // @ts-ignore
  Go = require('tree-sitter-go');
  // @ts-ignore
  C = require('tree-sitter-c');
  // @ts-ignore
  Cpp = require('tree-sitter-cpp');
  // @ts-ignore
  HTML = require('tree-sitter-html');
  // @ts-ignore
  Ruby = require('tree-sitter-ruby');
  // @ts-ignore
  Bash = require('tree-sitter-bash');
} catch (error: any) {
  treeSitterLoadError = error?.message || 'Unknown error loading tree-sitter';
}

export interface Grammar {
  languageId: string;
  language: any;
}

// Map language IDs to their grammar modules
const languageModules: Record<string, any> = {
  'typescript': TypeScript,
  'typescriptreact': TypeScript,
  'javascript': JavaScript,
  'javascriptreact': JavaScript,
  'json': JSON_LANG,
  'python': Python,
  'rust': Rust,
  'go': Go,
  'c': C,
  'cpp': Cpp,
  'html': HTML,
  'ruby': Ruby,
  'shellscript': Bash,
  'bash': Bash,
};

export class TreeSitterLoader {
  private grammars: Map<string, Grammar> = new Map();

  /**
   * Load a grammar for the given language
   */
  loadGrammar(languageId: string): Grammar | null {
    // Check if already loaded
    const existing = this.grammars.get(languageId);
    if (existing) return existing;

    // Get the language module
    const langModule = languageModules[languageId];
    if (!langModule) return null;

    try {
      // Handle TypeScript which exports { typescript, tsx }
      let language: any;
      if (languageId === 'typescriptreact' && 'tsx' in langModule) {
        language = langModule.tsx;
      } else if ('typescript' in langModule) {
        language = langModule.typescript;
      } else {
        language = langModule;
      }

      const grammar: Grammar = {
        languageId,
        language
      };

      this.grammars.set(languageId, grammar);
      return grammar;
    } catch (error) {
      console.error(`Failed to load grammar for ${languageId}:`, error);
      return null;
    }
  }

  /**
   * Get a loaded grammar
   */
  getGrammar(languageId: string): Grammar | null {
    return this.grammars.get(languageId) || this.loadGrammar(languageId);
  }

  /**
   * Check if a grammar is loaded
   */
  isLoaded(languageId: string): boolean {
    return this.grammars.has(languageId);
  }

  /**
   * Get list of supported languages
   */
  getSupportedLanguages(): string[] {
    if (treeSitterLoadError) return [];
    return Object.keys(languageModules);
  }

  /**
   * Get tree-sitter load error, if any
   */
  getLoadError(): string | null {
    return treeSitterLoadError;
  }

  /**
   * Create a new parser for a language
   */
  createParser(languageId: string): any {
    if (!Parser || treeSitterLoadError) return null;
    
    const grammar = this.getGrammar(languageId);
    if (!grammar) return null;

    try {
      const parser = new Parser();
      parser.setLanguage(grammar.language);
      return parser;
    } catch (error) {
      return null;
    }
  }
}

export const treeSitterLoader = new TreeSitterLoader();

export default treeSitterLoader;
