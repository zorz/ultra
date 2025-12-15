/**
 * Hover Tooltip Component
 * 
 * Displays LSP hover information (type info, documentation).
 */

import type { RenderContext } from '../../ui/renderer.ts';
import type { LSPHover, LSPRange, LSPDocumentSymbol, LSPSymbolInformation } from './client.ts';
import { SymbolKind } from './client.ts';
import { themeLoader } from '../../ui/themes/theme-loader.ts';

export class HoverTooltip {
  private visible = false;
  private content: string[] = [];
  private codeLines: Set<number> = new Set();  // Track which lines are code
  private memberLines: Set<number> = new Set();  // Track which lines are class members
  private x = 0;
  private y = 0;
  private range: LSPRange | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private maxWidth = 100;  // Increased for better readability
  private maxHeight = 30;  // Increased to show more content with members

  /**
   * Show hover info with optional document symbols for additional context
   */
  show(hover: LSPHover, x: number, y: number, symbols?: LSPDocumentSymbol[] | LSPSymbolInformation[]): void {
    // Parse content from hover
    const { lines, codeLines } = this.parseContent(hover);
    this.content = lines;
    this.codeLines = codeLines;
    this.memberLines = new Set();
    
    if (this.content.length === 0) {
      this.hide();
      return;
    }
    
    // If we have symbols, try to find relevant members to show
    if (symbols && symbols.length > 0) {
      this.addSymbolContext(symbols, hover);
    }
    
    this.x = x;
    this.y = y;
    this.range = hover.range || null;
    this.visible = true;
    
    // Clear any pending hide timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /**
   * Hide the tooltip
   */
  hide(): void {
    this.visible = false;
    this.content = [];
    this.codeLines = new Set();
    this.memberLines = new Set();
    this.range = null;
  }

  /**
   * Hide after delay
   */
  hideWithDelay(ms: number = 200): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    this.hideTimeout = setTimeout(() => {
      this.hide();
    }, ms);
  }

  /**
   * Cancel pending hide
   */
  cancelHide(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Get the hover range
   */
  getRange(): LSPRange | null {
    return this.range;
  }

  /**
   * Get symbol kind name for display
   */
  private getSymbolKindIcon(kind: number): string {
    switch (kind) {
      case SymbolKind.Method: return '◆';
      case SymbolKind.Function: return 'ƒ';
      case SymbolKind.Constructor: return '⊕';
      case SymbolKind.Property: return '○';
      case SymbolKind.Field: return '○';
      case SymbolKind.Variable: return '●';
      case SymbolKind.Class: return '◇';
      case SymbolKind.Interface: return '◈';
      case SymbolKind.Enum: return '∈';
      case SymbolKind.EnumMember: return '∙';
      case SymbolKind.Constant: return '◉';
      case SymbolKind.TypeParameter: return 'T';
      default: return '·';
    }
  }

  /**
   * Add class/interface members from symbols to content
   */
  private addSymbolContext(symbols: LSPDocumentSymbol[] | LSPSymbolInformation[], hover: LSPHover): void {
    // Try to extract the symbol name from hover content
    const hoverText = this.getHoverText(hover);
    
    // Look for class/interface definitions in hover
    const classMatch = hoverText.match(/(?:class|interface)\s+(\w+)/);
    if (!classMatch || !classMatch[1]) {
      // Debug: log what we're matching against
      console.error(`[HoverTooltip] No class/interface match in: ${hoverText.substring(0, 100)}`);
      return;
    }
    
    const symbolName = classMatch[1];
    console.error(`[HoverTooltip] Looking for symbol: ${symbolName}`);
    console.error(`[HoverTooltip] Symbols count: ${symbols.length}`);
    if (symbols.length > 0) {
      const first = symbols[0];
      console.error(`[HoverTooltip] First symbol: ${JSON.stringify({ name: first?.name, kind: first?.kind, hasChildren: first && 'children' in first })}`);
    }
    
    // Find matching symbol in document symbols
    const matchingSymbol = this.findSymbol(symbols, symbolName);
    if (!matchingSymbol) {
      console.error(`[HoverTooltip] Symbol not found: ${symbolName}`);
      // List available top-level symbols
      console.error(`[HoverTooltip] Available symbols: ${symbols.slice(0, 10).map(s => s.name).join(', ')}`);
      return;
    }
    
    console.error(`[HoverTooltip] Found symbol: ${matchingSymbol.name}, hasChildren: ${'children' in matchingSymbol}`);
    
    // Check if it's a DocumentSymbol with children (hierarchical)
    if ('children' in matchingSymbol && matchingSymbol.children && matchingSymbol.children.length > 0) {
      console.error(`[HoverTooltip] Adding ${matchingSymbol.children.length} children`);
      this.addMembersSection(matchingSymbol.children);
    } else {
      console.error(`[HoverTooltip] No children found`);
    }
  }

  /**
   * Get raw hover text
   */
  private getHoverText(hover: LSPHover): string {
    const contents = hover.contents;
    if (typeof contents === 'string') return contents;
    if (Array.isArray(contents)) {
      return contents.map(c => typeof c === 'string' ? c : c.value || '').join('\n');
    }
    if (contents && typeof contents === 'object') return contents.value || '';
    return '';
  }

  /**
   * Find symbol by name in document symbols (recursive)
   */
  private findSymbol(symbols: LSPDocumentSymbol[] | LSPSymbolInformation[], name: string): LSPDocumentSymbol | LSPSymbolInformation | null {
    for (const sym of symbols) {
      if (sym.name === name) return sym;
      // Check children if DocumentSymbol
      if ('children' in sym && sym.children) {
        const found = this.findSymbol(sym.children, name);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Add members section to content
   */
  private addMembersSection(children: LSPDocumentSymbol[]): void {
    // Group by kind
    const constructors: LSPDocumentSymbol[] = [];
    const methods: LSPDocumentSymbol[] = [];
    const properties: LSPDocumentSymbol[] = [];
    const others: LSPDocumentSymbol[] = [];

    for (const child of children) {
      switch (child.kind) {
        case SymbolKind.Constructor:
          constructors.push(child);
          break;
        case SymbolKind.Method:
        case SymbolKind.Function:
          methods.push(child);
          break;
        case SymbolKind.Property:
        case SymbolKind.Field:
          properties.push(child);
          break;
        default:
          others.push(child);
      }
    }

    // Add separator
    this.content.push('');
    this.content.push('─── Members ───');
    this.memberLines.add(this.content.length - 1);

    // Add properties first
    if (properties.length > 0) {
      for (const prop of properties.slice(0, 8)) {  // Limit to 8 properties
        const icon = this.getSymbolKindIcon(prop.kind);
        const detail = prop.detail ? `: ${prop.detail}` : '';
        const line = `  ${icon} ${prop.name}${detail}`;
        this.content.push(line.length > this.maxWidth ? line.substring(0, this.maxWidth - 3) + '...' : line);
        this.memberLines.add(this.content.length - 1);
      }
      if (properties.length > 8) {
        this.content.push(`    ... +${properties.length - 8} more properties`);
        this.memberLines.add(this.content.length - 1);
      }
    }

    // Add constructors
    if (constructors.length > 0) {
      for (const ctor of constructors) {
        const icon = this.getSymbolKindIcon(ctor.kind);
        const detail = ctor.detail ? `: ${ctor.detail}` : '';
        const line = `  ${icon} ${ctor.name}${detail}`;
        this.content.push(line.length > this.maxWidth ? line.substring(0, this.maxWidth - 3) + '...' : line);
        this.memberLines.add(this.content.length - 1);
      }
    }

    // Add methods
    if (methods.length > 0) {
      for (const method of methods.slice(0, 10)) {  // Limit to 10 methods
        const icon = this.getSymbolKindIcon(method.kind);
        const detail = method.detail ? `: ${method.detail}` : '()';
        const line = `  ${icon} ${method.name}${detail}`;
        this.content.push(line.length > this.maxWidth ? line.substring(0, this.maxWidth - 3) + '...' : line);
        this.memberLines.add(this.content.length - 1);
      }
      if (methods.length > 10) {
        this.content.push(`    ... +${methods.length - 10} more methods`);
        this.memberLines.add(this.content.length - 1);
      }
    }

    // Add others if any
    if (others.length > 0) {
      for (const other of others.slice(0, 5)) {
        const icon = this.getSymbolKindIcon(other.kind);
        const line = `  ${icon} ${other.name}`;
        this.content.push(line.length > this.maxWidth ? line.substring(0, this.maxWidth - 3) + '...' : line);
        this.memberLines.add(this.content.length - 1);
      }
      if (others.length > 5) {
        this.content.push(`    ... +${others.length - 5} more`);
        this.memberLines.add(this.content.length - 1);
      }
    }
  }

  /**
   * Parse hover content to lines with code detection
   */
  private parseContent(hover: LSPHover): { lines: string[]; codeLines: Set<number> } {
    const contents = hover.contents;
    let text = '';

    if (typeof contents === 'string') {
      text = contents;
    } else if (Array.isArray(contents)) {
      text = contents.map(c => {
        if (typeof c === 'string') return c;
        return c.value || '';
      }).join('\n\n');
    } else if (contents && typeof contents === 'object') {
      text = contents.value || '';
    }

    const lines: string[] = [];
    const codeLines = new Set<number>();
    
    // Process text block by block (code blocks vs regular text)
    const blocks = text.split(/(```[\s\S]*?```)/);
    
    for (const block of blocks) {
      if (block.startsWith('```')) {
        // Code block - extract content without fences
        const codeContent = block.replace(/```\w*\n?/, '').replace(/\n?```$/, '');
        const codeLineArray = codeContent.split('\n');
        
        for (const codeLine of codeLineArray) {
          const trimmed = codeLine.trimEnd();
          if (trimmed || lines.length > 0) {  // Skip leading empty lines
            // Word wrap long code lines
            if (trimmed.length > this.maxWidth) {
              // For code, just truncate with ellipsis
              lines.push(trimmed.substring(0, this.maxWidth - 3) + '...');
              codeLines.add(lines.length - 1);
            } else {
              lines.push(trimmed);
              codeLines.add(lines.length - 1);
            }
          }
        }
      } else {
        // Regular markdown text
        let docText = block;
        
        // Handle markdown formatting
        docText = docText.replace(/\*\*([^*]+)\*\*/g, '$1');  // Bold
        docText = docText.replace(/\*([^*]+)\*/g, '$1');      // Italic
        docText = docText.replace(/_([^_]+)_/g, '$1');        // Underscore italic
        docText = docText.replace(/`([^`]+)`/g, '$1');        // Inline code
        
        // Handle @param, @returns, @example etc.
        docText = docText.replace(/@(\w+)/g, '[$1]');
        
        const docLines = docText.split('\n');
        
        for (const docLine of docLines) {
          const trimmed = docLine.trim();
          if (!trimmed && lines.length > 0 && lines[lines.length - 1] !== '') {
            // Add blank line separator (but not multiple)
            lines.push('');
          } else if (trimmed) {
            // Word wrap long documentation lines
            if (trimmed.length <= this.maxWidth) {
              lines.push(trimmed);
            } else {
              const words = trimmed.split(' ');
              let currentLine = '';
              
              for (const word of words) {
                if (currentLine.length + word.length + 1 <= this.maxWidth) {
                  currentLine += (currentLine ? ' ' : '') + word;
                } else {
                  if (currentLine) lines.push(currentLine);
                  currentLine = word;
                }
              }
              if (currentLine) lines.push(currentLine);
            }
          }
        }
      }
    }

    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    // Limit height
    if (lines.length > this.maxHeight) {
      const truncated = lines.slice(0, this.maxHeight - 1);
      truncated.push('... (more)');
      return { lines: truncated, codeLines };
    }

    return { lines, codeLines };
  }

  /**
   * Handle keyboard - Escape dismisses
   */
  handleKey(key: string): boolean {
    if (!this.visible) return false;

    if (key === 'ESCAPE') {
      this.hide();
      return true;
    }

    return false;
  }

  /**
   * Render the tooltip
   */
  render(ctx: RenderContext, screenWidth: number, screenHeight: number): void {
    if (!this.visible || this.content.length === 0) return;

    // Calculate dimensions
    const contentWidth = Math.min(
      this.maxWidth,
      Math.max(...this.content.map(l => l.length))
    );
    const width = contentWidth + 4;  // +4 for padding and borders
    const height = this.content.length + 2;  // +2 for borders

    // Position above cursor by default
    let tooltipX = this.x;
    let tooltipY = this.y - height;

    // Adjust if would go off screen
    if (tooltipX + width > screenWidth) {
      tooltipX = Math.max(1, screenWidth - width);
    }
    
    if (tooltipY < 1) {
      // Show below cursor instead
      tooltipY = this.y + 1;
    }
    
    if (tooltipY + height > screenHeight) {
      tooltipY = Math.max(1, screenHeight - height);
    }

    // Colors - use existing theme colors
    const bgColor = themeLoader.getColor('sideBar.background') || themeLoader.getColor('editor.background') || '#252526';
    const fgColor = themeLoader.getColor('editor.foreground') || '#d4d4d4';
    const borderColor = themeLoader.getColor('input.border') || themeLoader.getColor('focusBorder') || '#454545';
    const codeColor = themeLoader.getColor('editorCursor.foreground') || '#e5c890';  // Highlight color for code
    const docColor = themeLoader.getColor('editorLineNumber.foreground') || '#888888';  // Dimmer for docs
    const memberColor = themeLoader.getColor('textLink.foreground') || '#81a1c1';  // Color for class members

    // Draw background
    ctx.fill(tooltipX, tooltipY, width, height, ' ', fgColor, bgColor);

    // Top border
    ctx.drawStyled(tooltipX, tooltipY, '┌' + '─'.repeat(width - 2) + '┐', borderColor, bgColor);

    // Content lines
    for (let i = 0; i < this.content.length; i++) {
      const lineY = tooltipY + 1 + i;
      const line = this.content[i] ?? '';
      const isCode = this.codeLines.has(i);
      const isMember = this.memberLines.has(i);
      
      let lineColor: string;
      if (isCode) {
        lineColor = codeColor;
      } else if (isMember) {
        lineColor = memberColor;
      } else if (line.startsWith('[')) {
        lineColor = docColor;
      } else {
        lineColor = fgColor;
      }
      
      // Left border
      ctx.drawStyled(tooltipX, lineY, '│', borderColor, bgColor);
      
      // Content with padding
      const paddedLine = (' ' + line).padEnd(width - 2);
      ctx.drawStyled(tooltipX + 1, lineY, paddedLine, lineColor, bgColor);
      
      // Right border
      ctx.drawStyled(tooltipX + width - 1, lineY, '│', borderColor, bgColor);
    }

    // Bottom border
    ctx.drawStyled(tooltipX, tooltipY + height - 1, '└' + '─'.repeat(width - 2) + '┘', borderColor, bgColor);
  }
}

// Singleton instance
export const hoverTooltip = new HoverTooltip();

export default hoverTooltip;
