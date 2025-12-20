# Ultra Testing Architecture

## Overview

The ECP architecture makes Ultra highly testable. Since all editor logic is accessed via JSON-RPC messages, we can test the entire system without terminal I/O by sending requests and asserting responses.

## Testing Framework

**Bun's built-in test runner** (`bun test`) provides everything we need:
- Fast execution (native speed)
- TypeScript support out of the box
- Snapshot testing via `expect().toMatchSnapshot()`
- Watch mode for development
- Parallel test execution

No additional test frameworks required.

## Test Levels

```
┌─────────────────────────────────────────────────────────────────┐
│                     End-to-End Tests                             │
│  Full workflows: Open file → Edit → Save → Git commit           │
│  Uses: TestECPClient, real temp files, real git repos           │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Integration Tests                             │
│  ECP adapter layer: JSON-RPC request → response                 │
│  Uses: Service adapters, mocked or real backends                │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       Unit Tests                                 │
│  Individual service methods: Buffer.insert(), GitService.diff() │
│  Uses: Direct service calls, test fixtures                       │
└─────────────────────────────────────────────────────────────────┘
```

### Unit Tests (~70% of tests)
Test individual service methods in isolation.

```typescript
import { describe, test, expect } from 'bun:test';
import { Buffer } from '@/services/document/buffer.ts';

describe('Buffer', () => {
  test('insert at position', () => {
    const buffer = new Buffer('hello world');
    buffer.insertAt({ line: 0, column: 5 }, ' beautiful');
    expect(buffer.getContent()).toBe('hello beautiful world');
  });
});
```

### Integration Tests (~20% of tests)
Test ECP adapters with JSON-RPC message format.

```typescript
import { describe, test, expect } from 'bun:test';
import { TestECPClient } from '@test/ecp-client.ts';

describe('document/insert', () => {
  test('inserts text at position', async () => {
    const client = new TestECPClient();

    // Open a document
    const { documentId } = await client.request('document/open', {
      uri: 'file:///test.txt',
      content: 'hello world'
    });

    // Insert text
    const result = await client.request('document/insert', {
      documentId,
      position: { line: 0, column: 5 },
      text: ' beautiful'
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe(2);

    // Verify content
    const content = await client.request('document/content', { documentId });
    expect(content.content).toBe('hello beautiful world');
  });
});
```

### End-to-End Tests (~10% of tests)
Test complete workflows across multiple services.

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestECPClient } from '@test/ecp-client.ts';
import { createTempWorkspace, cleanupTempWorkspace } from '@test/fixtures.ts';

describe('Edit and commit workflow', () => {
  let client: TestECPClient;
  let workspace: TempWorkspace;

  beforeEach(async () => {
    workspace = await createTempWorkspace({ git: true });
    client = new TestECPClient({ workspaceRoot: workspace.path });
  });

  afterEach(async () => {
    await client.shutdown();
    await cleanupTempWorkspace(workspace);
  });

  test('edit file, save, and commit', async () => {
    // Create a file
    await workspace.writeFile('test.txt', 'initial content');
    await workspace.gitCommit('Initial commit');

    // Open and edit via ECP
    const { documentId } = await client.request('document/open', {
      uri: workspace.fileUri('test.txt')
    });

    await client.request('document/replace', {
      documentId,
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 7 } },
      text: 'modified'
    });

    await client.request('file/save', { documentId });

    // Verify git sees the change
    const status = await client.request('git/status', {
      uri: workspace.rootUri
    });
    expect(status.unstaged).toHaveLength(1);
    expect(status.unstaged[0].path).toBe('test.txt');

    // Stage and commit
    await client.request('git/stage', {
      uri: workspace.rootUri,
      paths: ['test.txt']
    });

    const commitResult = await client.request('git/commit', {
      uri: workspace.rootUri,
      message: 'Update test.txt'
    });

    expect(commitResult.success).toBe(true);

    // Verify clean status
    const finalStatus = await client.request('git/status', {
      uri: workspace.rootUri
    });
    expect(finalStatus.staged).toHaveLength(0);
    expect(finalStatus.unstaged).toHaveLength(0);
  });
});
```

## Directory Structure

```
tests/
├── unit/                          # Unit tests (mirror src/ structure)
│   ├── services/
│   │   ├── document/
│   │   │   ├── buffer.test.ts
│   │   │   ├── cursor.test.ts
│   │   │   └── undo.test.ts
│   │   ├── file/
│   │   │   └── local-provider.test.ts
│   │   ├── git/
│   │   │   └── cli-service.test.ts
│   │   ├── lsp/
│   │   │   └── client.test.ts
│   │   ├── session/
│   │   │   ├── settings.test.ts
│   │   │   └── validation.test.ts
│   │   └── syntax/
│   │       └── highlighter.test.ts
│   └── core/
│       ├── auto-indent.test.ts
│       ├── auto-pair.test.ts
│       └── bracket-match.test.ts
│
├── integration/                   # ECP integration tests
│   ├── document.test.ts           # document/* methods
│   ├── file.test.ts               # file/* methods
│   ├── git.test.ts                # git/* methods
│   ├── lsp.test.ts                # lsp/* methods
│   ├── session.test.ts            # session/* and config/* methods
│   └── syntax.test.ts             # syntax/* methods
│
├── e2e/                           # End-to-end workflow tests
│   ├── editing-workflow.test.ts
│   ├── git-workflow.test.ts
│   ├── multi-file-workflow.test.ts
│   └── session-restore.test.ts
│
├── fixtures/                      # Test data
│   ├── documents/                 # Sample source files
│   │   ├── typescript/
│   │   │   ├── simple.ts
│   │   │   ├── complex.ts
│   │   │   └── with-errors.ts
│   │   ├── python/
│   │   ├── rust/
│   │   └── markdown/
│   ├── configs/                   # Sample config files
│   │   ├── settings.json
│   │   └── keybindings.json
│   └── git-repos/                 # Git repo templates
│       ├── simple/                # Basic repo structure
│       ├── with-conflicts/        # Pre-staged merge conflict
│       └── with-history/          # Multiple branches/commits
│
├── snapshots/                     # Snapshot files (auto-generated)
│   ├── integration/
│   │   ├── syntax.test.ts.snap
│   │   └── lsp.test.ts.snap
│   └── unit/
│       └── highlighter.test.ts.snap
│
├── helpers/                       # Test utilities
│   ├── ecp-client.ts              # TestECPClient class
│   ├── fixtures.ts                # Fixture loading utilities
│   ├── temp-workspace.ts          # Temp directory management
│   ├── git-helpers.ts             # Git test repo helpers
│   └── matchers.ts                # Custom Bun test matchers
│
└── setup.ts                       # Global test setup
```

## Configuration

### bunfig.toml

```toml
[test]
root = "./tests"
preload = ["./tests/setup.ts"]

# Path aliases for cleaner imports
[test.resolver]
"@/*" = ["./src/*"]
"@test/*" = ["./tests/helpers/*"]
"@fixtures/*" = ["./tests/fixtures/*"]
```

### tests/setup.ts

```typescript
import { beforeAll, afterAll } from 'bun:test';
import { cleanupAllTempWorkspaces } from './helpers/temp-workspace.ts';

// Global setup
beforeAll(() => {
  // Set test environment
  process.env.ULTRA_TEST = 'true';

  // Disable debug logging during tests (unless DEBUG_TESTS is set)
  if (!process.env.DEBUG_TESTS) {
    process.env.ULTRA_DEBUG = 'false';
  }
});

// Global cleanup
afterAll(async () => {
  await cleanupAllTempWorkspaces();
});
```

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/unit/services/document/buffer.test.ts

# Run tests matching pattern
bun test --grep "Buffer"

# Watch mode
bun test --watch

# Update snapshots
bun test --update-snapshots

# Run with coverage (when available)
bun test --coverage

# Run only unit tests
bun test tests/unit/

# Run only integration tests
bun test tests/integration/

# Run only e2e tests
bun test tests/e2e/

# Debug mode (verbose output)
DEBUG_TESTS=1 bun test
```

## Next Steps

See detailed documentation:
- [TestECPClient Design](./test-client.md) - The testing client class
- [Test Patterns](./patterns.md) - Common testing patterns and examples
- [Fixtures Guide](./fixtures.md) - Managing test data
