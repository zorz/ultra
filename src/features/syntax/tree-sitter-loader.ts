/**
 * Tree-sitter Grammar Loader
 * 
 * Loads Tree-sitter grammars for syntax highlighting.
 */

// Use require for native Node-API modules
// @ts-ignore - Native module loading
const Parser = require('tree-sitter');

// Import language grammars - these have native bindings
// @ts-ignore
const TypeScript = require('tree-sitter-typescript');
// @ts-ignore
const JavaScript = require('tree-sitter-javascript');
// @ts-ignore
const JSON_LANG = require('tree-sitter-json');
// @ts-ignore
const Python = require('tree-sitter-python');
// @ts-ignore
const Rust = require('tree-sitter-rust');
// @ts-ignore
const Go = require('tree-sitter-go');
// @ts-ignore
const C = require('tree-sitter-c');
// @ts-ignore
const Cpp = require('tree-sitter-cpp');
// @ts-ignore
const HTML = require('tree-sitter-html');
// CSS uses top-level await which doesn't work with require()
// @ts-ignore
const Ruby = require('tree-sitter-ruby');
// @ts-ignore
const Bash = require('tree-sitter-bash');
// Markdown has ABI version mismatch issues
// const Markdown = require('tree-sitter-markdown');

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
  // 'css': CSS,  // CSS uses top-level await, not compatible
  'ruby': Ruby,
  'shellscript': Bash,
  'bash': Bash,
  // 'markdown': Markdown,  // ABI version mismatch
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
    return Object.keys(languageModules);
  }

  /**
   * Create a new parser for a language
   */
  createParser(languageId: string): any {
    const grammar = this.getGrammar(languageId);
    if (!grammar) return null;

    const parser = new Parser();
    parser.setLanguage(grammar.language);
    return parser;
  }
}

export const treeSitterLoader = new TreeSitterLoader();

export default treeSitterLoader;
