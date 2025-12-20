---
description: Ultra Editor development guidelines and patterns
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: true
---

# Ultra Editor Development Guide

Ultra is a terminal-native code editor built with TypeScript and Bun.

## Bun Usage

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`
- Use `bunx <package>` instead of `npx <package>`
- Bun automatically loads .env, so don't use dotenv

### Bun APIs

- Use `Bun.$` for shell commands (e.g., `await $`git status`.quiet()`)
- Use `Bun.file()` for file operations
- For text file imports at build time: `import content from './file.md' with { type: 'text' }`

## Code Patterns

### Import Extensions

Always include `.ts` extension in imports:

```typescript
// Good
import { hexToRgb } from '../colors.ts';
import { debugLog } from '../../debug.ts';

// Bad
import { hexToRgb } from '../colors';
```

### Singleton Pattern

Services and managers use singleton pattern with both named and default exports:

```typescript
// At bottom of file
export const myService = new MyService();
export default myService;
```

Import singletons by name, not default:

```typescript
// Good
import { gitIntegration } from './features/git/git-integration.ts';
import { themeLoader } from './ui/themes/theme-loader.ts';

// Avoid default imports for singletons
```

### Debug Logging

**Never use `console.log` for debugging.** Use the centralized debug system:

```typescript
// For standalone functions/modules
import { debugLog } from '../../debug.ts';

debugLog(`[MyModule] Something happened: ${value}`);

// For classes, add a debugLog method
protected debugLog(msg: string): void {
  if (isDebugEnabled()) {
    debugLog(`[${this._debugName}] ${msg}`);
  }
}
```

Debug logs are written to `debug.log` only when `--debug` flag is passed.

### Constants

Use `src/constants.ts` for magic numbers and configuration values:

```typescript
import { CACHE, TIMEOUTS, UI } from '../constants.ts';

// Good - uses named constant
const ttl = CACHE.GIT_STATUS_TTL;
const timeout = TIMEOUTS.LSP_REQUEST;

// Bad - magic number
const ttl = 5000;
```

Add new constants to the appropriate section in constants.ts with JSDoc comments.

### Color Utilities

Import color functions from `src/ui/colors.ts`:

```typescript
// Good
import { hexToRgb, rgbToHex, lighten, darken } from '../colors.ts';

// Bad - don't use deprecated methods on classes
this.hexToRgb(color);  // Wrong
RenderUtils.hexToRgb(color);  // Deprecated
themeLoader.hexToRgb(color);  // Deprecated
```

### Dialog Components

Extend `BaseDialog` for new dialog components:

```typescript
import { BaseDialog, type BaseDialogConfig } from './base-dialog.ts';

export class MyDialog extends BaseDialog {
  constructor() {
    super();
    this._debugName = 'MyDialog';
  }

  // Required abstract methods
  render(ctx: RenderContext): void { ... }
  onMouseEvent(event: MouseEvent): boolean { ... }
}

export const myDialog = new MyDialog();
export default myDialog;
```

For searchable dialogs (with filtering), extend `SearchableDialog<T>`.

### Git Commands

Always use `.quiet()` to suppress output and prevent interactive prompts:

```typescript
// Good - suppresses output
const result = await $`git -C ${workspaceRoot} status --porcelain`.quiet();

// Bad - may produce unwanted output or prompts
const result = await $`git status`;
```

For commands that need text output, use `.text()`:

```typescript
const result = await $`git -C ${workspaceRoot} branch`.text();
```

Git commands should never open an editor (vi/vim). **NOTE:** `GIT_EDITOR=true` should be set but is currently missing from git-integration.ts - this is a known issue to fix.

### Event Callbacks

Use the callback registration pattern:

```typescript
// Registration returns unsubscribe function
const unsubscribe = component.onSomeEvent((data) => {
  // handle event
});

// Later, to unsubscribe
unsubscribe();
```

### Render Scheduling

Use the render scheduler for UI updates:

```typescript
import { renderScheduler, RenderTaskIds } from '../render-scheduler.ts';

// Schedule with priority and deduplication
renderScheduler.schedule(() => {
  this.render(ctx);
}, 'normal', RenderTaskIds.STATUS_BAR);
```

Priorities: `immediate` > `high` > `normal` > `low`

## Anti-Patterns to Avoid

### Don't use console.log
```typescript
// Bad
console.log('Debug:', value);

// Good
debugLog(`[Component] Debug: ${value}`);
```

### Don't use deprecated color methods
```typescript
// Bad
this.hexToRgb(color);

// Good
import { hexToRgb } from '../colors.ts';
hexToRgb(color);
```

### Don't hardcode magic numbers
```typescript
// Bad
setTimeout(callback, 5000);

// Good
import { TIMEOUTS } from '../constants.ts';
setTimeout(callback, TIMEOUTS.DEBOUNCE_DEFAULT);
```

### Don't create new singletons without exports
```typescript
// Bad - no way to import
class MyThing { }
const myThing = new MyThing();

// Good - proper singleton exports
export const myThing = new MyThing();
export default myThing;
```

### Don't use interactive git commands
```typescript
// Bad - may open editor
await $`git commit`;

// Good - provides message inline
await $`git commit -m ${message}`.quiet();
```

## Project Structure

```
src/
├── app.ts              # Main application orchestrator
├── constants.ts        # Centralized configuration constants
├── debug.ts            # Debug logging utility
├── core/               # Core data structures (buffer, cursor, document)
├── ui/
│   ├── colors.ts       # Color utilities (hexToRgb, etc.)
│   ├── renderer.ts     # Terminal rendering
│   ├── render-scheduler.ts  # Priority-based render batching
│   └── components/     # UI components (dialogs, panels, etc.)
│       ├── base-dialog.ts      # Base class for dialogs
│       └── searchable-dialog.ts # Filterable dialog base
├── features/
│   ├── git/            # Git integration
│   ├── lsp/            # Language Server Protocol
│   └── syntax/         # Syntax highlighting
├── input/              # Keyboard/mouse handling
├── config/             # Settings and configuration
└── terminal/           # Terminal I/O
```

## Testing

Ultra uses Bun's built-in test runner. See `architecture/testing/` for comprehensive documentation.

### Running Tests

```bash
bun test                 # Run all tests
bun test --watch         # Watch mode
bun test tests/unit/     # Unit tests only
bun test tests/integration/  # Integration tests only
bun test tests/e2e/      # End-to-end tests only
bun test --update-snapshots  # Update snapshot files
bun run typecheck        # TypeScript type checking
```

### Test Structure

```
tests/
├── unit/                # Service method tests
├── integration/         # ECP adapter tests (JSON-RPC)
├── e2e/                 # Full workflow tests
├── fixtures/            # Test data (documents, configs, git repos)
├── snapshots/           # Snapshot files (auto-generated)
└── helpers/             # Test utilities (TestECPClient, etc.)
```

### TestECPClient

The `TestECPClient` class enables testing ECP methods without terminal I/O:

```typescript
import { TestECPClient } from '@test/ecp-client.ts';

test('document editing', async () => {
  const client = new TestECPClient();

  const { documentId } = await client.request('document/open', {
    uri: 'memory://test.txt',
    content: 'hello'
  });

  await client.request('document/insert', {
    documentId,
    position: { line: 0, column: 5 },
    text: ' world'
  });

  const { content } = await client.request('document/content', { documentId });
  expect(content).toBe('hello world');

  await client.shutdown();
});
```

### Test Documentation

- [Testing Overview](./architecture/testing/overview.md) - Strategy and structure
- [TestECPClient Design](./architecture/testing/test-client.md) - Client class API
- [Test Patterns](./architecture/testing/patterns.md) - Unit, integration, e2e, snapshots
- [Fixtures Guide](./architecture/testing/fixtures.md) - Managing test data

## Running

```bash
bun run dev              # Development mode
bun run dev --debug      # With debug logging
bun run build            # Build executable
```

## Ultra 1.0 Architecture

Ultra 1.0 is being rearchitected into an **Editor Command Protocol (ECP) Server** model. See `architecture/` for detailed documentation.

### Key Concepts

1. **ECP Server**: Ultra core becomes a headless server using JSON-RPC 2.0
2. **Services**: Modular services (Document, File, Git, LSP, Session, Syntax, Terminal)
3. **Multiple Clients**: TUI, GUI, AI agents, or remote clients connect via ECP
4. **Abstracted I/O**: File system, git, etc. are pluggable backends

### Architecture Documentation

```
architecture/
├── overview.md           # High-level architecture vision
├── services/
│   ├── document-service.md   # Buffer, cursor, undo (core editing)
│   ├── file-service.md       # File system abstraction
│   ├── git-service.md        # Version control
│   ├── lsp-service.md        # Language server integration
│   ├── session-service.md    # Settings, keybindings, state
│   ├── syntax-service.md     # Syntax highlighting
│   └── terminal-service.md   # Terminal I/O (TUI client only)
└── testing/
    ├── overview.md           # Testing strategy and structure
    ├── test-client.md        # TestECPClient design
    ├── patterns.md           # Unit, integration, e2e patterns
    └── fixtures.md           # Test data management
```

### Known Issues to Fix During Migration

These issues were identified during the architecture review:

| Issue | Location | Description |
|-------|----------|-------------|
| `console.error` usage | Multiple files | Should use `debugLog()` instead |
| Silent failures | Git, LSP, Config | Operations fail without error feedback |
| Hardcoded tabSize | `document.ts:813` | Uses `2` instead of settings |
| Defaults inconsistency | settings.ts vs defaults.ts | Theme, wordWrap values differ |
| Fold state not saved | `app.ts:490` | TODO comment, always empty array |
| Missing GIT_EDITOR | git-integration.ts | Not set despite CLAUDE.md claim |
| No input validation | Settings | Any value accepted without validation |
| Memory unbounded | CacheManager | No size limits, potential memory leak |
| when clauses unused | keymap.ts | Context conditions not implemented |

### Service Interface Pattern

When creating new services, follow this pattern:

```typescript
// services/example/interface.ts
interface ExampleService {
  // Methods with clear contracts
  doSomething(params: Params): Promise<Result>;

  // Event subscription returning unsubscribe
  onEvent(callback: EventCallback): Unsubscribe;
}

// services/example/local.ts
class LocalExampleService implements ExampleService {
  // Implementation
}

// services/example/adapter.ts
class ExampleServiceAdapter {
  // Maps ECP JSON-RPC calls to service methods
  handleRequest(method: string, params: unknown): Promise<unknown>
}

// services/example/index.ts
export { ExampleService } from './interface.ts';
export { LocalExampleService } from './local.ts';
export { ExampleServiceAdapter } from './adapter.ts';
```

### ECP Method Naming

ECP methods use namespaced naming:

```typescript
"document/insert"     // Document operations
"file/read"           // File operations
"git/commit"          // Git operations
"lsp/completion"      // LSP features
"config/set"          // Configuration
"session/save"        // Session management
```

### Migration Guidelines

1. **Don't break existing functionality** - Current TUI must work during migration
2. **Extract interfaces first** - Define service contracts before refactoring
3. **Fix issues as you go** - Address known issues when touching files
4. **Add tests** - New service code should have test coverage
5. **Update this file** - Keep CLAUDE.md current with new patterns
