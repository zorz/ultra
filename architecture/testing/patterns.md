# Test Patterns

Common testing patterns for Ultra's ECP architecture.

## Unit Testing Patterns

Unit tests verify individual service methods in isolation.

### Pattern: Direct Service Testing

```typescript
import { describe, test, expect } from 'bun:test';
import { Buffer } from '@/services/document/buffer.ts';

describe('Buffer', () => {
  describe('insert', () => {
    test('inserts text at beginning', () => {
      const buffer = new Buffer('world');
      buffer.insertAt({ line: 0, column: 0 }, 'hello ');
      expect(buffer.getContent()).toBe('hello world');
    });

    test('inserts text at end', () => {
      const buffer = new Buffer('hello');
      buffer.insertAt({ line: 0, column: 5 }, ' world');
      expect(buffer.getContent()).toBe('hello world');
    });

    test('inserts multiline text', () => {
      const buffer = new Buffer('ac');
      buffer.insertAt({ line: 0, column: 1 }, '\nb\n');
      expect(buffer.getContent()).toBe('a\nb\nc');
      expect(buffer.lineCount).toBe(3);
    });

    test('increments version', () => {
      const buffer = new Buffer('hello');
      const v1 = buffer.version;
      buffer.insertAt({ line: 0, column: 0 }, 'x');
      expect(buffer.version).toBe(v1 + 1);
    });
  });
});
```

### Pattern: Testing with Fixtures

```typescript
import { describe, test, expect } from 'bun:test';
import { loadFixture } from '@test/fixtures.ts';
import { Highlighter } from '@/services/syntax/highlighter.ts';

describe('Syntax Highlighter', () => {
  const highlighter = new Highlighter();

  test('highlights TypeScript', async () => {
    await highlighter.waitForReady();
    const content = await loadFixture('documents/typescript/simple.ts');

    await highlighter.setLanguage('typescript');
    highlighter.parse(content);

    const tokens = highlighter.highlightLine(0);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0]).toHaveProperty('color');
  });
});
```

### Pattern: Testing Error Cases

```typescript
import { describe, test, expect } from 'bun:test';
import { Buffer } from '@/services/document/buffer.ts';

describe('Buffer error handling', () => {
  test('throws on invalid position', () => {
    const buffer = new Buffer('hello');

    expect(() => {
      buffer.insertAt({ line: 10, column: 0 }, 'x');
    }).toThrow('Invalid line');

    expect(() => {
      buffer.insertAt({ line: 0, column: 100 }, 'x');
    }).toThrow('Invalid column');
  });

  test('throws on negative position', () => {
    const buffer = new Buffer('hello');

    expect(() => {
      buffer.insertAt({ line: -1, column: 0 }, 'x');
    }).toThrow();
  });
});
```

### Pattern: Testing Undo/Redo

```typescript
import { describe, test, expect } from 'bun:test';
import { LocalDocumentService } from '@/services/document/local.ts';

describe('Undo/Redo', () => {
  test('undo reverses insert', () => {
    const service = new LocalDocumentService();
    const doc = service.createDocument('hello');

    service.insert(doc.id, { line: 0, column: 5 }, ' world');
    expect(service.getContent(doc.id)).toBe('hello world');

    service.undo(doc.id);
    expect(service.getContent(doc.id)).toBe('hello');
  });

  test('redo restores undone change', () => {
    const service = new LocalDocumentService();
    const doc = service.createDocument('hello');

    service.insert(doc.id, { line: 0, column: 5 }, ' world');
    service.undo(doc.id);
    service.redo(doc.id);

    expect(service.getContent(doc.id)).toBe('hello world');
  });

  test('new edit clears redo stack', () => {
    const service = new LocalDocumentService();
    const doc = service.createDocument('hello');

    service.insert(doc.id, { line: 0, column: 5 }, ' world');
    service.undo(doc.id);
    service.insert(doc.id, { line: 0, column: 5 }, '!');

    expect(service.canRedo(doc.id)).toBe(false);
  });
});
```

---

## Integration Testing Patterns

Integration tests verify ECP request/response behavior.

### Pattern: Request/Response Testing

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestECPClient } from '@test/ecp-client.ts';

describe('document/* methods', () => {
  let client: TestECPClient;

  beforeEach(() => {
    client = new TestECPClient();
  });

  afterEach(async () => {
    await client.shutdown();
  });

  test('document/open creates document', async () => {
    const result = await client.request('document/open', {
      uri: 'memory://test.txt',
      content: 'hello'
    });

    expect(result).toMatchObject({
      documentId: expect.any(String),
      version: 1,
      languageId: 'plaintext'
    });
  });

  test('document/insert modifies content', async () => {
    const { documentId } = await client.request('document/open', {
      uri: 'memory://test.txt',
      content: 'hello'
    });

    const result = await client.request('document/insert', {
      documentId,
      position: { line: 0, column: 5 },
      text: ' world'
    });

    expect(result).toMatchObject({
      success: true,
      version: 2
    });

    const { content } = await client.request('document/content', { documentId });
    expect(content).toBe('hello world');
  });
});
```

### Pattern: Error Response Testing

```typescript
describe('Error responses', () => {
  test('returns DOCUMENT_NOT_FOUND for missing document', async () => {
    const response = await client.requestRaw('document/content', {
      documentId: 'nonexistent-id'
    });

    expect(response.error).toMatchObject({
      code: -32001,
      message: expect.stringContaining('not found')
    });
  });

  test('returns INVALID_PARAMS for missing required params', async () => {
    const response = await client.requestRaw('document/insert', {
      documentId: 'some-id'
      // Missing position and text
    });

    expect(response.error).toMatchObject({
      code: -32602,
      message: expect.stringContaining('position')
    });
  });

  test('returns METHOD_NOT_FOUND for unknown method', async () => {
    const response = await client.requestRaw('unknown/method', {});

    expect(response.error).toMatchObject({
      code: -32601
    });
  });
});
```

### Pattern: Notification Testing

```typescript
describe('Notifications', () => {
  test('document/didChange emitted on edit', async () => {
    const { documentId } = await client.request('document/open', {
      uri: 'memory://test.txt',
      content: 'hello'
    });

    client.clearNotifications();

    await client.request('document/insert', {
      documentId,
      position: { line: 0, column: 5 },
      text: '!'
    });

    const notifications = client.getNotifications('document/didChange');
    expect(notifications).toHaveLength(1);
    expect(notifications[0].params).toMatchObject({
      documentId,
      version: 2,
      changes: expect.any(Array)
    });
  });

  test('cursor/didChange emitted on cursor move', async () => {
    const { documentId } = await client.request('document/open', {
      uri: 'memory://test.txt',
      content: 'hello\nworld'
    });

    client.clearNotifications();

    await client.request('cursor/move', {
      documentId,
      direction: 'down',
      selecting: false
    });

    const notifications = client.getNotifications('cursor/didChange');
    expect(notifications).toHaveLength(1);
    expect(notifications[0].params).toMatchObject({
      documentId,
      cursors: [{ position: { line: 1, column: 0 } }]
    });
  });
});
```

### Pattern: LSP Integration (Real Servers)

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { TestECPClient } from '@test/ecp-client.ts';
import { createTempWorkspace } from '@test/temp-workspace.ts';

describe('LSP integration', () => {
  let client: TestECPClient;
  let workspace: TempWorkspace;

  beforeAll(async () => {
    workspace = await createTempWorkspace();
    await workspace.writeFile('test.ts', `
      function greet(name: string): string {
        return 'Hello, ' + name;
      }
    `);

    client = new TestECPClient({
      workspaceRoot: workspace.path
    });

    // Wait for LSP to initialize
    await client.request('document/open', {
      uri: workspace.fileUri('test.ts')
    });

    // Give LSP time to analyze
    await new Promise(resolve => setTimeout(resolve, 2000));
  }, 30000); // Longer timeout for LSP startup

  afterAll(async () => {
    await client.shutdown();
    await workspace.cleanup();
  });

  test('provides completions', async () => {
    const result = await client.request('lsp/completion', {
      uri: workspace.fileUri('test.ts'),
      position: { line: 2, column: 18 } // After 'name.'
    });

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'length' }),
        expect.objectContaining({ label: 'charAt' })
      ])
    );
  });

  test('provides hover info', async () => {
    const result = await client.request('lsp/hover', {
      uri: workspace.fileUri('test.ts'),
      position: { line: 1, column: 11 } // On 'greet'
    });

    expect(result.contents).toContain('function greet');
    expect(result.contents).toContain('string');
  });
});
```

---

## End-to-End Testing Patterns

E2E tests verify complete workflows across multiple services.

### Pattern: Edit-Save-Git Workflow

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestECPClient } from '@test/ecp-client.ts';
import { createTempWorkspace } from '@test/temp-workspace.ts';

describe('Edit and commit workflow', () => {
  let client: TestECPClient;
  let workspace: TempWorkspace;

  beforeEach(async () => {
    workspace = await createTempWorkspace({ git: true });
    await workspace.writeFile('README.md', '# Hello\n');
    await workspace.gitAdd('README.md');
    await workspace.gitCommit('Initial commit');

    client = new TestECPClient({
      workspaceRoot: workspace.path
    });
  });

  afterEach(async () => {
    await client.shutdown();
    await workspace.cleanup();
  });

  test('edit, save, stage, commit', async () => {
    // Open file
    const { documentId } = await client.request('document/open', {
      uri: workspace.fileUri('README.md')
    });

    // Edit
    await client.request('document/insert', {
      documentId,
      position: { line: 1, column: 0 },
      text: '\nThis is a test.\n'
    });

    // Save
    await client.request('file/save', { documentId });

    // Verify git sees changes
    let status = await client.request('git/status', {
      uri: workspace.rootUri
    });
    expect(status.unstaged).toContainEqual(
      expect.objectContaining({ path: 'README.md', status: 'M' })
    );

    // Stage
    await client.request('git/stage', {
      uri: workspace.rootUri,
      paths: ['README.md']
    });

    status = await client.request('git/status', {
      uri: workspace.rootUri
    });
    expect(status.staged).toContainEqual(
      expect.objectContaining({ path: 'README.md' })
    );
    expect(status.unstaged).toHaveLength(0);

    // Commit
    const commitResult = await client.request('git/commit', {
      uri: workspace.rootUri,
      message: 'Update README'
    });
    expect(commitResult.success).toBe(true);

    // Verify clean
    status = await client.request('git/status', {
      uri: workspace.rootUri
    });
    expect(status.staged).toHaveLength(0);
    expect(status.unstaged).toHaveLength(0);
  });
});
```

### Pattern: Session Restore Workflow

```typescript
describe('Session restore workflow', () => {
  test('restores open documents and cursors', async () => {
    // Session 1: Open files and position cursors
    const client1 = new TestECPClient({
      workspaceRoot: workspace.path
    });

    await client1.request('document/open', {
      uri: workspace.fileUri('file1.ts')
    });
    await client1.request('document/open', {
      uri: workspace.fileUri('file2.ts')
    });
    await client1.request('cursor/set', {
      documentId: 'file1-id',
      cursors: [{ position: { line: 10, column: 5 } }]
    });

    const sessionId = await client1.request('session/save', {
      name: 'test-session'
    });

    await client1.shutdown();

    // Session 2: Restore
    const client2 = new TestECPClient({
      workspaceRoot: workspace.path
    });

    await client2.request('session/load', { sessionId });

    const documents = await client2.request('document/list', {});
    expect(documents).toHaveLength(2);

    const cursors = await client2.request('cursor/get', {
      documentId: 'file1-id'
    });
    expect(cursors.cursors[0].position).toEqual({ line: 10, column: 5 });

    await client2.shutdown();
  });
});
```

### Pattern: Multi-Cursor Editing Workflow

```typescript
describe('Multi-cursor editing', () => {
  test('add cursors and edit simultaneously', async () => {
    const { documentId } = await client.request('document/open', {
      uri: 'memory://test.txt',
      content: 'foo\nfoo\nfoo'
    });

    // Select all occurrences of 'foo'
    await client.request('selection/selectAll', {
      documentId,
      pattern: 'foo'
    });

    const cursors = await client.request('cursor/get', { documentId });
    expect(cursors.cursors).toHaveLength(3);

    // Type replacement
    await client.request('document/insert', {
      documentId,
      text: 'bar'
    });

    const { content } = await client.request('document/content', { documentId });
    expect(content).toBe('bar\nbar\nbar');
  });
});
```

---

## Snapshot Testing Patterns

Snapshots capture complex output for regression testing.

### Pattern: Syntax Highlighting Snapshots

```typescript
import { describe, test, expect } from 'bun:test';
import { TestECPClient } from '@test/ecp-client.ts';
import { loadFixture } from '@test/fixtures.ts';

describe('Syntax highlighting', () => {
  test('TypeScript tokens', async () => {
    const content = await loadFixture('documents/typescript/simple.ts');

    const result = await client.request('syntax/highlight', {
      content,
      languageId: 'typescript'
    });

    expect(result.lines).toMatchSnapshot();
  });

  test('Python tokens', async () => {
    const content = await loadFixture('documents/python/simple.py');

    const result = await client.request('syntax/highlight', {
      content,
      languageId: 'python'
    });

    expect(result.lines).toMatchSnapshot();
  });
});
```

### Pattern: LSP Response Snapshots

```typescript
describe('LSP responses', () => {
  test('document symbols structure', async () => {
    await client.request('document/open', {
      uri: workspace.fileUri('complex.ts')
    });

    // Wait for LSP
    await new Promise(resolve => setTimeout(resolve, 2000));

    const symbols = await client.request('lsp/documentSymbol', {
      uri: workspace.fileUri('complex.ts')
    });

    // Snapshot the structure, not positions (which may vary)
    const normalized = symbols.symbols.map(s => ({
      name: s.name,
      kind: s.kind,
      children: s.children?.map(c => ({ name: c.name, kind: c.kind }))
    }));

    expect(normalized).toMatchSnapshot();
  });
});
```

### Pattern: Error Message Snapshots

```typescript
describe('Error messages', () => {
  test('validation errors have consistent format', async () => {
    const errors = [
      await client.requestRaw('document/insert', {}),
      await client.requestRaw('document/insert', { documentId: 'x' }),
      await client.requestRaw('file/read', { uri: 'invalid' }),
      await client.requestRaw('git/commit', { message: '' }),
    ];

    const messages = errors.map(e => e.error?.message);
    expect(messages).toMatchSnapshot();
  });
});
```

### Pattern: Updating Snapshots

```bash
# When intentionally changing output format:
bun test --update-snapshots

# Review changes in git diff before committing
git diff tests/snapshots/
```

### Snapshot Best Practices

1. **Normalize variable data**: Remove timestamps, IDs, absolute paths
2. **Keep snapshots focused**: Don't snapshot entire responses if only structure matters
3. **Review snapshot changes**: Always check `git diff` on snapshot files
4. **Separate snapshot files**: One per test file, in `tests/snapshots/`
5. **Add context comments**: Describe what the snapshot represents
