/**
 * Fuzzy File Search
 * 
 * Quick file finder with fuzzy matching.
 */

import * as path from 'path';
import * as fs from 'fs';

export interface FileSearchResult {
  path: string;
  relativePath: string;
  name: string;
  score: number;
}

export class FileSearch {
  private files: string[] = [];
  private workspaceRoot: string = '';
  private ignorePatterns: RegExp[] = [];

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    this.loadGitignore();
  }

  /**
   * Load .gitignore patterns
   */
  private loadGitignore(): void {
    this.ignorePatterns = [
      // Default ignores
      /node_modules/,
      /\.git\//,
      /\.DS_Store/,
      /dist\//,
      /build\//,
      /\.cache/,
      /\.next/,
      /coverage\//,
      /\.nyc_output/,
      /\.idea\//,
      /\.vscode\//,
      /\.bun\//,
      /\.turbo\//,
    ];

    // Try to load .gitignore
    try {
      const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Convert gitignore pattern to regex (simplified)
        const pattern = trimmed
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');

        try {
          this.ignorePatterns.push(new RegExp(pattern));
        } catch {
          // Invalid regex, skip
        }
      }
    } catch {
      // No .gitignore or can't read it
    }
  }

  /**
   * Check if a path should be ignored
   */
  private shouldIgnore(relativePath: string): boolean {
    for (const pattern of this.ignorePatterns) {
      if (pattern.test(relativePath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Index all files in the workspace
   */
  async indexFiles(): Promise<void> {
    this.files = [];
    await this.walkDirectory(this.workspaceRoot);
  }

  /**
   * Recursively walk directory and collect files
   */
  private async walkDirectory(dir: string, depth: number = 0): Promise<void> {
    // Limit depth to prevent infinite recursion
    if (depth > 20) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.workspaceRoot, fullPath);

        if (this.shouldIgnore(relativePath)) continue;

        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, depth + 1);
        } else if (entry.isFile()) {
          this.files.push(relativePath);
        }
      }
    } catch {
      // Can't read directory, skip
    }
  }

  /**
   * Search files with fuzzy matching
   */
  search(query: string, limit: number = 50): FileSearchResult[] {
    if (!query) {
      // Return all files (up to limit) sorted alphabetically
      return this.files
        .slice(0, limit)
        .map(relativePath => ({
          path: path.join(this.workspaceRoot, relativePath),
          relativePath,
          name: path.basename(relativePath),
          score: 0
        }));
    }

    const results: FileSearchResult[] = [];

    for (const relativePath of this.files) {
      const score = this.fuzzyScore(query, relativePath);
      if (score >= 0) {
        results.push({
          path: path.join(this.workspaceRoot, relativePath),
          relativePath,
          name: path.basename(relativePath),
          score
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Simple fuzzy match scoring
   */
  private fuzzyScore(query: string, target: string): number {
    const lowerQuery = query.toLowerCase();
    const lowerTarget = target.toLowerCase();

    let score = 0;
    let queryIndex = 0;
    let consecutiveBonus = 0;
    let lastMatchIndex = -1;

    for (let i = 0; i < lowerTarget.length && queryIndex < lowerQuery.length; i++) {
      if (lowerTarget[i] === lowerQuery[queryIndex]) {
        // Bonus for consecutive matches
        if (lastMatchIndex === i - 1) {
          consecutiveBonus += 1;
        } else {
          consecutiveBonus = 0;
        }

        // Bonus for matching at word boundaries (after / or .)
        const isWordBoundary = i === 0 || lowerTarget[i - 1] === '/' || lowerTarget[i - 1] === '.';
        const boundaryBonus = isWordBoundary ? 2 : 0;

        score += 1 + consecutiveBonus + boundaryBonus;
        lastMatchIndex = i;
        queryIndex++;
      }
    }

    // Return -1 if not all query chars matched
    if (queryIndex < lowerQuery.length) return -1;

    // Bonus for shorter paths (prefer closer matches)
    score -= target.length * 0.01;

    // Bonus for matching filename vs directory
    const filename = path.basename(target).toLowerCase();
    if (filename.includes(lowerQuery)) {
      score += 5;
    }

    return score;
  }

  /**
   * Get file count
   */
  getFileCount(): number {
    return this.files.length;
  }
}

export const fileSearch = new FileSearch();

export default fileSearch;
