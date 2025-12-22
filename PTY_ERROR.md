# PTY Loading Error in Bundled Binary

## Problem Summary

When running the Ultra bundled binary from a directory other than the installation directory, terminal panes fail to open with the error:

```
Error: No PTY backend available. Install node-pty or bun-pty.
```

The terminal works correctly when:
- Running in development mode (`bun run dev`)
- Running the bundled binary from its installation directory

## Root Cause

Bun's bundled binary uses a virtual filesystem (`/$bunfs`) for bundled code. When the binary runs:
- `import.meta.dir` returns `/$bunfs/root` instead of the real filesystem path
- All module resolution (including dynamic `import()` and `require()`) goes through the virtual filesystem
- Native modules like `node-pty` and `bun-pty` cannot be loaded from the virtual filesystem

## Debug Information

From the debug logs:
```
[PTYFactory] import.meta.dir: /$bunfs/root
[PTYFactory] process.execPath: /Users/keith/Development/ultra-1.0/ultra
[PTYFactory] Trying node-pty from project root: /Users/keith/Development/ultra-1.0
[PTYFactory] node-pty not available: Cannot find package 'node-pty' from '/Users/keith/Development/ultra-1.0/package.json'
```

Key observations:
- `process.execPath` correctly identifies the real binary location
- The project root is correctly calculated as `/Users/keith/Development/ultra-1.0`
- Both `node-pty` and `bun-pty` exist in `node_modules/`
- Module resolution still fails despite correct paths

## Attempted Solutions

### 1. Using `import.meta.dir` with relative paths
```typescript
const thisDir = import.meta.dir;
const modulePath = path.join(thisDir, '..', '..', 'node_modules', 'node-pty');
await import(modulePath);
```
**Result:** Failed - `import.meta.dir` returns `/$bunfs/root` in bundled context

### 2. Using `process.execPath` to find real location
```typescript
function getProjectRoot(): string {
  const thisDir = import.meta.dir;
  if (thisDir.startsWith('/$bunfs')) {
    return path.dirname(process.execPath);
  }
  return path.join(thisDir, '..', '..');
}
```
**Result:** Project root correctly identified, but module loading still fails

### 3. Dynamic import with absolute path
```typescript
const projectRoot = getProjectRoot();
const modulePath = path.join(projectRoot, 'node_modules', 'node-pty');
await import(modulePath);
```
**Result:** Failed - `Cannot find module '/Users/keith/Development/ultra-1.0/node_modules/node-pty' from '/$bunfs/root/ultra'`

### 4. Using `require()` instead of `import()`
```typescript
const modulePath = path.join(projectRoot, 'node_modules', 'node-pty');
require(modulePath);
```
**Result:** Failed - Same error, `require()` also goes through bunfs resolution

### 5. Using `createRequire` from `node:module`
```typescript
import { createRequire } from 'node:module';

function createRealRequire(): NodeRequire {
  const projectRoot = getProjectRoot();
  return createRequire(path.join(projectRoot, 'package.json'));
}

const realRequire = createRealRequire();
realRequire('node-pty');
```
**Result:** Failed - `Cannot find package 'node-pty' from '/Users/keith/Development/ultra-1.0/package.json'`

### 6. Anchoring `createRequire` at subdirectory
```typescript
// Anchor at src/index.js so node_modules is found in parent directory
return createRequire(path.join(projectRoot, 'src', 'index.js'));
```
**Result:** Failed - Same error

## Analysis

The fundamental issue is that Bun's bundled binary intercepts ALL module resolution mechanisms:
- `import()` - intercepted
- `require()` - intercepted
- `createRequire()` - intercepted

Even though `createRequire` is a Node.js API that should create a require function anchored at a real filesystem path, Bun's runtime intercepts the resulting `require()` calls.

The native modules (`node-pty`, `bun-pty`) contain compiled `.node` files that must be loaded from the real filesystem via `dlopen`. Bun's bundler cannot embed these native modules in the virtual filesystem.

## Potential Solutions to Investigate

### 1. Bun-specific native module loading
Research if Bun has APIs for loading native modules from the real filesystem when running as a bundled binary.

### 2. Direct `dlopen` / FFI
Use Bun's FFI capabilities to directly load the native `.node` file:
```typescript
import { dlopen, FFIType } from 'bun:ffi';
const lib = dlopen(path.join(projectRoot, 'node_modules/node-pty/build/Release/pty.node'), {
  // ... function signatures
});
```

### 3. External process
Spawn a separate Node.js or Bun process that loads the PTY module and communicate via IPC.

### 4. Bundle native module alongside executable
Copy the `.node` file next to the executable during build and load it directly.

### 5. Use Bun's built-in PTY support
Check if Bun has native PTY support that doesn't require external modules.

### 6. Investigate `--external` build flag
Check if Bun's build process has options to mark certain modules as external, loading them from the real filesystem at runtime.

## Files Involved

- `src/terminal/pty-factory.ts` - PTY backend selection and creation
- `src/terminal/backends/node-pty.ts` - node-pty backend implementation
- `src/terminal/pty.ts` - bun-pty backend implementation
- `build.ts` - Build script for creating the bundled binary

## Current Workaround

Run Ultra from its installation directory, or use development mode:
```bash
cd /path/to/ultra-1.0 && ./ultra
# or
bun run dev
```
