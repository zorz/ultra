/**
 * SQL Completion Provider
 *
 * Provides database-aware completions for SQL editors.
 * Caches schema information and returns LSP-compatible completion items.
 */

import { debugLog } from '../../debug.ts';
import type { DatabaseService } from './interface.ts';
import type { TableInfo, ColumnInfo, FunctionInfo, SchemaInfo } from './types.ts';

// ============================================
// Types
// ============================================

/**
 * Completion item kind (matches LSP CompletionItemKind).
 */
export enum SQLCompletionKind {
  Keyword = 14,      // LSP Keyword
  Table = 7,         // LSP Class
  View = 8,          // LSP Interface
  Column = 5,        // LSP Field
  Function = 3,      // LSP Function
  Schema = 9,        // LSP Module
  Snippet = 15,      // LSP Snippet
}

/**
 * A SQL completion item.
 */
export interface SQLCompletionItem {
  /** Display label */
  label: string;
  /** Completion kind */
  kind: SQLCompletionKind;
  /** Text to insert (defaults to label) */
  insertText?: string;
  /** Additional detail text */
  detail?: string;
  /** Documentation/description */
  documentation?: string;
  /** Sort priority (lower = higher priority) */
  sortText?: string;
  /** Filter text for matching */
  filterText?: string;
}

/**
 * Cached schema information for a connection.
 */
interface SchemaCache {
  connectionId: string;
  cachedAt: Date;
  schemas: SchemaInfo[];
  tables: Map<string, TableInfo[]>;       // schema -> tables
  columns: Map<string, ColumnInfo[]>;     // schema.table -> columns
  functions: Map<string, FunctionInfo[]>; // schema -> functions
}

/**
 * Context extracted from SQL for completion.
 */
interface SQLContext {
  type: 'keyword' | 'table' | 'column' | 'schema' | 'function' | 'unknown';
  schema?: string;
  table?: string;
  prefix: string;
}

// ============================================
// SQL Keywords
// ============================================

const SQL_KEYWORDS = [
  // DML
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL', 'ON', 'USING',
  'ORDER', 'BY', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
  'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION', 'INTERSECT', 'EXCEPT', 'ALL', 'DISTINCT',
  'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'SIMILAR', 'TO',
  'TRUE', 'FALSE', 'RETURNING', 'WITH', 'RECURSIVE',
  // DDL
  'CREATE', 'TABLE', 'VIEW', 'INDEX', 'FUNCTION', 'TRIGGER', 'PROCEDURE',
  'DROP', 'ALTER', 'TRUNCATE', 'RENAME', 'ADD', 'COLUMN',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
  'CONSTRAINT', 'CASCADE', 'RESTRICT', 'GRANT', 'REVOKE',
  // Transaction
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'SAVEPOINT',
  // Types
  'INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'SERIAL', 'BIGSERIAL',
  'TEXT', 'VARCHAR', 'CHAR', 'CHARACTER', 'VARYING',
  'BOOLEAN', 'BOOL', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ',
  'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE', 'PRECISION', 'FLOAT',
  'JSON', 'JSONB', 'UUID', 'BYTEA', 'ARRAY',
];

const SQL_FUNCTIONS = [
  // Aggregate
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ARRAY_AGG', 'STRING_AGG', 'JSON_AGG',
  // String
  'CONCAT', 'SUBSTRING', 'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM',
  'LENGTH', 'POSITION', 'REPLACE', 'SPLIT_PART', 'LEFT', 'RIGHT',
  // Date/Time
  'NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
  'DATE_TRUNC', 'DATE_PART', 'EXTRACT', 'AGE', 'INTERVAL',
  // Math
  'ABS', 'CEIL', 'FLOOR', 'ROUND', 'TRUNC', 'MOD', 'POWER', 'SQRT',
  // JSON
  'JSON_BUILD_OBJECT', 'JSON_BUILD_ARRAY', 'JSONB_SET', 'JSONB_INSERT',
  'TO_JSON', 'TO_JSONB', 'JSON_OBJECT', 'JSON_ARRAY',
  // Conditional
  'COALESCE', 'NULLIF', 'GREATEST', 'LEAST',
  // Type casting
  'CAST', 'TO_CHAR', 'TO_DATE', 'TO_TIMESTAMP', 'TO_NUMBER',
  // Window functions
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
  // Array
  'ARRAY_LENGTH', 'ARRAY_CAT', 'ARRAY_APPEND', 'ARRAY_PREPEND', 'UNNEST',
];

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

// ============================================
// SQL Completion Provider
// ============================================

export class SQLCompletionProvider {
  private caches = new Map<string, SchemaCache>();
  private databaseService: DatabaseService;

  constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService;
  }

  /**
   * Get completions for the current cursor position.
   */
  async getCompletions(
    connectionId: string,
    sql: string,
    cursorLine: number,
    cursorColumn: number
  ): Promise<SQLCompletionItem[]> {
    const completions: SQLCompletionItem[] = [];

    // Analyze context
    const context = this.analyzeContext(sql, cursorLine, cursorColumn);
    debugLog(`[SQLCompletion] Context: ${JSON.stringify(context)}`);

    const prefix = context.prefix.toLowerCase();

    // Always include matching keywords
    if (context.type === 'keyword' || context.type === 'unknown') {
      const keywordCompletions = this.getKeywordCompletions(prefix);
      completions.push(...keywordCompletions);

      // Add built-in function completions
      const functionCompletions = this.getBuiltinFunctionCompletions(prefix);
      completions.push(...functionCompletions);
    }

    // If we have a connection, add database-aware completions
    if (connectionId) {
      try {
        const cache = await this.ensureCache(connectionId);

        if (context.type === 'schema' || context.type === 'unknown') {
          const schemaCompletions = this.getSchemaCompletions(cache, prefix);
          completions.push(...schemaCompletions);
        }

        if (context.type === 'table' || context.type === 'unknown') {
          const tableCompletions = await this.getTableCompletions(
            cache,
            connectionId,
            context.schema || 'public',
            prefix
          );
          completions.push(...tableCompletions);
        }

        if (context.type === 'column' && context.table) {
          const columnCompletions = await this.getColumnCompletions(
            cache,
            connectionId,
            context.schema || 'public',
            context.table,
            prefix
          );
          completions.push(...columnCompletions);
        }

        if (context.type === 'function' || context.type === 'unknown') {
          const dbFunctionCompletions = await this.getDatabaseFunctionCompletions(
            cache,
            connectionId,
            context.schema || 'public',
            prefix
          );
          completions.push(...dbFunctionCompletions);
        }
      } catch (error) {
        debugLog(`[SQLCompletion] Error getting database completions: ${error}`);
      }
    }

    // Sort by relevance
    completions.sort((a, b) => {
      const sortA = a.sortText || a.label;
      const sortB = b.sortText || b.label;
      return sortA.localeCompare(sortB);
    });

    return completions;
  }

  /**
   * Invalidate cache for a connection.
   */
  invalidateCache(connectionId: string): void {
    this.caches.delete(connectionId);
  }

  /**
   * Clear all caches.
   */
  clearAllCaches(): void {
    this.caches.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Context Analysis
  // ─────────────────────────────────────────────────────────────────────────

  private analyzeContext(sql: string, cursorLine: number, cursorColumn: number): SQLContext {
    const lines = sql.split('\n');
    const currentLine = lines[cursorLine] || '';
    const textBeforeCursor = currentLine.slice(0, cursorColumn);

    // Extract the current word/prefix being typed
    const prefixMatch = textBeforeCursor.match(/[\w_]+$/);
    const prefix = prefixMatch ? prefixMatch[0] : '';

    // Check for schema.table.column pattern
    const dotPattern = textBeforeCursor.match(/(\w+)\.(\w+)\.(\w*)$/);
    if (dotPattern) {
      return {
        type: 'column',
        schema: dotPattern[1],
        table: dotPattern[2],
        prefix: dotPattern[3] || '',
      };
    }

    // Check for schema.table or table.column pattern
    const singleDotPattern = textBeforeCursor.match(/(\w+)\.(\w*)$/);
    if (singleDotPattern) {
      const beforeDot = singleDotPattern[1]!.toLowerCase();
      const afterDot = singleDotPattern[2] || '';

      // Determine if it's schema.table or table.column
      // Heuristic: if we're after FROM/JOIN, it's likely schema.table
      // Otherwise, it could be table.column or alias.column
      const beforeKeywords = textBeforeCursor.slice(0, textBeforeCursor.lastIndexOf(beforeDot));
      const lastKeyword = this.getLastKeyword(beforeKeywords);

      if (lastKeyword === 'from' || lastKeyword === 'join' || lastKeyword === 'into' || lastKeyword === 'update') {
        return {
          type: 'table',
          schema: beforeDot,
          prefix: afterDot,
        };
      } else {
        // Assume it's table.column
        return {
          type: 'column',
          table: beforeDot,
          prefix: afterDot,
        };
      }
    }

    // Analyze based on preceding keyword
    const lastKeyword = this.getLastKeyword(textBeforeCursor);

    switch (lastKeyword) {
      case 'from':
      case 'join':
      case 'into':
      case 'update':
      case 'table':
        return { type: 'table', prefix };

      case 'select':
      case 'where':
      case 'and':
      case 'or':
      case 'on':
      case 'set':
      case 'values':
      case 'order':
      case 'group':
      case 'having':
        // Could be column, table, or expression - show all
        return { type: 'unknown', prefix };

      case 'schema':
        return { type: 'schema', prefix };

      default:
        return { type: 'unknown', prefix };
    }
  }

  private getLastKeyword(text: string): string {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);

    // Look backwards for a SQL keyword
    for (let i = words.length - 1; i >= 0; i--) {
      const word = words[i];
      if (word && SQL_KEYWORDS.map(k => k.toLowerCase()).includes(word)) {
        return word;
      }
    }

    return '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Completion Generators
  // ─────────────────────────────────────────────────────────────────────────

  private getKeywordCompletions(prefix: string): SQLCompletionItem[] {
    return SQL_KEYWORDS
      .filter(kw => kw.toLowerCase().startsWith(prefix))
      .map(kw => ({
        label: kw,
        kind: SQLCompletionKind.Keyword,
        insertText: kw,
        detail: 'SQL keyword',
        sortText: `2_${kw}`, // Keywords sort after tables
      }));
  }

  private getBuiltinFunctionCompletions(prefix: string): SQLCompletionItem[] {
    return SQL_FUNCTIONS
      .filter(fn => fn.toLowerCase().startsWith(prefix))
      .map(fn => ({
        label: fn,
        kind: SQLCompletionKind.Function,
        insertText: `${fn}()`,
        detail: 'SQL function',
        sortText: `3_${fn}`, // Functions sort after keywords
      }));
  }

  private getSchemaCompletions(cache: SchemaCache, prefix: string): SQLCompletionItem[] {
    return cache.schemas
      .filter(s => s.name.toLowerCase().startsWith(prefix) && !s.isSystem)
      .map(s => ({
        label: s.name,
        kind: SQLCompletionKind.Schema,
        insertText: s.name,
        detail: 'schema',
        sortText: `1_${s.name}`,
      }));
  }

  private async getTableCompletions(
    cache: SchemaCache,
    connectionId: string,
    schema: string,
    prefix: string
  ): Promise<SQLCompletionItem[]> {
    // Ensure tables are cached for this schema
    if (!cache.tables.has(schema)) {
      try {
        const tables = await this.databaseService.listTables(connectionId, schema);
        cache.tables.set(schema, tables);
      } catch (error) {
        debugLog(`[SQLCompletion] Failed to load tables for ${schema}: ${error}`);
        return [];
      }
    }

    const tables = cache.tables.get(schema) || [];
    return tables
      .filter(t => t.name.toLowerCase().startsWith(prefix))
      .map(t => ({
        label: t.name,
        kind: t.type === 'view' || t.type === 'materialized_view'
          ? SQLCompletionKind.View
          : SQLCompletionKind.Table,
        insertText: t.name,
        detail: t.type === 'table' ? 'table' : t.type,
        documentation: t.comment,
        sortText: `0_${t.name}`, // Tables sort first
      }));
  }

  private async getColumnCompletions(
    cache: SchemaCache,
    connectionId: string,
    schema: string,
    table: string,
    prefix: string
  ): Promise<SQLCompletionItem[]> {
    const key = `${schema}.${table}`;

    // Ensure columns are cached for this table
    if (!cache.columns.has(key)) {
      try {
        const details = await this.databaseService.describeTable(connectionId, schema, table);
        cache.columns.set(key, details.columns);
      } catch (error) {
        debugLog(`[SQLCompletion] Failed to load columns for ${key}: ${error}`);
        return [];
      }
    }

    const columns = cache.columns.get(key) || [];
    return columns
      .filter(c => c.name.toLowerCase().startsWith(prefix))
      .map(c => ({
        label: c.name,
        kind: SQLCompletionKind.Column,
        insertText: c.name,
        detail: c.dataType + (c.isPrimaryKey ? ' (PK)' : '') + (c.isForeignKey ? ' (FK)' : ''),
        documentation: c.nullable ? 'nullable' : 'not null',
        sortText: `0_${c.isPrimaryKey ? '0' : '1'}_${c.name}`, // PKs first
      }));
  }

  private async getDatabaseFunctionCompletions(
    cache: SchemaCache,
    connectionId: string,
    schema: string,
    prefix: string
  ): Promise<SQLCompletionItem[]> {
    // Ensure functions are cached for this schema
    if (!cache.functions.has(schema)) {
      try {
        const functions = await this.databaseService.listFunctions(connectionId, schema);
        cache.functions.set(schema, functions);
      } catch (error) {
        debugLog(`[SQLCompletion] Failed to load functions for ${schema}: ${error}`);
        return [];
      }
    }

    const functions = cache.functions.get(schema) || [];
    return functions
      .filter(f => f.name.toLowerCase().startsWith(prefix))
      .map(f => ({
        label: f.name,
        kind: SQLCompletionKind.Function,
        insertText: `${f.name}()`,
        detail: `function(${f.arguments}) -> ${f.returnType}`,
        documentation: f.comment,
        sortText: `4_${f.name}`,
      }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cache Management
  // ─────────────────────────────────────────────────────────────────────────

  private async ensureCache(connectionId: string): Promise<SchemaCache> {
    const existing = this.caches.get(connectionId);

    // Check if cache is still valid
    if (existing && Date.now() - existing.cachedAt.getTime() < CACHE_TTL) {
      return existing;
    }

    // Build new cache
    debugLog(`[SQLCompletion] Building cache for connection ${connectionId}`);

    const schemas = await this.databaseService.listSchemas(connectionId, false);

    const cache: SchemaCache = {
      connectionId,
      cachedAt: new Date(),
      schemas,
      tables: new Map(),
      columns: new Map(),
      functions: new Map(),
    };

    this.caches.set(connectionId, cache);
    return cache;
  }
}

// Singleton instance - created when database service is available
let completionProvider: SQLCompletionProvider | null = null;

export function getSQLCompletionProvider(databaseService: DatabaseService): SQLCompletionProvider {
  if (!completionProvider) {
    completionProvider = new SQLCompletionProvider(databaseService);
  }
  return completionProvider;
}

export function clearSQLCompletionProvider(): void {
  if (completionProvider) {
    completionProvider.clearAllCaches();
  }
  completionProvider = null;
}
