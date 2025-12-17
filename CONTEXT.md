# Ultra Editor Development Context

## Project Overview
Ultra is a terminal-based code editor written in TypeScript, compiled to a single binary using Bun. It features syntax highlighting (Shiki), LSP support, git integration, and a VS Code-inspired UI.

## Architecture

### Core Structure
- **Entry**: `src/index.ts` → `src/app.ts` (App class)
- **Bundler**: `build.ts` compiles everything to `./ultra` binary
- **Config**: JSON files in `config/` are embedded at build time via `src/config/defaults.ts`

### Key Components
- **Renderer** (`src/ui/renderer.ts`): Terminal rendering with ANSI escape codes, buffered output
- **Pane/PaneManager** (`src/ui/components/pane.ts`, `pane-manager.ts`): Editor panes with tabs, splits
- **Document** (`src/core/document.ts`): Text buffer, cursor management, undo/redo
- **Input** (`src/terminal/input.ts`): Raw terminal input parsing (keys, mouse, CSI u protocol)
- **Keymap** (`src/input/keymap.ts`): Keybinding system with chord support

### UI Components
- `file-tree.ts`: Sidebar file browser
- `git-panel.ts`: Source control panel
- `command-palette.ts`: Command palette (Ctrl+P style)
- `input-dialog.ts`: Modal input dialogs
- `status-bar.ts`: Bottom status bar
- `tab-bar.ts`: Tab management
- `minimap.ts`: Code minimap

### Features
- `src/features/lsp/`: Language Server Protocol client
- `src/features/git/`: Git integration (status, diff, stage, commit)
- `src/features/syntax/`: Shiki syntax highlighting
- `src/features/search/`: File and project search

## Recent Session Work (December 2024)

### Git Gutter Indicators
- Implemented line-level change indicators in editor gutter
- Colors: green (added), blue (modified), red triangle (deleted)
- Compares buffer content against HEAD (not disk)
- Uses `git diff --no-index` for buffer-to-HEAD comparison

### Inline Diff Viewer
- Click gutter indicator to show inline diff
- Displays within editor, pushes text down
- Theme-aware colors using `blendColor()` utility (15% blend)
- Keyboard: `s` stage, `r` revert, `c`/`Esc` close, `j/k` scroll
- Mouse: Stage, Revert, Close buttons in header
- Shows only the relevant hunk for clicked line

### Git Panel Improvements
- Keyboard shortcuts wrap to fit narrow sidebar
- Commit flow uses centered modal dialog (InputDialog)
- Press `c` in focused git panel to open commit dialog
- `ultra.focusGitPanel` no longer hides file tree

### Key Bug Fixes
- `themeLoader.getTheme()` → `themeLoader.getCurrentTheme()`
- `ctx.drawText()` → `ctx.drawStyled()`
- `handleMouseEvent()` → `onMouseEvent()`
- `doc.reloadFromDisk()` → `doc.reload()`
- Keys are UPPERCASE from terminal input (e.g., `'S'` not `'s'`)
- Git commands need relative paths when using `-C workspaceRoot`
- `renderer.width`/`renderer.height` are getters, not `getSize()`

## Tmux Compatibility Issues (December 16, 2025)

### Problem: Inline Diff Freeze in Tmux
When viewing inline git diffs in tmux, Ultra would freeze (terminal hangs, no response to input).

**Root Cause Identified:**
- Blocking `process.stdout.write()` in `src/ui/renderer.ts:152`
- Inline diff rendering generates 20-50KB of ANSI escape sequences per frame
- Each `drawStyled()` call adds: cursor positioning + fg color + bg color + text + reset codes
- Tmux's terminal emulation can't process output fast enough, causing stdout to block
- This blocked the entire event loop, freezing keyboard and mouse input

**Fixes Applied (src/ui/renderer.ts:151-160):**
```typescript
// Changed from single write to chunked writes
const chunkSize = 16384; // 16KB chunks
for (let i = 0; i < this.outputBuffer.length; i += chunkSize) {
  const chunk = this.outputBuffer.substring(i, i + chunkSize);
  process.stdout.write(chunk);
}
```

**Optimization (src/ui/components/pane.ts:798-806):**
Reduced ANSI escape sequences by combining border + content draws when they share background:
```typescript
if (lineBg === bgColor) {
  // Border and content have same background - combine into one call
  ctx.drawStyled(x, screenY, '│' + displayLine, lineFg, lineBg);
} else {
  // Different backgrounds - need separate calls
  ctx.drawStyled(x, screenY, '│', borderColor, bgColor);
  ctx.drawStyled(x + 1, screenY, displayLine, lineFg, lineBg);
}
```

**Result:** Keyboard input now works in tmux after viewing inline diff.

### Problem: Mouse Scroll Not Working in Inline Diff (Tmux)
Mouse wheel events over inline diff don't scroll the content.

**Root Cause Identified:**
- `handleInlineDiffMouseEvent()` handles `MOUSE_WHEEL_UP/DOWN` events (pane.ts:1304-1315)
- Updates `inlineDiff.scrollTop` but doesn't trigger re-render
- The scroll value changes internally but screen never updates

**Fix Applied (src/ui/components/pane.ts:1306, 1314):**
```typescript
case 'MOUSE_WHEEL_UP':
  this.inlineDiff.scrollTop = Math.max(0, this.inlineDiff.scrollTop - 3);
  if (this.onScrollCallback) this.onScrollCallback(0, -3);  // Trigger render
  return true;

case 'MOUSE_WHEEL_DOWN':
  this.inlineDiff.scrollTop = Math.min(
    Math.max(0, this.inlineDiff.diffLines.length - this.inlineDiff.height + 2),
    this.inlineDiff.scrollTop + 3
  );
  if (this.onScrollCallback) this.onScrollCallback(0, 3);  // Trigger render
  return true;
```

**Status:** Fix applied but **still not working** - needs further investigation.

**Next Steps to Debug:**
1. Check if mouse events are being received in tmux at all
   - Add debug logging to `handleInlineDiffMouseEvent()`
   - Check if `MOUSE_WHEEL_UP/DOWN` events reach the handler
2. Verify tmux mouse mode is enabled properly
   - Check terminal escape sequences for mouse tracking (SGR mode)
   - Test if other mouse events work (clicks, scrolling in main editor)
3. Check if position detection is correct
   - `inlineDiffScreenStart` and bounds checking may be off in tmux
   - Log event coordinates vs calculated diff area bounds
4. Alternative: keyboard scrolling works (`j/k` keys) - maybe good enough?

**Mouse Event Flow:**
```
terminal/input.ts (parseSGRMouse)
  → app.ts (convertMouseEvent)
  → mouseManager.processEvent()
  → pane.handleEditorMouseEvent()
  → pane.handleInlineDiffMouseEvent()
```

### Problem: Dialog/Modal Flickering Over Sidebar (December 16, 2025)

When command palette, file browser, or other modal dialogs were shown, the sidebar would flicker (briefly appear and disappear repeatedly).

**Root Cause:**
1. **Frequent renders**: Git status polling runs every 100ms (`git.statusInterval: 100`) and calls `renderer.scheduleRender()` each time (app.ts:3308)
2. **Chunked stdout writes**: Renderer breaks each frame into 16KB chunks (renderer.ts:151-160) to prevent tmux blocking
3. **Partial frame visibility**: Terminal displays chunk 1 (sidebar) before chunk 2 (modal overlay) arrives
4. **Dialogs centered over full screen**: Modals were positioned over the entire screen width, overlapping the sidebar

**Solution Applied:**
Center all modal dialogs over the **editor area** instead of the full screen, avoiding sidebar overlap entirely.

**Changes Made:**
- Updated dialog positioning logic in:
  - `src/ui/components/command-palette.ts` - `show()` and `showWithItems()` methods
  - `src/ui/components/file-browser.ts` - `show()` method
  - `src/ui/components/file-picker.ts` - `show()` method
  - `src/ui/components/input-dialog.ts` - `show()` method
  - `src/ui/components/save-browser.ts` - `show()` method
- All dialog `.show()` methods now accept optional `editorX` and `editorWidth` parameters
- Updated all call sites in `src/app.ts` to pass `layoutManager.getEditorAreaRect()` coordinates
- Dialogs now calculate center position as: `editorX + editorWidth / 2` instead of `screenWidth / 2`

**Pattern for Future Dialogs:**
```typescript
// In dialog component:
show(..., editorX?: number, editorWidth?: number): void {
  const centerX = editorX !== undefined && editorWidth !== undefined
    ? editorX + Math.floor(editorWidth / 2)
    : Math.floor(screenWidth / 2);
  this.x = centerX - Math.floor(this.width / 2) + 1;
}

// In app.ts command handler:
const editorRect = layoutManager.getEditorAreaRect();
dialog.show(..., editorRect.x, editorRect.width);
```

**Result:** Dialogs no longer overlap the sidebar, eliminating the flickering caused by frequent re-renders painting the sidebar between dialog chunks.

## Important Patterns

### Terminal Key Events
```typescript
// Keys come as uppercase from terminal/input.ts
event.key = 'S'  // not 's'
event.ctrl = true/false
event.char = 's' // original character
```

### Theme Colors
```typescript
const colors = themeLoader.getCurrentTheme()?.colors || {};
const color = colors['editorGutter.addedBackground'] || '#4ec994';
```

### Git Integration
```typescript
// Always convert absolute to relative paths for git commands
const relativePath = filePath.startsWith(this.workspaceRoot)
  ? filePath.substring(this.workspaceRoot.length + 1)
  : filePath;
await $`git -C ${this.workspaceRoot} checkout -- ${relativePath}`.quiet();
```

### Renderer API
```typescript
renderer.width      // getter, not method
renderer.height     // getter, not method
renderer.scheduleRender()
ctx.drawStyled(x, y, text, fg, bg)
ctx.buffer(output)  // for raw ANSI strings
```

### Callbacks Pattern
Components use callback setters:
```typescript
gitPanel.onCommitRequest(() => { ... });
paneManager.onInlineDiffStage(async (filePath, line) => { ... });
```

### Arrow Key Navigation Flow
```typescript
// Arrow key press handling:
terminal/input.ts parseArrowKey()
  → app.ts handleKeyDown()
  → app.ts command handlers (ultra.cursorUp, ultra.cursorDown, etc.)
  → paneManager.moveCursor(direction)
  → document.moveCursor(direction)  // Updates cursor position
  → paneManager.ensureCursorVisible()
  → pane.ensureCursorVisible()  // Should scroll viewport to show cursor
  → pane.onScrollCallback()  // Triggers re-render if scrolling occurred
```

### Debug Logging Pattern
```typescript
// Enable debug logging globally
import { debugLog, setDebugEnabled } from './debug.ts';

// In app initialization:
if (options?.debug) {
  setDebugEnabled(true);
  // Clear previous debug log
  const fs = require('fs');
  fs.writeFileSync('debug.log', '');
}

// In component code:
debugLog(`[Component ${this.id}] operation: value=${value}`);
```

### Scrolling with Render Callback
When updating scroll position, always trigger a re-render:
```typescript
this.scrollTop = newScrollTop;
if (this.onScrollCallback) {
  this.onScrollCallback(deltaX, deltaY);  // Triggers renderer.scheduleRender()
}
```

## Anti-Patterns to Avoid

### DON'T: Access Cursor Properties Directly
```typescript
// ❌ WRONG: Accessing .line and .column may return undefined
const cursor = doc.primaryCursor;
if (cursor.line < this.scrollTop) {
  // This will fail if cursor.line is undefined
}
```

**Problem:** `doc.primaryCursor.line` and `doc.primaryCursor.column` can return undefined, breaking comparison logic.

**Investigation Needed:** Check if there's a method like `cursor.getPosition()` or if cursor needs to be accessed differently.

### DON'T: Scroll Without Triggering Re-render
```typescript
// ❌ WRONG: Updates state but screen never updates
this.scrollTop = newValue;
// Missing: this.onScrollCallback(0, delta);
```

**Solution:** Always invoke the scroll callback after changing scroll position to schedule a render.

### DON'T: Block stdout with Large Writes
```typescript
// ❌ WRONG: Single large write can block event loop in tmux
process.stdout.write(largeOutputBuffer);  // 50KB+
```

**Solution:** Break into chunks (16KB) to prevent terminal emulation blocking:
```typescript
const chunkSize = 16384;
for (let i = 0; i < buffer.length; i += chunkSize) {
  const chunk = buffer.substring(i, i + chunkSize);
  process.stdout.write(chunk);
}
```

### DON'T: Center Dialogs Over Full Screen
```typescript
// ❌ WRONG: Dialog flickers over sidebar with frequent renders
const centerX = Math.floor(renderer.width / 2);
```

**Solution:** Center dialogs over editor area only to avoid sidebar overlap:
```typescript
const editorRect = layoutManager.getEditorAreaRect();
const centerX = editorRect.x + Math.floor(editorRect.width / 2);
```

### DON'T: Use Lowercase for Terminal Key Events
```typescript
// ❌ WRONG: Terminal input provides uppercase
if (event.key === 's' && event.ctrl) {
```

**Solution:** Keys from terminal/input.ts are uppercase:
```typescript
if (event.key === 'S' && event.ctrl) {
  // Use event.char if you need lowercase
}
```

## Settings (config/default-settings.json)
- `git.diffContextLines`: Lines of context in diff (default: 3)
- `ultra.sidebar.width`: Sidebar width
- `terminal.integrated.defaultHeight`: Terminal height

## Keybindings (config/default-keybindings.json)
- `ctrl+shift+g`: Toggle git panel
- `ctrl+alt+d`: Show git diff at cursor
- Standard VS Code-like bindings for most operations

## File Locations

### When Adding Features
1. **New component**: `src/ui/components/`
2. **New command**: Register in `App.registerCommands()` in `app.ts`
3. **New keybinding**: Add to `config/default-keybindings.json`
4. **New setting**: Add to `config/default-settings.json`

### Key Files to Know
- `src/app.ts`: Main orchestrator, command registration, event handlers
- `src/ui/components/pane.ts`: Editor pane (rendering, git gutter, inline diff)
- `src/features/git/git-integration.ts`: All git CLI operations
- `src/terminal/input.ts`: Keyboard/mouse input parsing
- `src/ui/renderer.ts`: Terminal output management

## Build & Run
```bash
bun run build.ts    # Compile to ./ultra
./ultra [file]      # Run editor
```

## Debug
- Debug log writes to `debug.log` in working directory
- Use `this.debugLog()` in App class
- Crash logs show in `debug.log` with stack traces


**Next Steps:**
1. Investigate Document class (`src/core/document.ts`) and Cursor class to understand why `primaryCursor` properties are undefined
2. Determine correct API for accessing cursor position
3. Fix the property access or cursor implementation
4. Verify viewport scrolling works after fix

## Current State
- Git integration fully working (status, stage, unstage, revert, commit)
- Inline diff viewer complete with keyboard and mouse support
- File tree and git panel can coexist in sidebar
- Commit uses modal dialog instead of inline input

## Known Quirks
- Git gutter compares to HEAD, so staged changes still show as "changed"
- Revert now handles both staged and unstaged (reset + checkout)
- Must rebuild after any TypeScript changes (`bun run build.ts`)
