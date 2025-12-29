/**
 * SQL Parsing Utilities
 *
 * Utility functions for parsing SQL queries.
 */

export interface ParsedTableInfo {
  schema: string;
  tableName: string;
}

/**
 * Parse schema and table name from a SQL query.
 * Returns { schema, tableName } where schema defaults to 'public' if not specified.
 *
 * Handles various SQL formats:
 * - SELECT * FROM table_name
 * - SELECT * FROM schema.table_name
 * - SELECT * FROM "schema"."table_name"
 * - SELECT * FROM "table_name"
 */
export function parseTableInfoFromSql(sql: string): ParsedTableInfo {
  const normalized = sql.replace(/\s+/g, ' ').trim();

  // First, try to match quoted identifiers with potential schema: "schema"."table" or "table"
  // This handles spaces in identifiers properly
  const quotedMatch = normalized.match(/from\s+("(?:[^"]+)"(?:\."(?:[^"]+)")?)/i);
  if (quotedMatch) {
    return parseTableReference(quotedMatch[1]!);
  }

  // Match FROM followed by table reference (unquoted)
  const fromMatch = normalized.match(/from\s+(.+?)(?:\s+(?:where|order|group|having|limit|join|left|right|inner|outer|cross|on|and|or|;|\)|$))/i);
  if (!fromMatch) {
    // Try simpler match for queries ending with table name
    const simpleMatch = normalized.match(/from\s+([^\s,;()]+)/i);
    if (simpleMatch) {
      return parseTableReference(simpleMatch[1]!);
    }
    return { schema: 'public', tableName: 'Query Results' };
  }

  const tableRef = fromMatch[1]!.trim();
  return parseTableReference(tableRef);
}

/**
 * Parse a table reference which may be:
 * - table_name
 * - schema.table_name
 * - "table_name"
 * - "schema"."table_name"
 */
function parseTableReference(ref: string): ParsedTableInfo {
  // Handle "schema"."table" format
  const quotedBothMatch = ref.match(/^"([^"]+)"\."([^"]+)"$/);
  if (quotedBothMatch) {
    return { schema: quotedBothMatch[1]!, tableName: quotedBothMatch[2]! };
  }

  // Handle "table" format (just quoted table, no schema)
  const quotedTableMatch = ref.match(/^"([^"]+)"$/);
  if (quotedTableMatch) {
    return { schema: 'public', tableName: quotedTableMatch[1]! };
  }

  // Handle schema.table or just table (unquoted)
  const parts = ref.replace(/"/g, '').split('.');
  if (parts.length >= 2) {
    return { schema: parts[0]!, tableName: parts[parts.length - 1]! };
  }

  return { schema: 'public', tableName: parts[0]! };
}
