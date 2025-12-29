/**
 * SQL Utilities Unit Tests
 *
 * Tests for SQL parsing utilities.
 */

import { describe, test, expect } from 'bun:test';
import { parseTableInfoFromSql } from '../../../../src/services/database/sql-utils.ts';

describe('parseTableInfoFromSql', () => {
  describe('simple table names', () => {
    test('parses simple FROM clause', () => {
      const result = parseTableInfoFromSql('SELECT * FROM users');
      expect(result).toEqual({ schema: 'public', tableName: 'users' });
    });

    test('parses lowercase query', () => {
      const result = parseTableInfoFromSql('select * from products');
      expect(result).toEqual({ schema: 'public', tableName: 'products' });
    });

    test('parses mixed case query', () => {
      const result = parseTableInfoFromSql('SELECT id, name FROM Orders');
      expect(result).toEqual({ schema: 'public', tableName: 'Orders' });
    });
  });

  describe('schema-qualified table names', () => {
    test('parses schema.table format', () => {
      const result = parseTableInfoFromSql('SELECT * FROM myschema.users');
      expect(result).toEqual({ schema: 'myschema', tableName: 'users' });
    });

    test('parses public schema explicitly', () => {
      const result = parseTableInfoFromSql('SELECT * FROM public.orders');
      expect(result).toEqual({ schema: 'public', tableName: 'orders' });
    });
  });

  describe('quoted identifiers', () => {
    test('parses double-quoted table name', () => {
      const result = parseTableInfoFromSql('SELECT * FROM "Users"');
      expect(result).toEqual({ schema: 'public', tableName: 'Users' });
    });

    test('parses quoted schema.table format', () => {
      const result = parseTableInfoFromSql('SELECT * FROM "my_schema"."my_table"');
      expect(result).toEqual({ schema: 'my_schema', tableName: 'my_table' });
    });

    test('parses schema and table with spaces in name', () => {
      const result = parseTableInfoFromSql('SELECT * FROM "Schema Name"."Table Name"');
      expect(result).toEqual({ schema: 'Schema Name', tableName: 'Table Name' });
    });
  });

  describe('complex queries', () => {
    test('parses query with WHERE clause', () => {
      const result = parseTableInfoFromSql('SELECT * FROM customers WHERE id = 1');
      expect(result).toEqual({ schema: 'public', tableName: 'customers' });
    });

    test('parses query with JOIN', () => {
      const result = parseTableInfoFromSql('SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id');
      expect(result).toEqual({ schema: 'public', tableName: 'orders' });
    });

    test('parses query with subquery', () => {
      const result = parseTableInfoFromSql('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)');
      expect(result).toEqual({ schema: 'public', tableName: 'users' });
    });

    test('parses query with column list', () => {
      const result = parseTableInfoFromSql('SELECT id, name, email FROM users');
      expect(result).toEqual({ schema: 'public', tableName: 'users' });
    });

    test('parses query with LIMIT', () => {
      const result = parseTableInfoFromSql('SELECT * FROM products LIMIT 10');
      expect(result).toEqual({ schema: 'public', tableName: 'products' });
    });
  });

  describe('whitespace handling', () => {
    test('handles extra whitespace', () => {
      const result = parseTableInfoFromSql('SELECT  *   FROM    users');
      expect(result).toEqual({ schema: 'public', tableName: 'users' });
    });

    test('handles newlines', () => {
      const result = parseTableInfoFromSql('SELECT *\nFROM\n  users\nWHERE id = 1');
      expect(result).toEqual({ schema: 'public', tableName: 'users' });
    });

    test('handles tabs', () => {
      const result = parseTableInfoFromSql('SELECT *\tFROM\tusers');
      expect(result).toEqual({ schema: 'public', tableName: 'users' });
    });
  });

  describe('edge cases', () => {
    test('returns default for INSERT statement', () => {
      const result = parseTableInfoFromSql('INSERT INTO users (name) VALUES (\'John\')');
      expect(result).toEqual({ schema: 'public', tableName: 'Query Results' });
    });

    test('returns default for UPDATE statement', () => {
      const result = parseTableInfoFromSql('UPDATE users SET name = \'Jane\' WHERE id = 1');
      expect(result).toEqual({ schema: 'public', tableName: 'Query Results' });
    });

    test('returns default for empty query', () => {
      const result = parseTableInfoFromSql('');
      expect(result).toEqual({ schema: 'public', tableName: 'Query Results' });
    });

    test('returns default for query without FROM', () => {
      const result = parseTableInfoFromSql('SELECT 1 + 1');
      expect(result).toEqual({ schema: 'public', tableName: 'Query Results' });
    });

    test('returns default for CTE query (no main FROM)', () => {
      const result = parseTableInfoFromSql('WITH cte AS (SELECT 1) SELECT * FROM cte');
      expect(result).toEqual({ schema: 'public', tableName: 'cte' });
    });
  });

  describe('three-part names', () => {
    test('parses catalog.schema.table format', () => {
      const result = parseTableInfoFromSql('SELECT * FROM db.schema.table');
      expect(result).toEqual({ schema: 'db', tableName: 'table' });
    });
  });
});
