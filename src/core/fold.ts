/**
 * Code Folding
 * 
 * Handles detection of foldable regions and fold state management.
 * Supports indentation-based folding and bracket-based folding.
 */

export interface FoldRegion {
  startLine: number;
  endLine: number;
  indent: number;
  isFolded: boolean;
}

export class FoldManager {
  private regions: FoldRegion[] = [];
  private foldedLines: Set<number> = new Set();  // Lines that are hidden due to folding
  private foldStartLines: Set<number> = new Set();  // Lines that start a fold (for gutter icons)
  
  /**
   * Compute foldable regions from document content
   */
  computeRegions(lines: string[]): void {
    this.regions = [];
    this.foldStartLines.clear();
    
    if (lines.length === 0) return;
    
    // Stack for tracking nested regions
    const stack: { line: number; indent: number }[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trimStart();
      
      // Skip empty lines for indent calculation
      if (trimmed.length === 0) continue;
      
      const indent = line.length - trimmed.length;
      
      // Close regions that have lower or equal indentation
      while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
        const start = stack.pop()!;
        // Only create region if it spans multiple lines
        if (i - start.line > 1) {
          this.regions.push({
            startLine: start.line,
            endLine: i - 1,
            indent: start.indent,
            isFolded: false
          });
          this.foldStartLines.add(start.line);
        }
      }
      
      // Check if this line starts a foldable block
      // Look for: opening braces, colons (Python), or significant indent increase
      const endsWithBrace = trimmed.endsWith('{');
      const endsWithColon = trimmed.endsWith(':');
      const endsWithBracket = trimmed.endsWith('[');
      const endsWithParen = trimmed.endsWith('(');
      
      if (endsWithBrace || endsWithColon || endsWithBracket || endsWithParen) {
        stack.push({ line: i, indent });
      } else {
        // Check for indent-based folding (next line has greater indent)
        const nextNonEmpty = this.findNextNonEmptyLine(lines, i + 1);
        if (nextNonEmpty !== -1) {
          const nextLine = lines[nextNonEmpty]!;
          const nextIndent = nextLine.length - nextLine.trimStart().length;
          if (nextIndent > indent) {
            stack.push({ line: i, indent });
          }
        }
      }
    }
    
    // Close any remaining regions at end of file
    while (stack.length > 0) {
      const start = stack.pop()!;
      if (lines.length - 1 - start.line > 0) {
        this.regions.push({
          startLine: start.line,
          endLine: lines.length - 1,
          indent: start.indent,
          isFolded: false
        });
        this.foldStartLines.add(start.line);
      }
    }
    
    // Sort regions by start line
    this.regions.sort((a, b) => a.startLine - b.startLine);
    
    // Recompute folded lines based on existing fold state
    this.recomputeFoldedLines();
  }
  
  private findNextNonEmptyLine(lines: string[], start: number): number {
    for (let i = start; i < lines.length; i++) {
      if (lines[i]!.trim().length > 0) {
        return i;
      }
    }
    return -1;
  }
  
  /**
   * Check if a line can be folded (is the start of a fold region)
   */
  canFold(line: number): boolean {
    return this.foldStartLines.has(line);
  }
  
  /**
   * Alias for canFold - check if line is foldable
   */
  isFoldableAt(line: number): boolean {
    return this.canFold(line);
  }
  
  /**
   * Check if a line is currently folded
   */
  isFolded(line: number): boolean {
    return this.regions.some(r => r.startLine === line && r.isFolded);
  }
  
  /**
   * Check if a line is hidden (inside a folded region)
   */
  isHidden(line: number): boolean {
    return this.foldedLines.has(line);
  }
  
  /**
   * Alias for isHidden - check if line is hidden
   */
  isLineHidden(line: number): boolean {
    return this.isHidden(line);
  }
  
  /**
   * Toggle fold at a specific line
   */
  toggleFold(line: number): boolean {
    const region = this.regions.find(r => r.startLine === line);
    if (!region) return false;
    
    region.isFolded = !region.isFolded;
    this.recomputeFoldedLines();
    return true;
  }
  
  /**
   * Fold at a specific line
   */
  fold(line: number): boolean {
    const region = this.regions.find(r => r.startLine === line);
    if (!region || region.isFolded) return false;
    
    region.isFolded = true;
    this.recomputeFoldedLines();
    return true;
  }
  
  /**
   * Unfold at a specific line
   */
  unfold(line: number): boolean {
    const region = this.regions.find(r => r.startLine === line);
    if (!region || !region.isFolded) return false;
    
    region.isFolded = false;
    this.recomputeFoldedLines();
    return true;
  }
  
  /**
   * Fold all regions
   */
  foldAll(): void {
    for (const region of this.regions) {
      region.isFolded = true;
    }
    this.recomputeFoldedLines();
  }
  
  /**
   * Unfold all regions
   */
  unfoldAll(): void {
    for (const region of this.regions) {
      region.isFolded = false;
    }
    this.recomputeFoldedLines();
  }
  
  /**
   * Find the fold region containing a given line (for folding the block cursor is in)
   */
  findRegionContaining(line: number): FoldRegion | null {
    // Find the innermost region containing this line
    let best: FoldRegion | null = null;
    
    for (const region of this.regions) {
      if (line >= region.startLine && line <= region.endLine) {
        // Prefer smaller (more nested) regions
        if (!best || (region.endLine - region.startLine) < (best.endLine - best.startLine)) {
          best = region;
        }
      }
    }
    
    return best;
  }
  
  /**
   * Fold the region containing the given line
   */
  foldContaining(line: number): boolean {
    const region = this.findRegionContaining(line);
    if (!region || region.isFolded) return false;
    
    region.isFolded = true;
    this.recomputeFoldedLines();
    return true;
  }
  
  /**
   * Get the fold region starting at a line (if any)
   */
  getRegionAt(line: number): FoldRegion | null {
    return this.regions.find(r => r.startLine === line) || null;
  }
  
  /**
   * Recompute which lines are hidden due to folding
   */
  private recomputeFoldedLines(): void {
    this.foldedLines.clear();
    
    for (const region of this.regions) {
      if (region.isFolded) {
        for (let i = region.startLine + 1; i <= region.endLine; i++) {
          this.foldedLines.add(i);
        }
      }
    }
  }
  
  /**
   * Get the number of folded lines after a given line
   * (for displaying "... X lines" indicator)
   */
  getFoldedLineCount(line: number): number {
    const region = this.regions.find(r => r.startLine === line && r.isFolded);
    if (!region) return 0;
    return region.endLine - region.startLine;
  }
  
  /**
   * Convert a visible line index to actual buffer line
   */
  visibleToBuffer(visibleLine: number): number {
    let bufferLine = 0;
    let visible = 0;
    
    while (visible < visibleLine && bufferLine < 100000) {  // Safety limit
      if (!this.foldedLines.has(bufferLine)) {
        visible++;
      }
      bufferLine++;
    }
    
    // Skip any folded lines at the target
    while (this.foldedLines.has(bufferLine)) {
      bufferLine++;
    }
    
    return bufferLine;
  }
  
  /**
   * Convert a buffer line to visible line index
   */
  bufferToVisible(bufferLine: number): number {
    let visible = 0;
    
    for (let i = 0; i < bufferLine; i++) {
      if (!this.foldedLines.has(i)) {
        visible++;
      }
    }
    
    return visible;
  }
  
  /**
   * Get total visible line count
   */
  getVisibleLineCount(totalLines: number): number {
    let count = 0;
    for (let i = 0; i < totalLines; i++) {
      if (!this.foldedLines.has(i)) {
        count++;
      }
    }
    return count;
  }
  
  /**
   * Clear all fold state
   */
  clear(): void {
    this.regions = [];
    this.foldedLines.clear();
    this.foldStartLines.clear();
  }
}
