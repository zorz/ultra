/**
 * Query History Manager
 *
 * Manages query history with git-based versioning.
 * Stores history in ~/.ultra/database/query-history/
 */

import { $ } from 'bun';
import { appendFile } from 'node:fs/promises';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { debugLog } from '../../debug.ts';
import type { QueryHistoryEntry } from './types.ts';

const DEFAULT_HISTORY_DIR = join(homedir(), '.ultra', 'database', 'query-history');

const MAX_HISTORY_ENTRIES = 10000;
const GIT_COMMIT_THRESHOLD = 10; // Commit after this many new entries

/**
 * Favorites file structure.
 */
interface FavoritesData {
  favorites: string[]; // Array of history entry IDs
}

/**
 * Configuration options for QueryHistoryManager.
 */
export interface QueryHistoryConfig {
  /** Override the history directory (for testing). */
  historyDir?: string;
  /** Disable git versioning (for testing). */
  disableGit?: boolean;
}

/**
 * Query History Manager.
 *
 * Maintains query history with:
 * - Append-only JSONL log for fast writes
 * - Separate favorites tracking
 * - Git versioning for history
 */
export class QueryHistoryManager {
  private entriesSinceCommit = 0;
  private initialized = false;
  private favorites = new Set<string>();
  private historyDir: string;
  private historyFile: string;
  private favoritesFile: string;
  private disableGit: boolean;

  constructor(config?: QueryHistoryConfig) {
    this.historyDir = config?.historyDir ?? DEFAULT_HISTORY_DIR;
    this.historyFile = join(this.historyDir, 'history.jsonl');
    this.favoritesFile = join(this.historyDir, 'favorites.json');
    this.disableGit = config?.disableGit ?? false;
  }

  /**
   * Initialize the history manager.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Ensure directory exists
      await $`mkdir -p ${this.historyDir}`.quiet();

      // Initialize git repo if needed (unless disabled)
      if (!this.disableGit) {
        const gitDir = join(this.historyDir, '.git');
        const gitExists = await Bun.file(gitDir).exists();

        if (!gitExists) {
          await $`git -C ${this.historyDir} init`.quiet();
          await $`git -C ${this.historyDir} config user.email "ultra@localhost"`.quiet();
          await $`git -C ${this.historyDir} config user.name "Ultra Editor"`.quiet();

          // Create initial files
          await Bun.write(this.historyFile, '');
          await Bun.write(this.favoritesFile, JSON.stringify({ favorites: [] }));

          await $`git -C ${this.historyDir} add .`.quiet();
          await $`git -C ${this.historyDir} commit -m "Initialize query history"`.quiet();

          debugLog('[QueryHistory] Initialized new git repository');
        }
      } else {
        // Without git, just create files if they don't exist
        if (!await Bun.file(this.historyFile).exists()) {
          await Bun.write(this.historyFile, '');
        }
        if (!await Bun.file(this.favoritesFile).exists()) {
          await Bun.write(this.favoritesFile, JSON.stringify({ favorites: [] }));
        }
      }

      // Load favorites
      await this.loadFavorites();

      this.initialized = true;
      debugLog('[QueryHistory] Initialized');
    } catch (error) {
      debugLog(`[QueryHistory] Failed to initialize: ${error}`);
      // Continue without git - history will still work
      this.initialized = true;
    }
  }

  /**
   * Add a query to history.
   */
  async addEntry(entry: Omit<QueryHistoryEntry, 'id' | 'isFavorite'>): Promise<QueryHistoryEntry> {
    await this.ensureInitialized();

    const fullEntry: QueryHistoryEntry = {
      ...entry,
      id: randomUUID(),
      isFavorite: false,
    };

    // Append to JSONL file
    const line = JSON.stringify({
      id: fullEntry.id,
      connectionId: fullEntry.connectionId,
      connectionName: fullEntry.connectionName,
      sql: fullEntry.sql,
      executedAt: fullEntry.executedAt.toISOString(),
      durationMs: fullEntry.durationMs,
      rowCount: fullEntry.rowCount,
      status: fullEntry.status,
      error: fullEntry.error,
    }) + '\n';

    await appendFile(this.historyFile, line);

    this.entriesSinceCommit++;

    // Periodic git commit
    if (this.entriesSinceCommit >= GIT_COMMIT_THRESHOLD) {
      await this.commitHistory();
    }

    return fullEntry;
  }

  /**
   * Get history entries.
   */
  async getHistory(
    connectionId?: string,
    limit = 100,
    offset = 0
  ): Promise<QueryHistoryEntry[]> {
    await this.ensureInitialized();

    const entries = await this.loadAllEntries();

    // Filter by connection if specified
    let filtered = connectionId
      ? entries.filter(e => e.connectionId === connectionId)
      : entries;

    // Sort by executedAt descending (newest first)
    filtered.sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());

    // Apply pagination
    return filtered.slice(offset, offset + limit);
  }

  /**
   * Search history.
   */
  async search(query: string, connectionId?: string): Promise<QueryHistoryEntry[]> {
    await this.ensureInitialized();

    const entries = await this.loadAllEntries();
    const lowerQuery = query.toLowerCase();

    let filtered = entries.filter(e =>
      e.sql.toLowerCase().includes(lowerQuery)
    );

    if (connectionId) {
      filtered = filtered.filter(e => e.connectionId === connectionId);
    }

    // Sort by relevance (exact match first) then by date
    filtered.sort((a, b) => {
      const aExact = a.sql.toLowerCase().startsWith(lowerQuery) ? 1 : 0;
      const bExact = b.sql.toLowerCase().startsWith(lowerQuery) ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return b.executedAt.getTime() - a.executedAt.getTime();
    });

    return filtered.slice(0, 100);
  }

  /**
   * Clear history.
   */
  async clear(connectionId?: string): Promise<void> {
    await this.ensureInitialized();

    if (connectionId) {
      // Keep entries from other connections
      const entries = await this.loadAllEntries();
      const kept = entries.filter(e => e.connectionId !== connectionId);
      await this.writeAllEntries(kept);
    } else {
      // Clear all
      await Bun.write(this.historyFile, '');
      this.favorites.clear();
      await this.saveFavorites();
    }

    await this.commitHistory('Clear history');
  }

  /**
   * Set favorite status.
   */
  async setFavorite(historyId: string, favorite: boolean): Promise<void> {
    await this.ensureInitialized();

    if (favorite) {
      this.favorites.add(historyId);
    } else {
      this.favorites.delete(historyId);
    }

    await this.saveFavorites();
  }

  /**
   * Get favorites.
   */
  async getFavorites(connectionId?: string): Promise<QueryHistoryEntry[]> {
    await this.ensureInitialized();

    const entries = await this.loadAllEntries();

    let favorites = entries.filter(e => this.favorites.has(e.id));

    if (connectionId) {
      favorites = favorites.filter(e => e.connectionId === connectionId);
    }

    favorites.sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());

    return favorites;
  }

  /**
   * Shutdown - commit any pending changes.
   */
  async shutdown(): Promise<void> {
    if (this.entriesSinceCommit > 0) {
      await this.commitHistory();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  private async loadAllEntries(): Promise<QueryHistoryEntry[]> {
    try {
      const file = Bun.file(this.historyFile);
      const exists = await file.exists();

      if (!exists) {
        return [];
      }

      const content = await file.text();
      const lines = content.split('\n').filter(line => line.trim());

      const entries: QueryHistoryEntry[] = [];

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          entries.push({
            id: data.id,
            connectionId: data.connectionId,
            connectionName: data.connectionName,
            sql: data.sql,
            executedAt: new Date(data.executedAt),
            durationMs: data.durationMs,
            rowCount: data.rowCount,
            status: data.status,
            error: data.error,
            isFavorite: this.favorites.has(data.id),
          });
        } catch {
          // Skip malformed lines
        }
      }

      // Trim to max entries
      if (entries.length > MAX_HISTORY_ENTRIES) {
        const trimmed = entries.slice(-MAX_HISTORY_ENTRIES);
        await this.writeAllEntries(trimmed);
        return trimmed;
      }

      return entries;
    } catch (error) {
      debugLog(`[QueryHistory] Failed to load entries: ${error}`);
      return [];
    }
  }

  private async writeAllEntries(entries: QueryHistoryEntry[]): Promise<void> {
    const lines = entries.map(e => JSON.stringify({
      id: e.id,
      connectionId: e.connectionId,
      connectionName: e.connectionName,
      sql: e.sql,
      executedAt: e.executedAt.toISOString(),
      durationMs: e.durationMs,
      rowCount: e.rowCount,
      status: e.status,
      error: e.error,
    })).join('\n') + (entries.length > 0 ? '\n' : '');

    await Bun.write(this.historyFile, lines);
  }

  private async loadFavorites(): Promise<void> {
    try {
      const file = Bun.file(this.favoritesFile);
      const exists = await file.exists();

      if (exists) {
        const content = await file.json() as FavoritesData;
        this.favorites = new Set(content.favorites);
      }
    } catch (error) {
      debugLog(`[QueryHistory] Failed to load favorites: ${error}`);
    }
  }

  private async saveFavorites(): Promise<void> {
    try {
      const data: FavoritesData = {
        favorites: Array.from(this.favorites),
      };
      await Bun.write(this.favoritesFile, JSON.stringify(data, null, 2));
    } catch (error) {
      debugLog(`[QueryHistory] Failed to save favorites: ${error}`);
    }
  }

  private async commitHistory(message = 'Update query history'): Promise<void> {
    if (this.disableGit) {
      this.entriesSinceCommit = 0;
      return;
    }

    try {
      await $`git -C ${this.historyDir} add .`.quiet();

      // Check if there are changes to commit
      const status = await $`git -C ${this.historyDir} status --porcelain`.quiet();
      if (status.text().trim()) {
        await $`git -C ${this.historyDir} commit -m ${message}`.quiet();
        debugLog(`[QueryHistory] Committed: ${message}`);
      }

      this.entriesSinceCommit = 0;
    } catch (error) {
      debugLog(`[QueryHistory] Failed to commit: ${error}`);
    }
  }
}

export const queryHistoryManager = new QueryHistoryManager();
export default queryHistoryManager;
