/**
 * Cross-Service Workflow Integration Tests
 *
 * Tests end-to-end workflows that span multiple ECP services.
 * These tests verify that services work correctly together.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestECPClient } from '../helpers/ecp-client.ts';
import { createTempWorkspace, type TempWorkspace } from '../helpers/temp-workspace.ts';
import type { GitStatus } from '../../src/services/git/types.ts';

describe('Cross-Service Workflows', () => {
  let client: TestECPClient;
  let workspace: TempWorkspace;

  beforeEach(async () => {
    client = new TestECPClient();
    workspace = await createTempWorkspace();
  });

  afterEach(async () => {
    await client.shutdown();
    await workspace.cleanup();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Document + File Workflows
  // ───────────────────────────────────────────────────────────────────────

  describe('document + file workflows', () => {
    test('open file from disk, edit, save back to disk', async () => {
      // Create initial file on disk
      await workspace.writeFile('test.txt', 'Hello World');

      // Open document from file
      const { documentId } = await client.request<{ documentId: string }>('document/open', {
        uri: workspace.fileUri('test.txt'),
      });

      // Verify content loaded correctly
      let content = await client.request<{ content: string }>('document/content', { documentId });
      expect(content.content).toBe('Hello World');

      // Edit the document
      await client.request('document/insert', {
        documentId,
        position: { line: 0, column: 11 },
        text: '!!!',
      });

      // Verify document is dirty
      const dirty = await client.request<{ isDirty: boolean }>('document/isDirty', { documentId });
      expect(dirty.isDirty).toBe(true);

      // Get modified content
      content = await client.request<{ content: string }>('document/content', { documentId });
      expect(content.content).toBe('Hello World!!!');

      // Save to disk using file/write
      await client.request('file/write', {
        uri: workspace.fileUri('test.txt'),
        content: content.content,
      });

      // Mark document clean
      await client.request('document/markClean', { documentId });

      // Verify no longer dirty
      const cleanCheck = await client.request<{ isDirty: boolean }>('document/isDirty', { documentId });
      expect(cleanCheck.isDirty).toBe(false);

      // Verify file on disk was updated
      const diskContent = await workspace.readFile('test.txt');
      expect(diskContent).toBe('Hello World!!!');
    });

    test('create new file via document and save', async () => {
      // Create document with content (in memory)
      const { documentId } = await client.request<{ documentId: string }>('document/open', {
        uri: workspace.fileUri('new-file.ts'),
        content: 'const x = 42;',
      });

      // Write to disk
      const content = await client.request<{ content: string }>('document/content', { documentId });
      await client.request('file/write', {
        uri: workspace.fileUri('new-file.ts'),
        content: content.content,
      });

      // Verify file exists on disk
      const exists = await workspace.fileExists('new-file.ts');
      expect(exists).toBe(true);

      // Verify content
      const diskContent = await workspace.readFile('new-file.ts');
      expect(diskContent).toBe('const x = 42;');
    });

    test('edit in memory, undo, verify undo works', async () => {
      // Create document in memory
      const { documentId } = await client.request<{ documentId: string }>('document/open', {
        uri: 'memory://test.txt',
        content: 'Hello',
      });

      // Make edits via insert (proven to work with undo)
      await client.request('document/insert', {
        documentId,
        position: { line: 0, column: 5 },
        text: ' World',
      });

      let content = await client.request<{ content: string }>('document/content', { documentId });
      expect(content.content).toBe('Hello World');

      // Undo
      await client.request('document/undo', { documentId });

      content = await client.request<{ content: string }>('document/content', { documentId });
      expect(content.content).toBe('Hello');
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Document + Git Workflows
  // ───────────────────────────────────────────────────────────────────────

  describe('document + git workflows', () => {
    beforeEach(async () => {
      // Initialize git repo
      await workspace.gitInit();

      // Create and commit initial file
      await workspace.writeFile('tracked.txt', 'Initial content');
      await workspace.gitAdd(['tracked.txt']);
      await workspace.gitCommit('Initial commit');
    });

    test('edit tracked file, verify git status, stage and commit', async () => {
      // Open the tracked file
      const { documentId } = await client.request<{ documentId: string }>('document/open', {
        uri: workspace.fileUri('tracked.txt'),
      });

      // Edit the document
      await client.request('document/replace', {
        documentId,
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 7 } },
        text: 'Modified',
      });

      // Save to disk
      const content = await client.request<{ content: string }>('document/content', { documentId });
      await client.request('file/write', {
        uri: workspace.fileUri('tracked.txt'),
        content: content.content,
      });

      // Check git status - should show modified in unstaged
      const status = await client.request<GitStatus>('git/status', {
        uri: workspace.path,
        forceRefresh: true,
      });
      expect(status.unstaged.some((f) => f.path === 'tracked.txt')).toBe(true);

      // Stage the file
      await client.request('git/stage', {
        uri: workspace.path,
        paths: ['tracked.txt'],
      });

      // Commit
      const commitResult = await client.request<{ success: boolean }>('git/commit', {
        uri: workspace.path,
        message: 'Modified tracked file',
      });
      expect(commitResult.success).toBe(true);

      // Verify clean status
      const cleanStatus = await client.request<GitStatus>('git/status', {
        uri: workspace.path,
        forceRefresh: true,
      });
      expect(cleanStatus.unstaged).toHaveLength(0);
      expect(cleanStatus.staged).toHaveLength(0);
    });

    test('create new file, add to git, commit', async () => {
      // Create new file via document
      const { documentId } = await client.request<{ documentId: string }>('document/open', {
        uri: workspace.fileUri('new-feature.ts'),
        content: 'export function newFeature() {\n  return true;\n}\n',
      });

      // Save to disk
      const content = await client.request<{ content: string }>('document/content', { documentId });
      await client.request('file/write', {
        uri: workspace.fileUri('new-feature.ts'),
        content: content.content,
      });

      // Check git status - should show untracked
      const status = await client.request<GitStatus>('git/status', {
        uri: workspace.path,
        forceRefresh: true,
      });
      expect(status.untracked).toContain('new-feature.ts');

      // Stage and commit
      await client.request('git/stage', {
        uri: workspace.path,
        paths: ['new-feature.ts'],
      });

      await client.request('git/commit', {
        uri: workspace.path,
        message: 'Add new feature',
      });

      // Verify in log
      const log = await client.request<{ commits: Array<{ message: string }> }>('git/log', {
        uri: workspace.path,
        maxCount: 1,
      });
      expect(log.commits[0]?.message).toContain('Add new feature');
    });

    test('edit file, discard changes via git', async () => {
      // Open tracked file
      const { documentId } = await client.request<{ documentId: string }>('document/open', {
        uri: workspace.fileUri('tracked.txt'),
      });

      // Verify original content
      let content = await client.request<{ content: string }>('document/content', { documentId });
      expect(content.content).toBe('Initial content');

      // Edit and save to disk
      await client.request('document/setContent', {
        documentId,
        content: 'Unwanted changes',
      });
      content = await client.request<{ content: string }>('document/content', { documentId });
      await client.request('file/write', {
        uri: workspace.fileUri('tracked.txt'),
        content: content.content,
      });

      // Discard via git
      await client.request('git/discard', {
        uri: workspace.path,
        paths: ['tracked.txt'],
      });

      // Reload file content from disk
      const diskContent = await workspace.readFile('tracked.txt');
      expect(diskContent).toBe('Initial content');
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Session + Document Workflows
  // ───────────────────────────────────────────────────────────────────────

  describe('session + document workflows', () => {
    test('open documents and verify list', async () => {
      // Open multiple documents
      const doc1 = await client.request<{ documentId: string }>('document/open', {
        uri: 'memory://file1.txt',
        content: 'File 1 content',
      });

      const doc2 = await client.request<{ documentId: string }>('document/open', {
        uri: 'memory://file2.txt',
        content: 'File 2 content',
      });

      // Edit one document
      await client.request('document/insert', {
        documentId: doc1.documentId,
        position: { line: 0, column: 14 },
        text: ' - edited',
      });

      // Get list of open documents
      const docs = await client.request<{ documents: Array<{ uri: string }> }>('document/list', {});
      expect(docs.documents.length).toBeGreaterThanOrEqual(2);
      expect(docs.documents.map((d) => d.uri)).toContain('memory://file1.txt');
      expect(docs.documents.map((d) => d.uri)).toContain('memory://file2.txt');

      // Verify content was edited
      const content = await client.request<{ content: string }>('document/content', {
        documentId: doc1.documentId,
      });
      expect(content.content).toBe('File 1 content - edited');

      // Close documents
      await client.request('document/close', { documentId: doc1.documentId });
      await client.request('document/close', { documentId: doc2.documentId });

      // Verify closed
      const emptyDocs = await client.request<{ documents: Array<{ uri: string }> }>(
        'document/list',
        {}
      );
      const remainingUris = emptyDocs.documents.map((d) => d.uri);
      expect(remainingUris).not.toContain('memory://file1.txt');
      expect(remainingUris).not.toContain('memory://file2.txt');
    });

    test('settings can be changed and retrieved', async () => {
      // Set a setting
      await client.request('config/set', {
        key: 'editor.tabSize',
        value: 4,
      });

      // Verify setting
      const tabSize = await client.request<{ value: number }>('config/get', {
        key: 'editor.tabSize',
      });
      expect(tabSize.value).toBe(4);

      // Reset for other tests
      await client.request('config/reset', {
        key: 'editor.tabSize',
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // File + Git Workflows
  // ───────────────────────────────────────────────────────────────────────

  describe('file + git workflows', () => {
    beforeEach(async () => {
      await workspace.gitInit();
      await workspace.writeFile('README.md', '# Project\n');
      await workspace.gitAdd(['README.md']);
      await workspace.gitCommit('Initial commit');
    });

    test('create files, stage selectively, commit', async () => {
      // Create multiple files
      await client.request('file/write', {
        uri: workspace.fileUri('feature-a.ts'),
        content: 'export const a = 1;',
      });
      await client.request('file/write', {
        uri: workspace.fileUri('feature-b.ts'),
        content: 'export const b = 2;',
      });
      await client.request('file/write', {
        uri: workspace.fileUri('temp.log'),
        content: 'debug output',
      });

      // Stage only TypeScript files
      await client.request('git/stage', {
        uri: workspace.path,
        paths: ['feature-a.ts', 'feature-b.ts'],
      });

      // Check status - temp.log should still be untracked
      const status = await client.request<GitStatus>('git/status', {
        uri: workspace.path,
        forceRefresh: true,
      });

      expect(status.staged.some((f) => f.path === 'feature-a.ts')).toBe(true);
      expect(status.staged.some((f) => f.path === 'feature-b.ts')).toBe(true);
      expect(status.untracked).toContain('temp.log');

      // Commit
      await client.request('git/commit', {
        uri: workspace.path,
        message: 'Add features A and B',
      });

      // temp.log should still be untracked
      const finalStatus = await client.request<GitStatus>('git/status', {
        uri: workspace.path,
        forceRefresh: true,
      });
      expect(finalStatus.untracked).toContain('temp.log');
    });

    test('delete file and commit removal', async () => {
      // Create and commit a file
      await client.request('file/write', {
        uri: workspace.fileUri('to-delete.txt'),
        content: 'Will be deleted',
      });
      await workspace.gitAdd(['to-delete.txt']);
      await workspace.gitCommit('Add file to delete');

      // Delete the file
      await client.request('file/delete', {
        uri: workspace.fileUri('to-delete.txt'),
      });

      // Check status - should show deleted in unstaged
      const status = await client.request<GitStatus>('git/status', {
        uri: workspace.path,
        forceRefresh: true,
      });
      expect(status.unstaged.some((f) => f.path === 'to-delete.txt')).toBe(true);

      // Stage deletion and commit
      await client.request('git/stage', {
        uri: workspace.path,
        paths: ['to-delete.txt'],
      });

      await client.request('git/commit', {
        uri: workspace.path,
        message: 'Remove deleted file',
      });

      // Verify clean
      const finalStatus = await client.request<GitStatus>('git/status', {
        uri: workspace.path,
        forceRefresh: true,
      });
      expect(finalStatus.unstaged).toHaveLength(0);
    });
  });
});
