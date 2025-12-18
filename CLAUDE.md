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

Git commands should never open an editor (vi/vim). The git-integration module sets `GIT_EDITOR=true` globally.

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

```bash
bun test                 # Run all tests
bun test --watch         # Watch mode
bun run typecheck        # TypeScript type checking
```

## Running

```bash
bun run dev              # Development mode
bun run dev --debug      # With debug logging
bun run build            # Build executable
```
