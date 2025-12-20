# Test Fixtures

Managing test data for Ultra's test suite.

## Overview

Fixtures provide consistent, reusable test data:
- **Static fixtures**: Sample source files, configs (`tests/fixtures/`)
- **Dynamic fixtures**: Temp directories, git repos (created per test)

## Static Fixtures

### Directory Structure

```
tests/fixtures/
├── documents/                    # Sample source files
│   ├── typescript/
│   │   ├── simple.ts             # Basic TypeScript
│   │   ├── complex.ts            # Classes, generics, decorators
│   │   ├── with-errors.ts        # Intentional syntax errors
│   │   ├── jsx-component.tsx     # React component
│   │   └── large.ts              # 1000+ lines for perf tests
│   ├── javascript/
│   │   ├── es6.js
│   │   └── commonjs.js
│   ├── python/
│   │   ├── simple.py
│   │   └── with-classes.py
│   ├── rust/
│   │   ├── simple.rs
│   │   └── with-macros.rs
│   ├── markdown/
│   │   ├── simple.md
│   │   └── with-code-blocks.md
│   └── mixed/
│       └── various-languages/    # Multi-file project
│
├── configs/                      # Sample config files
│   ├── settings.json
│   ├── settings-minimal.json
│   ├── settings-invalid.json     # Malformed JSON
│   ├── keybindings.json
│   └── themes/
│       └── custom-theme.json
│
└── git-repos/                    # Git repo templates
    ├── simple/                   # Basic repo
    │   ├── .git/                 # Actual git data
    │   ├── README.md
    │   └── src/
    │       └── main.ts
    ├── with-history/             # Multiple commits/branches
    │   ├── .git/
    │   └── ...
    ├── with-conflicts/           # Pre-staged merge conflict
    │   ├── .git/
    │   └── ...
    └── with-submodules/
        ├── .git/
        └── ...
```

### Loading Static Fixtures

```typescript
// tests/helpers/fixtures.ts

import { join } from 'path';

const FIXTURES_DIR = join(import.meta.dir, '../fixtures');

/**
 * Load a fixture file as text.
 */
export async function loadFixture(relativePath: string): Promise<string> {
  const fullPath = join(FIXTURES_DIR, relativePath);
  const file = Bun.file(fullPath);

  if (!await file.exists()) {
    throw new Error(`Fixture not found: ${relativePath}`);
  }

  return file.text();
}

/**
 * Load a fixture file as JSON.
 */
export async function loadFixtureJson<T = unknown>(relativePath: string): Promise<T> {
  const content = await loadFixture(relativePath);
  return JSON.parse(content);
}

/**
 * Get absolute path to a fixture.
 */
export function fixturePath(relativePath: string): string {
  return join(FIXTURES_DIR, relativePath);
}

/**
 * Get file:// URI for a fixture.
 */
export function fixtureUri(relativePath: string): string {
  return `file://${fixturePath(relativePath)}`;
}

/**
 * List all files in a fixture directory.
 */
export async function listFixtures(directory: string): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const fullPath = join(FIXTURES_DIR, directory);
  return readdir(fullPath);
}
```

### Usage

```typescript
import { loadFixture, fixtureUri } from '@test/fixtures.ts';

test('highlights TypeScript', async () => {
  const content = await loadFixture('documents/typescript/simple.ts');
  // Use content...
});

test('opens fixture file', async () => {
  const result = await client.request('document/open', {
    uri: fixtureUri('documents/typescript/simple.ts')
  });
});
```

---

## Dynamic Fixtures (Temp Workspaces)

For tests that need writable file systems or git repos.

### TempWorkspace Interface

```typescript
// tests/helpers/temp-workspace.ts

interface TempWorkspaceOptions {
  /** Initialize as git repo */
  git?: boolean;

  /** Copy a fixture template */
  template?: string;

  /** Initial files to create */
  files?: Record<string, string>;
}

interface TempWorkspace {
  /** Absolute path to temp directory */
  path: string;

  /** file:// URI to root */
  rootUri: string;

  /** Get file:// URI for a file */
  fileUri(relativePath: string): string;

  /** Write a file */
  writeFile(relativePath: string, content: string): Promise<void>;

  /** Read a file */
  readFile(relativePath: string): Promise<string>;

  /** Check if file exists */
  exists(relativePath: string): Promise<boolean>;

  /** Delete a file */
  deleteFile(relativePath: string): Promise<void>;

  /** Create a directory */
  mkdir(relativePath: string): Promise<void>;

  /** List directory contents */
  readdir(relativePath: string): Promise<string[]>;

  // Git helpers (only if git: true)
  gitAdd(path: string): Promise<void>;
  gitCommit(message: string): Promise<void>;
  gitBranch(name: string): Promise<void>;
  gitCheckout(name: string): Promise<void>;
  gitStatus(): Promise<string>;

  /** Clean up temp directory */
  cleanup(): Promise<void>;
}
```

### Implementation

```typescript
// tests/helpers/temp-workspace.ts

import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { $ } from 'bun';

// Track all workspaces for cleanup
const activeWorkspaces: TempWorkspace[] = [];

export async function createTempWorkspace(
  options: TempWorkspaceOptions = {}
): Promise<TempWorkspace> {
  // Create temp directory
  const path = await mkdtemp(join(tmpdir(), 'ultra-test-'));

  // Copy template if specified
  if (options.template) {
    const templatePath = join(import.meta.dir, '../fixtures', options.template);
    await $`cp -r ${templatePath}/. ${path}/`.quiet();
  }

  // Create initial files
  if (options.files) {
    for (const [filePath, content] of Object.entries(options.files)) {
      const fullPath = join(path, filePath);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content);
    }
  }

  // Initialize git if requested
  if (options.git && !options.template?.includes('git-repos')) {
    await $`git -C ${path} init`.quiet();
    await $`git -C ${path} config user.email "test@test.com"`.quiet();
    await $`git -C ${path} config user.name "Test"`.quiet();
  }

  const workspace: TempWorkspace = {
    path,
    rootUri: `file://${path}`,

    fileUri(relativePath: string): string {
      return `file://${join(path, relativePath)}`;
    },

    async writeFile(relativePath: string, content: string): Promise<void> {
      const fullPath = join(path, relativePath);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await Bun.write(fullPath, content);
    },

    async readFile(relativePath: string): Promise<string> {
      return Bun.file(join(path, relativePath)).text();
    },

    async exists(relativePath: string): Promise<boolean> {
      return Bun.file(join(path, relativePath)).exists();
    },

    async deleteFile(relativePath: string): Promise<void> {
      await rm(join(path, relativePath), { force: true });
    },

    async mkdir(relativePath: string): Promise<void> {
      await mkdir(join(path, relativePath), { recursive: true });
    },

    async readdir(relativePath: string): Promise<string[]> {
      return readdir(join(path, relativePath));
    },

    async gitAdd(filePath: string): Promise<void> {
      await $`git -C ${path} add ${filePath}`.quiet();
    },

    async gitCommit(message: string): Promise<void> {
      await $`git -C ${path} commit -m ${message}`.quiet();
    },

    async gitBranch(name: string): Promise<void> {
      await $`git -C ${path} branch ${name}`.quiet();
    },

    async gitCheckout(name: string): Promise<void> {
      await $`git -C ${path} checkout ${name}`.quiet();
    },

    async gitStatus(): Promise<string> {
      return $`git -C ${path} status --porcelain`.text();
    },

    async cleanup(): Promise<void> {
      await rm(path, { recursive: true, force: true });
      const index = activeWorkspaces.indexOf(workspace);
      if (index >= 0) activeWorkspaces.splice(index, 1);
    }
  };

  activeWorkspaces.push(workspace);
  return workspace;
}

/**
 * Cleanup all workspaces (for global afterAll).
 */
export async function cleanupAllTempWorkspaces(): Promise<void> {
  await Promise.all(activeWorkspaces.map(w => w.cleanup()));
}
```

### Usage Examples

#### Basic Temp Directory

```typescript
import { createTempWorkspace } from '@test/temp-workspace.ts';

test('file operations', async () => {
  const workspace = await createTempWorkspace();

  await workspace.writeFile('test.txt', 'hello');
  const content = await workspace.readFile('test.txt');
  expect(content).toBe('hello');

  await workspace.cleanup();
});
```

#### With Initial Files

```typescript
test('with initial files', async () => {
  const workspace = await createTempWorkspace({
    files: {
      'src/main.ts': 'console.log("hello");',
      'package.json': '{"name": "test"}'
    }
  });

  expect(await workspace.exists('src/main.ts')).toBe(true);

  await workspace.cleanup();
});
```

#### With Git Repo

```typescript
test('git workflow', async () => {
  const workspace = await createTempWorkspace({ git: true });

  await workspace.writeFile('README.md', '# Test');
  await workspace.gitAdd('README.md');
  await workspace.gitCommit('Initial commit');

  await workspace.writeFile('README.md', '# Updated');
  const status = await workspace.gitStatus();
  expect(status).toContain('README.md');

  await workspace.cleanup();
});
```

#### From Template

```typescript
test('with template', async () => {
  const workspace = await createTempWorkspace({
    template: 'git-repos/with-history'
  });

  // Template already has commits, branches, etc.
  const status = await workspace.gitStatus();
  // ...

  await workspace.cleanup();
});
```

---

## Git Repo Templates

Pre-built git repositories for testing specific scenarios.

### simple/

Basic repo with one commit:
```
simple/
├── .git/
├── README.md
└── src/
    └── main.ts
```

### with-history/

Multiple commits and branches:
```
with-history/
├── .git/
│   └── (multiple commits on main, feature branch)
├── README.md
└── src/
    ├── main.ts
    └── utils.ts

Branches: main, feature/add-utils
Commits: 3 on main, 2 on feature branch
```

### with-conflicts/

Pre-staged merge conflict:
```
with-conflicts/
├── .git/
│   └── (conflict state in MERGE_HEAD)
├── README.md (with conflict markers)
└── src/
    └── main.ts

State: Mid-merge with conflicts in README.md
```

### Creating Git Templates

```bash
# Create a new template
cd tests/fixtures/git-repos
mkdir new-template && cd new-template

# Set up the repo
git init
git config user.email "template@test.com"
git config user.name "Template"

# Create files and commits
echo "# Test" > README.md
git add README.md
git commit -m "Initial"

# The .git directory IS committed to the repo
# (unusual but needed for test fixtures)
```

---

## Best Practices

### 1. Use Static Fixtures for Read-Only Tests

```typescript
// Good: Use static fixture when not modifying
const content = await loadFixture('documents/typescript/simple.ts');
highlighter.parse(content);

// Bad: Creating temp file unnecessarily
const workspace = await createTempWorkspace();
await workspace.writeFile('test.ts', 'const x = 1;');
```

### 2. Always Cleanup Temp Workspaces

```typescript
// Good: Cleanup in afterEach
afterEach(async () => {
  await workspace.cleanup();
});

// Or use try/finally
const workspace = await createTempWorkspace();
try {
  // test...
} finally {
  await workspace.cleanup();
}
```

### 3. Use Templates for Complex Git States

```typescript
// Good: Use pre-built template
const workspace = await createTempWorkspace({
  template: 'git-repos/with-conflicts'
});

// Bad: Recreating conflict state in test
const workspace = await createTempWorkspace({ git: true });
await workspace.gitBranch('feature');
await workspace.gitCheckout('feature');
await workspace.writeFile('file.txt', 'feature content');
await workspace.gitCommit('Feature');
await workspace.gitCheckout('main');
// ... 10 more lines to create conflict
```

### 4. Keep Fixture Files Small

```typescript
// fixtures/documents/typescript/simple.ts
// ~10-20 lines, just enough to test the feature

function greet(name: string): string {
  return `Hello, ${name}!`;
}

export { greet };
```

### 5. Document Fixture Purpose

```typescript
// fixtures/documents/typescript/with-errors.ts
// This file intentionally contains syntax errors
// Used for testing error handling and diagnostics

function broken( {  // Missing closing paren
  return 1
}

const x: string = 123;  // Type error
```

### 6. Version Control Fixtures

All fixtures should be committed to git, including:
- Sample source files
- Config files
- Git repo templates (including `.git/` directories)

This ensures reproducible tests across machines and CI.
