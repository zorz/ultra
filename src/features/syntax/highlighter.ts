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

  /**
   * Set the language for highlighting
   */
  setLanguage(languageId: string): boolean {
    if (this.languageId === languageId) return true;
    
    this.parser = treeSitterLoader.createParser(languageId);
    if (!this.parser) {
      this.languageId = null;
      this.tree = null;
      return false;
    }
    
    this.languageId = languageId;
    this.tree = null;
    this.lineCache.clear();
    return true;
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
    if (!this.parser) return;
    
    this.content = content;
    this.tree = this.parser.parse(content);
    this.lineCache.clear();
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
