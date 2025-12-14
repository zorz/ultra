/**
 * Syntax Highlighter
 * 
 * Uses Tree-sitter for syntax highlighting with incremental parsing.
 */

// Use require for native Node-API modules
// @ts-ignore
const Parser = require('tree-sitter');
import { treeSitterLoader } from './tree-sitter-loader.ts';

export interface HighlightToken {
  start: number;  // Column start (0-indexed)
  end: number;    // Column end (exclusive)
  scope: string;  // TextMate-style scope
}

export interface LineHighlights {
  lineNumber: number;
  tokens: HighlightToken[];
}

/**
 * Map tree-sitter node types to TextMate-style scopes
 * These scopes can then be mapped to theme colors
 */
const NODE_TYPE_TO_SCOPE: Record<string, string> = {
  // Comments
  'comment': 'comment',
  'line_comment': 'comment.line',
  'block_comment': 'comment.block',
  'doc_comment': 'comment.block.documentation',
  
  // Strings
  'string': 'string',
  'string_literal': 'string',
  'template_string': 'string.template',
  'template_literal_type': 'string.template',
  'string_fragment': 'string',
  'string_content': 'string',
  'escape_sequence': 'constant.character.escape',
  'regex': 'string.regexp',
  'regex_pattern': 'string.regexp',
  
  // Numbers
  'number': 'constant.numeric',
  'integer': 'constant.numeric',
  'float': 'constant.numeric',
  'integer_literal': 'constant.numeric',
  'float_literal': 'constant.numeric',
  
  // Booleans and null
  'true': 'constant.language.boolean.true',
  'false': 'constant.language.boolean.false',
  'null': 'constant.language.null',
  'undefined': 'constant.language.undefined',
  'none': 'constant.language.null',
  'nil': 'constant.language.null',
  
  // Keywords - Control flow
  'if': 'keyword.control.conditional',
  'else': 'keyword.control.conditional',
  'switch': 'keyword.control.conditional',
  'case': 'keyword.control.conditional',
  'default': 'keyword.control.conditional',
  'for': 'keyword.control.loop',
  'while': 'keyword.control.loop',
  'do': 'keyword.control.loop',
  'break': 'keyword.control.flow',
  'continue': 'keyword.control.flow',
  'return': 'keyword.control.flow',
  'throw': 'keyword.control.flow',
  'try': 'keyword.control.trycatch',
  'catch': 'keyword.control.trycatch',
  'finally': 'keyword.control.trycatch',
  'yield': 'keyword.control.flow',
  'await': 'keyword.control.flow',
  
  // Keywords - Declarations
  'const': 'keyword.declaration',
  'let': 'keyword.declaration',
  'var': 'keyword.declaration',
  'function': 'keyword.declaration.function',
  'class': 'keyword.declaration.class',
  'interface': 'keyword.declaration.interface',
  'type': 'keyword.declaration.type',
  'enum': 'keyword.declaration.enum',
  'namespace': 'keyword.declaration.namespace',
  'module': 'keyword.declaration.module',
  'import': 'keyword.control.import',
  'export': 'keyword.control.export',
  'from': 'keyword.control.from',
  'as': 'keyword.control.as',
  'default': 'keyword.control.default',
  
  // Keywords - Modifiers
  'public': 'keyword.modifier',
  'private': 'keyword.modifier',
  'protected': 'keyword.modifier',
  'static': 'keyword.modifier',
  'readonly': 'keyword.modifier',
  'abstract': 'keyword.modifier',
  'async': 'keyword.modifier.async',
  'extends': 'keyword.modifier',
  'implements': 'keyword.modifier',
  
  // Keywords - Other
  'new': 'keyword.operator.new',
  'this': 'variable.language.this',
  'super': 'variable.language.super',
  'self': 'variable.language.self',
  'typeof': 'keyword.operator.typeof',
  'instanceof': 'keyword.operator.instanceof',
  'in': 'keyword.operator.in',
  'of': 'keyword.operator.of',
  'delete': 'keyword.operator.delete',
  'void': 'keyword.operator.void',
  
  // Types
  'type_identifier': 'entity.name.type',
  'predefined_type': 'support.type.primitive',
  'builtin_type': 'support.type.primitive',
  'primitive_type': 'support.type.primitive',
  'generic_type': 'entity.name.type',
  'type_annotation': 'entity.name.type',
  
  // Functions
  'function_declaration': 'entity.name.function',
  'method_definition': 'entity.name.function',
  'arrow_function': 'entity.name.function',
  'call_expression': 'entity.name.function',
  
  // Identifiers
  'identifier': 'variable',
  'property_identifier': 'variable.other.property',
  'shorthand_property_identifier': 'variable.other.property',
  'shorthand_property_identifier_pattern': 'variable.other.property',
  'field_identifier': 'variable.other.property',
  
  // Operators
  'binary_expression': 'keyword.operator',
  'unary_expression': 'keyword.operator',
  'update_expression': 'keyword.operator',
  'assignment_expression': 'keyword.operator.assignment',
  'augmented_assignment_expression': 'keyword.operator.assignment',
  'ternary_expression': 'keyword.operator.ternary',
  
  // Punctuation
  'open_brace': 'punctuation.definition.block',
  'close_brace': 'punctuation.definition.block',
  'open_paren': 'punctuation.definition.parameters',
  'close_paren': 'punctuation.definition.parameters',
  'open_bracket': 'punctuation.definition.array',
  'close_bracket': 'punctuation.definition.array',
  
  // JSX/TSX
  'jsx_element': 'meta.jsx',
  'jsx_opening_element': 'meta.jsx',
  'jsx_closing_element': 'meta.jsx',
  'jsx_self_closing_element': 'meta.jsx',
  'jsx_attribute': 'entity.other.attribute-name',
  'jsx_text': 'string.jsx',
  
  // Python specific
  'def': 'keyword.declaration.function',
  'lambda': 'keyword.declaration.function',
  'decorator': 'entity.name.decorator',
  'dictionary': 'meta.structure.dictionary',
  'list': 'meta.structure.list',
  
  // Rust specific
  'lifetime': 'storage.modifier.lifetime',
  'macro_invocation': 'entity.name.function.macro',
  'attribute_item': 'meta.attribute',
  
  // Go specific  
  'package_clause': 'keyword.other.package',
  'func_literal': 'keyword.declaration.function',
  'go_statement': 'keyword.control.go',
  'defer_statement': 'keyword.control.defer',
  
  // JSON
  'pair': 'meta.structure.dictionary.json',
  'object': 'meta.structure.dictionary.json',
  'array': 'meta.structure.array.json',
  
  // CSS
  'tag_name': 'entity.name.tag.css',
  'class_name': 'entity.other.attribute-name.class.css',
  'class_selector': 'entity.other.attribute-name.class.css',
  'id_name': 'entity.other.attribute-name.id.css',
  'id_selector': 'entity.other.attribute-name.id.css',
  'property_name': 'support.type.property-name.css',
  'plain_value': 'support.constant.property-value.css',
  'color_value': 'constant.other.color.css',
  'integer_value': 'constant.numeric.css',
  'float_value': 'constant.numeric.css',
  'unit': 'keyword.other.unit.css',
  'important': 'keyword.other.important.css',
  'pseudo_class_selector': 'entity.other.attribute-name.pseudo-class.css',
  'pseudo_element_selector': 'entity.other.attribute-name.pseudo-element.css',
  'attribute_selector': 'entity.other.attribute-name.css',
  'attribute_name': 'entity.other.attribute-name.css',
  'namespace_name': 'entity.name.namespace.css',
  'function_name': 'support.function.css',
  'call_expression': 'meta.function-call.css',
  'keyframes_name': 'entity.name.function.css',
  'feature_name': 'support.type.property-name.media.css',
  'keyword_query': 'keyword.control.at-rule.css',
  'at_keyword': 'keyword.control.at-rule.css',
  'to': 'keyword.control.css',
  'from': 'keyword.control.css',
  'and': 'keyword.operator.logical.css',
  'or': 'keyword.operator.logical.css',
  'not': 'keyword.operator.logical.css',
  'nesting_selector': 'entity.other.attribute-name.css',
};

/**
 * Map operator symbols to scopes
 */
const OPERATOR_SCOPES: Record<string, string> = {
  '=': 'keyword.operator.assignment',
  '==': 'keyword.operator.comparison',
  '===': 'keyword.operator.comparison',
  '!=': 'keyword.operator.comparison',
  '!==': 'keyword.operator.comparison',
  '<': 'keyword.operator.comparison',
  '>': 'keyword.operator.comparison',
  '<=': 'keyword.operator.comparison',
  '>=': 'keyword.operator.comparison',
  '+': 'keyword.operator.arithmetic',
  '-': 'keyword.operator.arithmetic',
  '*': 'keyword.operator.arithmetic',
  '/': 'keyword.operator.arithmetic',
  '%': 'keyword.operator.arithmetic',
  '**': 'keyword.operator.arithmetic',
  '++': 'keyword.operator.arithmetic',
  '--': 'keyword.operator.arithmetic',
  '+=': 'keyword.operator.assignment.compound',
  '-=': 'keyword.operator.assignment.compound',
  '*=': 'keyword.operator.assignment.compound',
  '/=': 'keyword.operator.assignment.compound',
  '&&': 'keyword.operator.logical',
  '||': 'keyword.operator.logical',
  '!': 'keyword.operator.logical',
  '&': 'keyword.operator.bitwise',
  '|': 'keyword.operator.bitwise',
  '^': 'keyword.operator.bitwise',
  '~': 'keyword.operator.bitwise',
  '<<': 'keyword.operator.bitwise',
  '>>': 'keyword.operator.bitwise',
  '>>>': 'keyword.operator.bitwise',
  '?': 'keyword.operator.ternary',
  ':': 'keyword.operator.ternary',
  '=>': 'keyword.operator.arrow',
  '->': 'keyword.operator.arrow',
  '...': 'keyword.operator.spread',
  '?.': 'keyword.operator.optional',
  '??': 'keyword.operator.nullish',
};

export class Highlighter {
  private parser: any = null;
  private tree: any = null;
  private languageId: string | null = null;
  private content: string = '';
  private lineCache: Map<number, HighlightToken[]> = new Map();
  private useRegexFallback: boolean = false;
  
  // Multi-line state tracking for regex fallback
  // Maps line number to state: 'comment' | 'string' | null
  private lineStartState: Map<number, 'comment' | 'string' | null> = new Map();

  // Languages that always use regex (tree-sitter not compatible)
  private static readonly REGEX_ONLY_LANGUAGES = ['markdown', 'css'];
  
  // Languages that have regex fallback implementations
  private static readonly REGEX_FALLBACK_LANGUAGES = [
    'markdown', 'css', 'typescript', 'typescriptreact', 
    'javascript', 'javascriptreact', 'json', 'python',
    'rust', 'go', 'html', 'shellscript', 'bash'
  ];

  /**
   * Set the language for highlighting
   */
  setLanguage(languageId: string): boolean {
    if (this.languageId === languageId) return true;
    
    // Check if this language requires regex-only (tree-sitter doesn't work)
    if (Highlighter.REGEX_ONLY_LANGUAGES.includes(languageId)) {
      this.languageId = languageId;
      this.useRegexFallback = true;
      this.parser = null;
      this.tree = null;
      this.lineCache.clear();
      return true;
    }
    
    // Try tree-sitter first
    this.parser = treeSitterLoader.createParser(languageId);
    if (this.parser) {
      this.languageId = languageId;
      this.tree = null;
      this.useRegexFallback = false;
      this.lineCache.clear();
      return true;
    }
    
    // Fall back to regex if available
    if (Highlighter.REGEX_FALLBACK_LANGUAGES.includes(languageId)) {
      this.languageId = languageId;
      this.useRegexFallback = true;
      this.parser = null;
      this.tree = null;
      this.lineCache.clear();
      return true;
    }
    
    // Language not supported at all
    this.languageId = null;
    this.tree = null;
    this.useRegexFallback = false;
    return false;
  }

  /**
   * Get current language
   */
  getLanguage(): string | null {
    return this.languageId;
  }

  /**
   * Parse or reparse the document content
   */
  parse(content: string): void {
    this.content = content;
    this.lineCache.clear();
    this.lineStartState.clear();
    
    if (this.useRegexFallback) {
      // Compute multi-line comment/string state for each line
      this.computeMultiLineState();
      return;
    }
    
    if (!this.parser) return;
    this.tree = this.parser.parse(content);
  }

  /**
   * Compute multi-line comment and string state for regex-based highlighting
   */
  private computeMultiLineState(): void {
    const lines = this.content.split('\n');
    let inBlockComment = false;
    let inMultiLineString = false;
    let stringDelimiter = '';
    
    // Determine comment style based on language
    const usesBlockComments = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 
                              'css', 'rust', 'go', 'c', 'cpp', 'java'].includes(this.languageId || '');
    const usesHtmlComments = this.languageId === 'html';
    const usesPythonTripleQuotes = this.languageId === 'python';
    
    for (let i = 0; i < lines.length; i++) {
      // Record state at start of this line
      if (inBlockComment) {
        this.lineStartState.set(i, 'comment');
      } else if (inMultiLineString) {
        this.lineStartState.set(i, 'string');
      } else {
        this.lineStartState.set(i, null);
      }
      
      const line = lines[i]!;
      let j = 0;
      
      while (j < line.length) {
        if (inBlockComment) {
          // Look for end of block comment
          if (usesBlockComments && line.slice(j, j + 2) === '*/') {
            inBlockComment = false;
            j += 2;
          } else if (usesHtmlComments && line.slice(j, j + 3) === '-->') {
            inBlockComment = false;
            j += 3;
          } else {
            j++;
          }
        } else if (inMultiLineString) {
          // Look for end of multi-line string
          if (usesPythonTripleQuotes && line.slice(j, j + 3) === stringDelimiter) {
            inMultiLineString = false;
            j += 3;
          } else if (line[j] === '\\') {
            j += 2; // Skip escaped char
          } else {
            j++;
          }
        } else {
          // Check for start of block comment
          if (usesBlockComments && line.slice(j, j + 2) === '/*') {
            // Check if it ends on same line
            const endIdx = line.indexOf('*/', j + 2);
            if (endIdx === -1) {
              inBlockComment = true;
            }
            j += 2;
          } else if (usesHtmlComments && line.slice(j, j + 4) === '<!--') {
            const endIdx = line.indexOf('-->', j + 4);
            if (endIdx === -1) {
              inBlockComment = true;
            }
            j += 4;
          } else if (usesBlockComments && line.slice(j, j + 2) === '//') {
            // Line comment - skip rest of line
            break;
          } else if (this.languageId === 'python' && line[j] === '#') {
            // Python line comment
            break;
          } else if (usesPythonTripleQuotes && (line.slice(j, j + 3) === '"""' || line.slice(j, j + 3) === "'''")) {
            // Python triple-quoted string
            stringDelimiter = line.slice(j, j + 3);
            const endIdx = line.indexOf(stringDelimiter, j + 3);
            if (endIdx === -1) {
              inMultiLineString = true;
            }
            j += 3;
          } else if (line[j] === '"' || line[j] === "'") {
            // Regular string - find end on same line
            const quote = line[j];
            j++;
            while (j < line.length && line[j] !== quote) {
              if (line[j] === '\\') j++;
              j++;
            }
            j++; // Skip closing quote
          } else if (line[j] === '`' && ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(this.languageId || '')) {
            // Template string - can span multiple lines but we handle per-line
            j++;
            while (j < line.length && line[j] !== '`') {
              if (line[j] === '\\') j++;
              j++;
            }
            j++;
          } else {
            j++;
          }
        }
      }
    }
  }

  /**
   * Update the parse tree incrementally after an edit
   */
  updateIncremental(
    startLine: number,
    startColumn: number,
    oldEndLine: number,
    oldEndColumn: number,
    newEndLine: number,
    newEndColumn: number,
    newContent: string
  ): void {
    if (!this.parser || !this.tree) {
      this.parse(newContent);
      return;
    }

    // Calculate byte offsets (assuming UTF-8)
    const lines = this.content.split('\n');
    let startIndex = 0;
    for (let i = 0; i < startLine; i++) {
      startIndex += (lines[i]?.length ?? 0) + 1;
    }
    startIndex += startColumn;

    let oldEndIndex = 0;
    for (let i = 0; i < oldEndLine; i++) {
      oldEndIndex += (lines[i]?.length ?? 0) + 1;
    }
    oldEndIndex += oldEndColumn;

    const newLines = newContent.split('\n');
    let newEndIndex = 0;
    for (let i = 0; i < newEndLine; i++) {
      newEndIndex += (newLines[i]?.length ?? 0) + 1;
    }
    newEndIndex += newEndColumn;

    // Apply edit to the tree
    this.tree.edit({
      startIndex,
      oldEndIndex,
      newEndIndex,
      startPosition: { row: startLine, column: startColumn },
      oldEndPosition: { row: oldEndLine, column: oldEndColumn },
      newEndPosition: { row: newEndLine, column: newEndColumn }
    });

    // Reparse with the old tree for incremental parsing
    this.content = newContent;
    this.tree = this.parser.parse(newContent, this.tree);
    
    // Clear cache for affected lines
    for (let line = startLine; line <= Math.max(oldEndLine, newEndLine); line++) {
      this.lineCache.delete(line);
    }
  }

  /**
   * Get highlight tokens for a specific line
   */
  highlightLine(lineNumber: number): HighlightToken[] {
    // Check cache
    const cached = this.lineCache.get(lineNumber);
    if (cached) return cached;

    // Use regex fallback
    if (this.useRegexFallback) {
      let tokens: HighlightToken[] = [];
      switch (this.languageId) {
        case 'markdown':
          tokens = this.highlightMarkdownLine(lineNumber);
          break;
        case 'css':
          tokens = this.highlightCssLine(lineNumber);
          break;
        case 'typescript':
        case 'typescriptreact':
        case 'javascript':
        case 'javascriptreact':
          tokens = this.highlightJsLine(lineNumber);
          break;
        case 'json':
          tokens = this.highlightJsonLine(lineNumber);
          break;
        case 'python':
          tokens = this.highlightPythonLine(lineNumber);
          break;
        case 'rust':
          tokens = this.highlightRustLine(lineNumber);
          break;
        case 'go':
          tokens = this.highlightGoLine(lineNumber);
          break;
        case 'html':
          tokens = this.highlightHtmlLine(lineNumber);
          break;
        case 'shellscript':
        case 'bash':
          tokens = this.highlightBashLine(lineNumber);
          break;
      }
      this.lineCache.set(lineNumber, tokens);
      return tokens;
    }

    if (!this.tree) return [];

    const tokens: HighlightToken[] = [];
    const rootNode = this.tree.rootNode;

    // Get the line text to know its bounds
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const lineText = lines[lineNumber]!;
    const lineLength = lineText.length;
    if (lineLength === 0) return [];

    // Find nodes that intersect with this line
    this.collectTokensForLine(rootNode, lineNumber, lineLength, tokens);

    // Sort by start position and merge overlapping tokens
    tokens.sort((a, b) => a.start - b.start);
    
    // Cache and return
    this.lineCache.set(lineNumber, tokens);
    return tokens;
  }

  /**
   * Highlight a markdown line using regex patterns
   */
  private highlightMarkdownLine(lineNumber: number): HighlightToken[] {
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const line = lines[lineNumber]!;
    if (line.length === 0) return [];

    const tokens: HighlightToken[] = [];

    // ATX Headings: # Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      // Heading marker
      tokens.push({
        start: 0,
        end: headingMatch[1]!.length,
        scope: 'markup.heading.marker'
      });
      // Heading text
      if (headingMatch[2]!.length > 0) {
        tokens.push({
          start: headingMatch[1]!.length + 1,
          end: line.length,
          scope: 'markup.heading'
        });
      }
      return tokens;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      tokens.push({ start: 0, end: line.length, scope: 'markup.hr' });
      return tokens;
    }

    // Blockquote
    const blockquoteMatch = line.match(/^(\s*>+)(.*)$/);
    if (blockquoteMatch) {
      tokens.push({
        start: 0,
        end: blockquoteMatch[1]!.length,
        scope: 'markup.quote.marker'
      });
      // Continue to process rest of line for inline elements
      this.addInlineMarkdownTokens(line, blockquoteMatch[1]!.length, tokens);
      return tokens;
    }

    // List items
    const listMatch = line.match(/^(\s*)([*+-]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const markerStart = listMatch[1]!.length;
      const markerEnd = markerStart + listMatch[2]!.length;
      tokens.push({
        start: markerStart,
        end: markerEnd,
        scope: 'markup.list.marker'
      });
      // Continue to process rest of line for inline elements
      this.addInlineMarkdownTokens(line, markerEnd + 1, tokens);
      return tokens;
    }

    // Code block fence
    const codeFenceMatch = line.match(/^(`{3,}|~{3,})(\w*)$/);
    if (codeFenceMatch) {
      tokens.push({
        start: 0,
        end: codeFenceMatch[1]!.length,
        scope: 'markup.fenced_code.delimiter'
      });
      if (codeFenceMatch[2]!.length > 0) {
        tokens.push({
          start: codeFenceMatch[1]!.length,
          end: line.length,
          scope: 'markup.fenced_code.language'
        });
      }
      return tokens;
    }

    // Regular line - check for inline elements
    this.addInlineMarkdownTokens(line, 0, tokens);
    return tokens;
  }

  /**
   * Add tokens for inline markdown elements (bold, italic, code, links)
   */
  private addInlineMarkdownTokens(line: string, startOffset: number, tokens: HighlightToken[]): void {
    const text = line.slice(startOffset);
    
    // Inline code: `code`
    const codeRegex = /`([^`]+)`/g;
    let match;
    while ((match = codeRegex.exec(text)) !== null) {
      tokens.push({
        start: startOffset + match.index,
        end: startOffset + match.index + match[0].length,
        scope: 'markup.inline.raw'
      });
    }

    // Bold: **text** or __text__
    const boldRegex = /(\*\*|__)(?!\s)(.+?)(?<!\s)\1/g;
    while ((match = boldRegex.exec(text)) !== null) {
      tokens.push({
        start: startOffset + match.index,
        end: startOffset + match.index + match[0].length,
        scope: 'markup.bold'
      });
    }

    // Italic: *text* or _text_ (but not inside bold)
    const italicRegex = /(?<!\*|\w)(\*|_)(?!\s)([^*_]+?)(?<!\s)\1(?!\*|\w)/g;
    while ((match = italicRegex.exec(text)) !== null) {
      tokens.push({
        start: startOffset + match.index,
        end: startOffset + match.index + match[0].length,
        scope: 'markup.italic'
      });
    }

    // Links: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = linkRegex.exec(text)) !== null) {
      // Link text
      const textStart = startOffset + match.index + 1;
      const textEnd = textStart + match[1]!.length;
      tokens.push({
        start: startOffset + match.index,
        end: textEnd + 1,
        scope: 'markup.link.text'
      });
      // Link URL
      tokens.push({
        start: textEnd + 2,
        end: startOffset + match.index + match[0].length,
        scope: 'markup.underline.link'
      });
    }

    // Images: ![alt](url)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = imageRegex.exec(text)) !== null) {
      tokens.push({
        start: startOffset + match.index,
        end: startOffset + match.index + match[0].length,
        scope: 'markup.link.image'
      });
    }

    // Strikethrough: ~~text~~
    const strikeRegex = /~~([^~]+)~~/g;
    while ((match = strikeRegex.exec(text)) !== null) {
      tokens.push({
        start: startOffset + match.index,
        end: startOffset + match.index + match[0].length,
        scope: 'markup.strikethrough'
      });
    }
  }

  /**
   * Highlight a CSS line using regex patterns
   */
  private highlightCssLine(lineNumber: number): HighlightToken[] {
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const line = lines[lineNumber]!;
    if (line.length === 0) return [];

    const tokens: HighlightToken[] = [];
    let match;

    // Check if we're starting inside a multi-line comment
    const startState = this.lineStartState.get(lineNumber);
    if (startState === 'comment') {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) {
        tokens.push({
          start: 0,
          end: line.length,
          scope: 'comment.block.css'
        });
        return tokens;
      } else {
        tokens.push({
          start: 0,
          end: endIdx + 2,
          scope: 'comment.block.css'
        });
      }
    }

    // Comments: /* ... */ or /* ... (start of multi-line)
    const commentRegex = /\/\*.*?\*\/|\/\*.*$/g;
    while ((match = commentRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'comment.block.css'
        });
      }
    }

    // At-rules: @media, @keyframes, @import, etc.
    const atRuleRegex = /@[\w-]+/g;
    while ((match = atRuleRegex.exec(line)) !== null) {
      const inComment = tokens.some(t => t.scope.startsWith('comment') && match!.index >= t.start && match!.index < t.end);
      if (!inComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'keyword.control.at-rule.css'
        });
      }
    }

    // Class selectors: .classname
    const classRegex = /\.[\w-]+/g;
    while ((match = classRegex.exec(line)) !== null) {
      const inComment = tokens.some(t => t.scope.startsWith('comment') && match!.index >= t.start && match!.index < t.end);
      if (!inComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'entity.other.attribute-name.class.css'
        });
      }
    }

    // ID selectors: #idname
    const idRegex = /#[\w-]+(?![0-9a-fA-F]{2,})/g;
    while ((match = idRegex.exec(line)) !== null) {
      const inComment = tokens.some(t => t.scope.startsWith('comment') && match!.index >= t.start && match!.index < t.end);
      // Make sure it's not a hex color
      if (!inComment && !/^#[0-9a-fA-F]{3,8}$/.test(match[0])) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'entity.other.attribute-name.id.css'
        });
      }
    }

    // Pseudo selectors: :hover, ::before
    const pseudoRegex = /:{1,2}[\w-]+/g;
    while ((match = pseudoRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'entity.other.attribute-name.pseudo-class.css'
      });
    }

    // Property names (before colon in declaration)
    const propertyRegex = /[\w-]+(?=\s*:)/g;
    while ((match = propertyRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'support.type.property-name.css'
      });
    }

    // Colors: #fff, #ffffff, #ffffffff
    const colorRegex = /#[0-9a-fA-F]{3,8}\b/g;
    while ((match = colorRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'constant.other.color.css'
      });
    }

    // Numbers with units: 10px, 1.5em, 100%
    const numberUnitRegex = /\b[\d.]+(?:px|em|rem|%|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|deg|rad|grad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx|fr)\b/g;
    while ((match = numberUnitRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'constant.numeric.css'
      });
    }

    // Plain numbers
    const numberRegex = /\b\d+\.?\d*\b/g;
    while ((match = numberRegex.exec(line)) !== null) {
      // Check if already covered by number+unit
      const alreadyCovered = tokens.some(t => 
        t.scope === 'constant.numeric.css' && 
        match!.index >= t.start && match!.index < t.end
      );
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'constant.numeric.css'
        });
      }
    }

    // Strings: "..." or '...'
    const stringRegex = /(["'])(?:(?!\1)[^\\]|\\.)*\1/g;
    while ((match = stringRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'string.quoted.css'
      });
    }

    // Function calls: rgb(), url(), calc(), etc.
    const funcRegex = /[\w-]+(?=\()/g;
    while ((match = funcRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'support.function.css'
      });
    }

    // Important
    const importantRegex = /!important\b/g;
    while ((match = importantRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'keyword.other.important.css'
      });
    }

    // Tag selectors (simple words at start or after comma/space, before { or ,)
    // This is a simplified heuristic
    const tagRegex = /\b(html|body|div|span|p|a|ul|ol|li|h[1-6]|header|footer|nav|main|section|article|aside|table|tr|td|th|thead|tbody|form|input|button|label|select|textarea|img|video|audio|canvas|svg|iframe)\b/g;
    while ((match = tagRegex.exec(line)) !== null) {
      // Check if not already covered
      const alreadyCovered = tokens.some(t => 
        match!.index >= t.start && match!.index < t.end
      );
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'entity.name.tag.css'
        });
      }
    }

    // Sort tokens by start position
    tokens.sort((a, b) => a.start - b.start);
    return tokens;
  }

  /**
   * Highlight a JavaScript/TypeScript line using regex patterns
   */
  private highlightJsLine(lineNumber: number): HighlightToken[] {
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const line = lines[lineNumber]!;
    if (line.length === 0) return [];

    const tokens: HighlightToken[] = [];
    let match;

    // Check if we're starting inside a multi-line comment
    const startState = this.lineStartState.get(lineNumber);
    if (startState === 'comment') {
      // Find where the comment ends on this line, or mark whole line as comment
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) {
        // Whole line is a comment
        tokens.push({
          start: 0,
          end: line.length,
          scope: 'comment.block'
        });
        return tokens;
      } else {
        // Comment ends on this line
        tokens.push({
          start: 0,
          end: endIdx + 2,
          scope: 'comment.block'
        });
      }
    }

    // Line comments: // ...
    const lineCommentRegex = /\/\/.*/g;
    while ((match = lineCommentRegex.exec(line)) !== null) {
      // Make sure not inside an existing token
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'comment.line'
        });
      }
    }

    // Block comments: /* ... */ (single line) or /* ... (start of multi-line)
    const blockCommentRegex = /\/\*.*?\*\/|\/\*.*$/g;
    while ((match = blockCommentRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'comment.block'
        });
      }
    }

    // Strings: "...", '...', `...`
    const stringRegex = /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g;
    while ((match = stringRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        const quote = match[1];
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: quote === '`' ? 'string.template' : 'string.quoted'
        });
      }
    }

    // Keywords
    const keywordRegex = /\b(const|let|var|function|class|interface|type|enum|namespace|module|import|export|from|as|default|if|else|switch|case|break|continue|return|throw|try|catch|finally|for|while|do|new|this|super|extends|implements|static|public|private|protected|readonly|async|await|yield|typeof|instanceof|in|of|delete|void|null|undefined|true|false)\b/g;
    while ((match = keywordRegex.exec(line)) !== null) {
      // Check if inside string or comment
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        let scope = 'keyword';
        const word = match[0];
        if (['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum'].includes(word)) {
          scope = 'keyword.declaration';
        } else if (['if', 'else', 'switch', 'case', 'for', 'while', 'do'].includes(word)) {
          scope = 'keyword.control';
        } else if (['import', 'export', 'from', 'as', 'default'].includes(word)) {
          scope = 'keyword.control.import';
        } else if (['true', 'false'].includes(word)) {
          scope = 'constant.language.boolean';
        } else if (['null', 'undefined'].includes(word)) {
          scope = 'constant.language.null';
        } else if (['this', 'super'].includes(word)) {
          scope = 'variable.language';
        }
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope
        });
      }
    }

    // Type annotations (simplified): : Type, <Type>
    const typeRegex = /:\s*([A-Z][a-zA-Z0-9_]*(?:<[^>]+>)?)/g;
    while ((match = typeRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        tokens.push({
          start: match.index + match[0].indexOf(match[1]!),
          end: match.index + match[0].length,
          scope: 'entity.name.type'
        });
      }
    }

    // Function calls: name(
    const funcCallRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    while ((match = funcCallRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      const isKeyword = tokens.some(t => 
        t.scope.startsWith('keyword') &&
        match!.index === t.start
      );
      if (!inStringOrComment && !isKeyword) {
        tokens.push({
          start: match.index,
          end: match.index + match[1]!.length,
          scope: 'entity.name.function'
        });
      }
    }

    // Numbers
    const numberRegex = /\b(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:e[+-]?\d+)?)\b/g;
    while ((match = numberRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'constant.numeric'
        });
      }
    }

    // Decorators: @decorator
    const decoratorRegex = /@[a-zA-Z_$][a-zA-Z0-9_$]*/g;
    while ((match = decoratorRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'entity.name.decorator'
      });
    }

    tokens.sort((a, b) => a.start - b.start);
    return tokens;
  }

  /**
   * Highlight a JSON line using regex patterns
   */
  private highlightJsonLine(lineNumber: number): HighlightToken[] {
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const line = lines[lineNumber]!;
    if (line.length === 0) return [];

    const tokens: HighlightToken[] = [];
    let match;

    // Property keys: "key":
    const keyRegex = /"([^"\\]|\\.)*"\s*:/g;
    while ((match = keyRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length - 1, // exclude the colon
        scope: 'support.type.property-name.json'
      });
    }

    // String values
    const stringRegex = /"([^"\\]|\\.)*"/g;
    while ((match = stringRegex.exec(line)) !== null) {
      // Check if it's a key (already covered)
      const isKey = tokens.some(t => 
        t.scope === 'support.type.property-name.json' &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!isKey) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'string.quoted.json'
        });
      }
    }

    // Numbers
    const numberRegex = /-?\b\d+\.?\d*(?:e[+-]?\d+)?\b/g;
    while ((match = numberRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'constant.numeric.json'
      });
    }

    // Booleans and null
    const constRegex = /\b(true|false|null)\b/g;
    while ((match = constRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: match[0] === 'null' ? 'constant.language.null' : 'constant.language.boolean'
      });
    }

    tokens.sort((a, b) => a.start - b.start);
    return tokens;
  }

  /**
   * Highlight a Python line using regex patterns
   */
  private highlightPythonLine(lineNumber: number): HighlightToken[] {
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const line = lines[lineNumber]!;
    if (line.length === 0) return [];

    const tokens: HighlightToken[] = [];
    let match;

    // Comments: # ...
    const commentRegex = /#.*/g;
    while ((match = commentRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'comment.line'
      });
    }

    // Triple-quoted strings
    const tripleStringRegex = /("""|''').*?(\1|$)/g;
    while ((match = tripleStringRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'string.quoted'
      });
    }

    // Regular strings
    const stringRegex = /(["'])(?:(?!\1)[^\\]|\\.)*\1/g;
    while ((match = stringRegex.exec(line)) !== null) {
      const inTriple = tokens.some(t => 
        t.scope === 'string.quoted' &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inTriple) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'string.quoted'
        });
      }
    }

    // Keywords
    const keywordRegex = /\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|break|continue|pass|lambda|and|or|not|in|is|True|False|None|async|await|global|nonlocal)\b/g;
    while ((match = keywordRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        let scope = 'keyword';
        const word = match[0];
        if (['def', 'class', 'lambda'].includes(word)) {
          scope = 'keyword.declaration';
        } else if (['if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with'].includes(word)) {
          scope = 'keyword.control';
        } else if (['import', 'from', 'as'].includes(word)) {
          scope = 'keyword.control.import';
        } else if (['True', 'False'].includes(word)) {
          scope = 'constant.language.boolean';
        } else if (word === 'None') {
          scope = 'constant.language.null';
        }
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope
        });
      }
    }

    // Function definitions
    const funcDefRegex = /\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    while ((match = funcDefRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index + 4, // after "def "
        end: match.index + 4 + match[1]!.length,
        scope: 'entity.name.function'
      });
    }

    // Class definitions
    const classDefRegex = /\bclass\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    while ((match = classDefRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index + 6, // after "class "
        end: match.index + 6 + match[1]!.length,
        scope: 'entity.name.class'
      });
    }

    // Decorators
    const decoratorRegex = /@[a-zA-Z_][a-zA-Z0-9_.]*/g;
    while ((match = decoratorRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'entity.name.decorator'
      });
    }

    // Numbers
    const numberRegex = /\b(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:e[+-]?\d+)?j?)\b/g;
    while ((match = numberRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'constant.numeric'
        });
      }
    }

    // Self/cls
    const selfRegex = /\b(self|cls)\b/g;
    while ((match = selfRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'variable.language'
        });
      }
    }

    tokens.sort((a, b) => a.start - b.start);
    return tokens;
  }

  /**
   * Highlight a Rust line using regex patterns
   */
  private highlightRustLine(lineNumber: number): HighlightToken[] {
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const line = lines[lineNumber]!;
    if (line.length === 0) return [];

    const tokens: HighlightToken[] = [];
    let match;

    // Check if we're starting inside a multi-line comment
    const startState = this.lineStartState.get(lineNumber);
    if (startState === 'comment') {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) {
        tokens.push({ start: 0, end: line.length, scope: 'comment.block' });
        return tokens;
      } else {
        tokens.push({ start: 0, end: endIdx + 2, scope: 'comment.block' });
      }
    }

    // Line comments
    const lineCommentRegex = /\/\/.*/g;
    while ((match = lineCommentRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'comment.line'
        });
      }
    }

    // Block comments
    const blockCommentRegex = /\/\*.*?\*\/|\/\*.*$/g;
    while ((match = blockCommentRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'comment.block'
        });
      }
    }

    // Strings
    const stringRegex = /"(?:[^"\\]|\\.)*"/g;
    while ((match = stringRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'string.quoted'
        });
      }
    }

    // Characters
    const charRegex = /'(?:[^'\\]|\\.)'/g;
    while ((match = charRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'string.quoted'
        });
      }
    }

    // Keywords
    const keywordRegex = /\b(fn|let|mut|const|static|struct|enum|impl|trait|type|where|pub|crate|mod|use|as|self|Self|super|if|else|match|loop|while|for|in|break|continue|return|async|await|move|ref|unsafe|extern|dyn|true|false)\b/g;
    while ((match = keywordRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        let scope = 'keyword';
        const word = match[0];
        if (['fn', 'let', 'const', 'static', 'struct', 'enum', 'impl', 'trait', 'type', 'mod'].includes(word)) {
          scope = 'keyword.declaration';
        } else if (['if', 'else', 'match', 'loop', 'while', 'for'].includes(word)) {
          scope = 'keyword.control';
        } else if (['use', 'mod', 'crate', 'pub', 'extern'].includes(word)) {
          scope = 'keyword.control.import';
        } else if (['true', 'false'].includes(word)) {
          scope = 'constant.language.boolean';
        } else if (['self', 'Self', 'super'].includes(word)) {
          scope = 'variable.language';
        }
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope
        });
      }
    }

    // Types (capitalized identifiers)
    const typeRegex = /\b([A-Z][a-zA-Z0-9_]*)\b/g;
    while ((match = typeRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      const isKeyword = tokens.some(t => 
        t.scope.startsWith('keyword') &&
        match!.index === t.start
      );
      if (!inStringOrComment && !isKeyword && match[0] !== 'Self') {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'entity.name.type'
        });
      }
    }

    // Macros
    const macroRegex = /\b[a-z_][a-z0-9_]*!/g;
    while ((match = macroRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'entity.name.function.macro'
      });
    }

    // Lifetimes
    const lifetimeRegex = /'[a-z_][a-z0-9_]*/g;
    while ((match = lifetimeRegex.exec(line)) !== null) {
      // Make sure it's not a char literal
      const isChar = tokens.some(t => 
        t.scope === 'string.quoted' &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!isChar) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'storage.modifier.lifetime'
        });
      }
    }

    // Numbers
    const numberRegex = /\b(0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[0-9_]*\.?[0-9_]*(?:e[+-]?[0-9_]+)?(?:f32|f64|i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize)?)\b/g;
    while ((match = numberRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'constant.numeric'
        });
      }
    }

    // Attributes
    const attrRegex = /#\[.*?\]/g;
    while ((match = attrRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'meta.attribute'
      });
    }

    tokens.sort((a, b) => a.start - b.start);
    return tokens;
  }

  /**
   * Highlight a Go line using regex patterns
   */
  private highlightGoLine(lineNumber: number): HighlightToken[] {
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const line = lines[lineNumber]!;
    if (line.length === 0) return [];

    const tokens: HighlightToken[] = [];
    let match;

    // Check if we're starting inside a multi-line comment
    const startState = this.lineStartState.get(lineNumber);
    if (startState === 'comment') {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) {
        tokens.push({ start: 0, end: line.length, scope: 'comment.block' });
        return tokens;
      } else {
        tokens.push({ start: 0, end: endIdx + 2, scope: 'comment.block' });
      }
    }

    // Line comments
    const lineCommentRegex = /\/\/.*/g;
    while ((match = lineCommentRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'comment.line'
        });
      }
    }

    // Block comments
    const blockCommentRegex = /\/\*.*?\*\/|\/\*.*$/g;
    while ((match = blockCommentRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'comment.block'
        });
      }
    }

    // Strings
    const stringRegex = /"(?:[^"\\]|\\.)*"|`[^`]*`/g;
    while ((match = stringRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'string.quoted'
        });
      }
    }

    // Characters
    const charRegex = /'(?:[^'\\]|\\.)'/g;
    while ((match = charRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'string.quoted'
        });
      }
    }

    // Keywords
    const keywordRegex = /\b(package|import|func|type|struct|interface|map|chan|const|var|if|else|switch|case|default|for|range|break|continue|return|go|defer|select|fallthrough|true|false|nil|iota)\b/g;
    while ((match = keywordRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        let scope = 'keyword';
        const word = match[0];
        if (['func', 'type', 'struct', 'interface', 'const', 'var'].includes(word)) {
          scope = 'keyword.declaration';
        } else if (['if', 'else', 'switch', 'case', 'default', 'for', 'range', 'select'].includes(word)) {
          scope = 'keyword.control';
        } else if (['package', 'import'].includes(word)) {
          scope = 'keyword.control.import';
        } else if (['true', 'false'].includes(word)) {
          scope = 'constant.language.boolean';
        } else if (word === 'nil') {
          scope = 'constant.language.null';
        }
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope
        });
      }
    }

    // Types (capitalized identifiers, but also built-in types)
    const typeRegex = /\b(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|complex64|complex128|byte|rune|string|bool|error|[A-Z][a-zA-Z0-9_]*)\b/g;
    while ((match = typeRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      const isKeyword = tokens.some(t => 
        t.scope.startsWith('keyword') &&
        match!.index === t.start
      );
      if (!inStringOrComment && !isKeyword) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'entity.name.type'
        });
      }
    }

    // Numbers
    const numberRegex = /\b(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:e[+-]?\d+)?i?)\b/g;
    while ((match = numberRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'constant.numeric'
        });
      }
    }

    tokens.sort((a, b) => a.start - b.start);
    return tokens;
  }

  /**
   * Highlight an HTML line using regex patterns
   */
  private highlightHtmlLine(lineNumber: number): HighlightToken[] {
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const line = lines[lineNumber]!;
    if (line.length === 0) return [];

    const tokens: HighlightToken[] = [];
    let match;

    // Check if we're starting inside a multi-line comment
    const startState = this.lineStartState.get(lineNumber);
    if (startState === 'comment') {
      const endIdx = line.indexOf('-->');
      if (endIdx === -1) {
        tokens.push({ start: 0, end: line.length, scope: 'comment.block.html' });
        return tokens;
      } else {
        tokens.push({ start: 0, end: endIdx + 3, scope: 'comment.block.html' });
      }
    }

    // Comments
    const commentRegex = /<!--.*?-->|<!--.*$/g;
    while ((match = commentRegex.exec(line)) !== null) {
      const alreadyCovered = tokens.some(t => match!.index >= t.start && match!.index < t.end);
      if (!alreadyCovered) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'comment.block.html'
        });
      }
    }

    // Tags
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g;
    while ((match = tagRegex.exec(line)) !== null) {
      const inComment = tokens.some(t => t.scope.startsWith('comment') && match!.index >= t.start && match!.index < t.end);
      if (!inComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'entity.name.tag.html'
        });
      }
    }

    // Attributes
    const attrRegex = /\s([a-zA-Z][a-zA-Z0-9-]*)(?==)/g;
    while ((match = attrRegex.exec(line)) !== null) {
      const inComment = tokens.some(t => t.scope.startsWith('comment') && match!.index >= t.start && match!.index < t.end);
      if (!inComment) {
        tokens.push({
          start: match.index + 1,
          end: match.index + 1 + match[1]!.length,
          scope: 'entity.other.attribute-name.html'
        });
      }
    }

    // Attribute values
    const valueRegex = /=\s*(["'])(?:(?!\1)[^\\]|\\.)*\1/g;
    while ((match = valueRegex.exec(line)) !== null) {
      const inComment = tokens.some(t => t.scope.startsWith('comment') && match!.index >= t.start && match!.index < t.end);
      if (!inComment) {
        tokens.push({
          start: match.index + 1,
          end: match.index + match[0].length,
          scope: 'string.quoted.html'
        });
      }
    }

    // DOCTYPE
    const doctypeRegex = /<!DOCTYPE[^>]*>/gi;
    while ((match = doctypeRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'meta.tag.sgml.doctype.html'
      });
    }

    tokens.sort((a, b) => a.start - b.start);
    return tokens;
  }

  /**
   * Highlight a Bash/Shell line using regex patterns
   */
  private highlightBashLine(lineNumber: number): HighlightToken[] {
    const lines = this.content.split('\n');
    if (lineNumber >= lines.length) return [];

    const line = lines[lineNumber]!;
    if (line.length === 0) return [];

    const tokens: HighlightToken[] = [];
    let match;

    // Comments
    const commentRegex = /#.*/g;
    while ((match = commentRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'comment.line'
      });
    }

    // Strings
    const stringRegex = /(["'])(?:(?!\1)[^\\]|\\.)*\1/g;
    while ((match = stringRegex.exec(line)) !== null) {
      const inComment = tokens.some(t => 
        t.scope === 'comment.line' &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'string.quoted'
        });
      }
    }

    // Keywords
    const keywordRegex = /\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|break|continue|local|export|source|alias|unalias|set|unset|declare|readonly|shift|eval|exec|trap)\b/g;
    while ((match = keywordRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'keyword.control'
        });
      }
    }

    // Variables: $var, ${var}
    const varRegex = /\$[a-zA-Z_][a-zA-Z0-9_]*|\$\{[^}]+\}/g;
    while ((match = varRegex.exec(line)) !== null) {
      const inComment = tokens.some(t => 
        t.scope === 'comment.line' &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'variable.other'
        });
      }
    }

    // Command substitution: $(...)
    const cmdSubRegex = /\$\([^)]+\)/g;
    while ((match = cmdSubRegex.exec(line)) !== null) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        scope: 'string.interpolated'
      });
    }

    // Numbers
    const numberRegex = /\b\d+\b/g;
    while ((match = numberRegex.exec(line)) !== null) {
      const inStringOrComment = tokens.some(t => 
        (t.scope.startsWith('string') || t.scope.startsWith('comment')) &&
        match!.index >= t.start && match!.index < t.end
      );
      if (!inStringOrComment) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          scope: 'constant.numeric'
        });
      }
    }

    tokens.sort((a, b) => a.start - b.start);
    return tokens;
  }

  /**
   * Recursively collect tokens from nodes that intersect with a line
   */
  private collectTokensForLine(
    node: any,
    lineNumber: number,
    lineLength: number,
    tokens: HighlightToken[]
  ): void {
    // Skip nodes that don't intersect this line
    if (node.endPosition.row < lineNumber || node.startPosition.row > lineNumber) {
      return;
    }

    // Get scope for this node type
    const scope = this.getScopeForNode(node);
    
    if (scope && node.childCount === 0) {
      // This is a leaf node - add it as a token
      const startCol = node.startPosition.row === lineNumber ? node.startPosition.column : 0;
      const endCol = node.endPosition.row === lineNumber ? node.endPosition.column : lineLength;
      
      if (startCol < endCol && startCol < lineLength) {
        tokens.push({
          start: startCol,
          end: Math.min(endCol, lineLength),
          scope
        });
      }
    }

    // Recurse into children
    for (const child of node.children) {
      this.collectTokensForLine(child, lineNumber, lineLength, tokens);
    }
  }

  /**
   * Get the TextMate scope for a tree-sitter node
   */
  private getScopeForNode(node: any): string | null {
    const nodeType = node.type;
    
    // Check direct mapping
    if (NODE_TYPE_TO_SCOPE[nodeType]) {
      return NODE_TYPE_TO_SCOPE[nodeType];
    }

    // Check operator mapping for leaf nodes
    if (node.childCount === 0) {
      const text = node.text;
      if (OPERATOR_SCOPES[text]) {
        return OPERATOR_SCOPES[text];
      }
    }

    // Special handling for certain node types based on parent context
    const parent = node.parent;
    if (parent) {
      // Function/method names
      if (parent.type === 'function_declaration' || parent.type === 'method_definition') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode === node) {
          return 'entity.name.function';
        }
      }
      
      // Class names
      if (parent.type === 'class_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode === node) {
          return 'entity.name.class';
        }
      }
      
      // Interface/type names
      if (parent.type === 'interface_declaration' || parent.type === 'type_alias_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode === node) {
          return 'entity.name.type';
        }
      }

      // Function calls
      if (parent.type === 'call_expression') {
        const funcNode = parent.childForFieldName('function');
        if (funcNode === node || (funcNode?.type === 'member_expression' && funcNode.lastChild === node)) {
          return 'entity.name.function';
        }
      }

      // Property access
      if (parent.type === 'member_expression' && parent.lastChild === node) {
        return 'variable.other.property';
      }

      // Parameter names
      if (parent.type === 'required_parameter' || parent.type === 'optional_parameter' ||
          parent.type === 'formal_parameters' || parent.type === 'parameter') {
        if (node.type === 'identifier') {
          return 'variable.parameter';
        }
      }

      // Object property keys
      if (parent.type === 'pair' && parent.firstChild === node) {
        return 'variable.other.property';
      }

      // Decorator names
      if (parent.type === 'decorator') {
        return 'entity.name.decorator';
      }
    }

    return null;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.lineCache.clear();
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(languageId: string): boolean {
    return treeSitterLoader.getSupportedLanguages().includes(languageId);
  }
}

export const highlighter = new Highlighter();

export default highlighter;
