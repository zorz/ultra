# Contributing to Ultra

Thank you for your interest in contributing to Ultra! This guide covers the development workflow, code standards, and best practices.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- Git
- A code editor (Ultra itself works great!)

### Setup

```bash
# Clone the repository
git clone https://github.com/zorz/ultra.git
cd ultra

# Install dependencies
bun install

# Run Ultra
bun run src/index.ts

# Run with debug logging
bun run src/index.ts --debug
```

### Project Structure

```
ultra/
├── src/
│   ├── index.ts            # Entry point
│   ├── constants.ts        # Shared constants
│   ├── debug.ts            # Debug utilities
│   ├── clients/tui/        # Terminal UI client
│   ├── services/           # ECP services (document, file, git, lsp, etc.)
│   ├── terminal/           # PTY backends
│   └── config/             # Configuration
├── config/                 # Default configurations
├── docs/                   # Documentation
└── tests/                  # Test files
```

## Development Workflow

### Running in Development

```bash
# Run with hot reload (if supported)
bun --hot src/index.ts

# Run with debug logging
bun src/index.ts --debug

# Run tests
bun test
```

### Debug Logging

Use `debugLog()` instead of `console.log`:

```typescript
import { debugLog } from './debug.ts';

// Logs to debug.log file
debugLog('Processing file:', filename);
```

### Making Changes

1. Create a feature branch
   ```bash
   git checkout -b feature/my-feature
   ```

2. Make your changes

3. Test your changes
   ```bash
   bun test
   bun src/index.ts --debug  # Manual testing
   ```

4. Commit with a descriptive message
   ```bash
   git commit -m "Add feature: description"
   ```

5. Push and create a pull request
   ```bash
   git push origin feature/my-feature
   ```

## Code Standards

### TypeScript

- Use strict TypeScript (`"strict": true`)
- Always include `.ts` extension in imports
- Use explicit types for function parameters and returns

```typescript
// ✅ Good
import { Buffer } from './core/buffer.ts';

function processFile(path: string): Promise<void> {
  // ...
}

// ❌ Bad
import { Buffer } from './core/buffer';  // Missing .ts

function processFile(path) {  // Missing types
  // ...
}
```

### Singleton Pattern

Most managers follow the singleton pattern:

```typescript
// ✅ Good
export class MyManager {
  // Implementation
}

export const myManager = new MyManager();
export default myManager;
```

### Debug Logging

Never use `console.log` in production code:

```typescript
// ✅ Good
import { debugLog } from './debug.ts';
debugLog('Message:', data);

// ❌ Bad
console.log('Message:', data);
```

### Constants

Use the constants file for shared values:

```typescript
// ✅ Good
import { TAB_WIDTH, GUTTER_WIDTH } from './constants.ts';

// ❌ Bad
const tabWidth = 2;  // Magic number
```

### Color Utilities

Use color utilities instead of hardcoded ANSI:

```typescript
// ✅ Good
import { fgHex, bgHex, hexToRgb } from './ui/colors.ts';
process.stdout.write(fgHex('#ff0000') + 'Red text');

// ❌ Bad
process.stdout.write('\x1b[31mRed text');  // Hardcoded ANSI
```

### Render Scheduling

Always use the render scheduler:

```typescript
// ✅ Good
import { renderScheduler } from './ui/render-scheduler.ts';
renderScheduler.scheduleRender();

// ❌ Bad
this.render();  // Direct render
```

### Event Callbacks

Use `onConfirm` for dialog callbacks (not `onSubmit`):

```typescript
// ✅ Good
dialog.show({
  onConfirm: (value) => { /* ... */ }
});

// ❌ Bad
dialog.show({
  onSubmit: (value) => { /* ... */ }  // Wrong name
});
```

## Adding Features

### Adding a New Command

1. Register the command in `app.ts`:

```typescript
commandRegistry.register({
  id: 'ultra.myCommand',
  title: 'Category: My Command',
  handler: () => {
    // Implementation
  }
});
```

2. Add a keybinding in `config/default-keybindings.json`:

```json
{
  "key": "ctrl+shift+m",
  "command": "ultra.myCommand"
}
```

See [Adding Commands Guide](adding-commands.md) for details.

### Adding a UI Component

1. Create a new file in `src/ui/components/`
2. Extend `BaseDialog` for dialogs
3. Implement `render()` and `handleKey()` methods
4. Use `renderScheduler.scheduleRender()` for updates

See [UI Components](../modules/ui-components.md) for details.

### Adding Language Support

1. Ensure the language server is configured
2. Add file extension mapping
3. Add syntax highlighting rules

See [Adding Languages Guide](adding-languages.md) for details.

## Testing

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/buffer.test.ts

# Run with watch mode
bun test --watch
```

### Writing Tests

```typescript
import { test, expect } from 'bun:test';
import { Buffer } from '../src/core/buffer.ts';

test('Buffer inserts text correctly', () => {
  const buffer = new Buffer('Hello');
  buffer.insert(5, ' World');
  expect(buffer.getContent()).toBe('Hello World');
});
```

## Documentation

### TSDoc Comments

Document all exports:

```typescript
/**
 * Inserts text at the specified position.
 *
 * @param pos - The position to insert at
 * @param text - The text to insert
 * @returns The number of characters inserted
 *
 * @example
 * ```typescript
 * buffer.insertAt({ line: 0, column: 5 }, 'World');
 * ```
 */
insertAt(pos: Position, text: string): number {
  // ...
}
```

### Documentation Files

- Update relevant docs in `docs/` when changing features
- Follow the style in `docs/DOCUMENTATION_SPECS.md`

## Pull Request Guidelines

### Before Submitting

- [ ] Code follows style guidelines
- [ ] Tests pass (`bun test`)
- [ ] Manual testing completed
- [ ] Documentation updated if needed
- [ ] Commit messages are descriptive

### PR Description

Include:
- What the change does
- Why it's needed
- How to test it
- Screenshots if UI changes

### Review Process

1. PRs require review before merge
2. Address review feedback
3. Keep PRs focused and reasonably sized
4. Squash commits if requested

## Getting Help

- Check existing issues and PRs
- Read the documentation in `docs/`
- Ask questions in discussions
- File issues for bugs

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Focus on the code, not the person

Thank you for contributing to Ultra!
