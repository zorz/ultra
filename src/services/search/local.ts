/**
 * Local Search Service
 *
 * Search service implementation using ripgrep for fast file searching.
 */

import { $ } from 'bun';
import type { SearchService } from './interface.ts';
import type {
  SearchOptions,
  SearchResult,
  SearchFileResult,
  SearchMatchResult,
  ReplaceResult,
  SearchProgressCallback,
  Unsubscribe,
} from './types.ts';
import { debugLog } from '../../debug.ts';

// ============================================
// Local Search Service
// ============================================

export class LocalSearchService implements SearchService {
  private workspaceRoot: string = '';
  private abortController: AbortController | null = null;
  private progressCallbacks: Set<SearchProgressCallback> = new Set();

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    debugLog(`[SearchService] Workspace root set to: ${root}`);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Search
  // ─────────────────────────────────────────────────────────────────────────

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    this.cancel(); // Cancel any ongoing search
    this.abortController = new AbortController();

    const startTime = Date.now();

    if (!query) {
      return {
        query,
        files: [],
        totalMatches: 0,
        truncated: false,
        durationMs: 0,
      };
    }

    try {
      const args = this.buildRipgrepArgs(query, options);
      debugLog(`[SearchService] Running: rg ${args.join(' ')}`);

      // Notify progress start
      this.notifyProgress({
        filesSearched: 0,
        matchesFound: 0,
        complete: false,
      });

      const proc = Bun.spawn(['rg', ...args], {
        cwd: this.workspaceRoot,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // ripgrep exits with 1 when no matches found, 0 on success, 2 on error
      if (exitCode === 2) {
        const stderr = await new Response(proc.stderr).text();
        debugLog(`[SearchService] ripgrep error: ${stderr}`);
      }

      const result = this.parseRipgrepOutput(query, output, options);
      result.durationMs = Date.now() - startTime;

      // Notify progress complete
      this.notifyProgress({
        filesSearched: result.files.length,
        matchesFound: result.totalMatches,
        complete: true,
      });

      debugLog(
        `[SearchService] Found ${result.totalMatches} matches in ${result.files.length} files (${result.durationMs}ms)`
      );

      return result;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        debugLog(`[SearchService] Search cancelled`);
        return {
          query,
          files: [],
          totalMatches: 0,
          truncated: false,
          durationMs: Date.now() - startTime,
        };
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Build ripgrep command-line arguments.
   */
  private buildRipgrepArgs(query: string, options: SearchOptions): string[] {
    const args: string[] = [
      '--json', // JSON output for structured parsing
      '--line-number',
      '--column',
    ];

    // Case sensitivity
    if (!options.caseSensitive) {
      args.push('-i');
    }

    // Whole word matching
    if (options.wholeWord) {
      args.push('-w');
    }

    // Regex vs fixed string
    if (!options.regex) {
      args.push('-F'); // Fixed string (literal)
    }

    // Include/exclude patterns
    if (options.includeGlob) {
      args.push('-g', options.includeGlob);
    }
    if (options.excludeGlob) {
      args.push('-g', `!${options.excludeGlob}`);
    }

    // Result limit
    if (options.maxResults) {
      args.push('-m', String(options.maxResults));
    }

    // Context lines
    if (options.contextLines && options.contextLines > 0) {
      args.push('-C', String(options.contextLines));
    }

    // The query itself
    args.push('--', query);

    return args;
  }

  /**
   * Parse ripgrep JSON output.
   */
  private parseRipgrepOutput(
    query: string,
    output: string,
    options: SearchOptions
  ): SearchResult {
    const filesMap: Map<string, SearchMatchResult[]> = new Map();
    let totalMatches = 0;

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;

      try {
        const data = JSON.parse(line);

        if (data.type === 'match') {
          const path = data.data.path.text;
          const lineNum = data.data.line_number;
          const lineText = data.data.lines.text.replace(/\n$/, ''); // Remove trailing newline

          if (!filesMap.has(path)) {
            filesMap.set(path, []);
          }

          // Handle multiple submatches on the same line
          for (const submatch of data.data.submatches) {
            filesMap.get(path)!.push({
              line: lineNum,
              column: submatch.start,
              length: submatch.end - submatch.start,
              lineText,
            });
            totalMatches++;
          }
        }
      } catch {
        // Skip malformed JSON lines (context lines, summary, etc.)
      }
    }

    const files: SearchFileResult[] = Array.from(filesMap.entries()).map(([path, matches]) => ({
      path,
      matches,
    }));

    const maxResults = options.maxResults ?? 1000;
    const truncated = totalMatches >= maxResults;

    return {
      query,
      files,
      totalMatches,
      truncated,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Replace
  // ─────────────────────────────────────────────────────────────────────────

  async replace(
    query: string,
    replacement: string,
    options: SearchOptions = {}
  ): Promise<ReplaceResult> {
    // First, search to find all matches
    const searchResult = await this.search(query, options);

    if (searchResult.files.length === 0) {
      return {
        filesModified: 0,
        matchesReplaced: 0,
        errors: [],
      };
    }

    // Replace in each file
    const filesToReplace = searchResult.files.map((f) => ({
      path: f.path,
      matches: f.matches.map((m) => ({
        line: m.line,
        column: m.column,
        length: m.length,
      })),
    }));

    return this.replaceInFiles(filesToReplace, query, replacement, options);
  }

  async replaceInFiles(
    files: { path: string; matches: { line: number; column: number; length: number }[] }[],
    query: string,
    replacement: string,
    options: SearchOptions = {}
  ): Promise<ReplaceResult> {
    let filesModified = 0;
    let matchesReplaced = 0;
    const errors: { path: string; error: string }[] = [];

    for (const fileInfo of files) {
      const filePath = `${this.workspaceRoot}/${fileInfo.path}`;

      try {
        // Read file content
        const file = Bun.file(filePath);
        const content = await file.text();
        const lines = content.split('\n');

        // Sort matches by line and column (descending) to replace from end to start
        const sortedMatches = [...fileInfo.matches].sort((a, b) => {
          if (a.line !== b.line) return b.line - a.line;
          return b.column - a.column;
        });

        let modified = false;

        for (const match of sortedMatches) {
          const lineIdx = match.line - 1; // Convert to 0-based
          if (lineIdx < 0 || lineIdx >= lines.length) continue;

          const line = lines[lineIdx]!;

          // Perform replacement
          let actualReplacement = replacement;

          // Handle regex group references if in regex mode
          if (options.regex) {
            const regex = new RegExp(query, options.caseSensitive ? 'g' : 'gi');
            const matchText = line.substring(match.column, match.column + match.length);
            const regexMatch = regex.exec(matchText);

            if (regexMatch) {
              // Replace $1, $2, etc. with capture groups
              actualReplacement = replacement.replace(/\$(\d+)/g, (_, num) => {
                const idx = parseInt(num, 10);
                return regexMatch[idx] ?? '';
              });
            }
          }

          // Replace in line
          const before = line.substring(0, match.column);
          const after = line.substring(match.column + match.length);
          lines[lineIdx] = before + actualReplacement + after;

          modified = true;
          matchesReplaced++;
        }

        if (modified) {
          // Write file back
          await Bun.write(filePath, lines.join('\n'));
          filesModified++;
          debugLog(`[SearchService] Modified: ${fileInfo.path}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ path: fileInfo.path, error: errorMsg });
        debugLog(`[SearchService] Error replacing in ${fileInfo.path}: ${errorMsg}`);
      }
    }

    debugLog(
      `[SearchService] Replace complete: ${matchesReplaced} matches in ${filesModified} files`
    );

    return {
      filesModified,
      matchesReplaced,
      errors,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cancellation
  // ─────────────────────────────────────────────────────────────────────────

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      debugLog(`[SearchService] Search cancelled`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Progress
  // ─────────────────────────────────────────────────────────────────────────

  onProgress(callback: SearchProgressCallback): Unsubscribe {
    this.progressCallbacks.add(callback);
    return () => {
      this.progressCallbacks.delete(callback);
    };
  }

  private notifyProgress(progress: { filesSearched: number; matchesFound: number; complete: boolean; currentFile?: string }): void {
    for (const callback of this.progressCallbacks) {
      callback(progress);
    }
  }
}

// ============================================
// Singleton
// ============================================

export const localSearchService = new LocalSearchService();
export default localSearchService;
