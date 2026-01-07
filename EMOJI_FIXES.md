# Emoji Rendering Fixes - Status and Analysis

## Problem Statement

Emoji characters in the editor cause rendering artifacts:
1. Characters at the end of lines with emojis render intermittently when scrolling
2. Example: Line 53 of CLAUDE_FEEDBACK.md - the "n" in "connection" flickers when scrolling
3. Example: Line 82 of CLAUDE_FEEDBACK.md - the "L" in "SQL" flickers when scrolling
4. After attempted fixes: Content from other tabs is now bleeding through

## Technical Background

### Wide Character Handling

Emojis like ✅ (U+2705) are "wide characters" that occupy 2 terminal cells. The rendering system must:
1. Write the emoji to cell N
2. Write a placeholder (empty string) to cell N+1
3. Advance cursor by 2

### Variation Selectors

Some emojis include invisible variation selectors (U+FE0F) that modify display. These are zero-width and should not occupy any cell space.

## Files Involved

### Terminal Layer (PTY output)
- `src/terminal/ansi.ts` - `getCharWidth()` function for character width calculation
- `src/terminal/screen-buffer.ts` - `writeChar()` for PTY buffer, `ScreenBuffer` class

### TUI Rendering Layer
- `src/clients/tui/rendering/buffer.ts` - `ScreenBuffer` class with `writeString()`, `getCharDisplayWidth()`
- `src/clients/tui/rendering/renderer.ts` - `buildOutput()` renders buffer to terminal

### Element Rendering
- `src/clients/tui/elements/ai-terminal-chat.ts` - Renders PTY buffer to TUI buffer
- `src/clients/tui/elements/terminal-session.ts` - Renders PTY buffer to TUI buffer
- `src/clients/tui/elements/document-editor.ts` - Renders document content to TUI buffer

## Changes Made (Current State)

### 1. Added zero-width character detection

In `src/terminal/ansi.ts` and `src/clients/tui/rendering/buffer.ts`, added handling for:
- Variation Selectors (U+FE00-U+FE0F)
- Zero-width space/joiners (U+200B-U+200F)
- Combining diacritical marks (U+0300-U+036F)
- And other zero-width ranges

```typescript
// Zero-width characters return 0
if (
  (code >= 0x200B && code <= 0x200F) ||   // Zero-width space, joiners
  (code >= 0xFE00 && code <= 0xFE0F) ||   // Variation Selectors
  (code >= 0x0300 && code <= 0x036F) ||   // Combining marks
  // ... more ranges
) {
  return 0;
}
```

### 2. Skip zero-width chars in writeString

In `src/clients/tui/rendering/buffer.ts`:
```typescript
for (const char of text) {
  const charWidth = getCharDisplayWidth(char);
  if (charWidth === 0) {
    continue;  // Skip zero-width characters
  }
  // ... write character
}
```

### 3. Skip placeholder cells in terminal rendering

In `src/clients/tui/elements/ai-terminal-chat.ts` and `terminal-session.ts`:
```typescript
if (cell?.char === '') {
  continue;  // Skip placeholder cells
}
```

### 4. Skip placeholder cells in renderer output

In `src/clients/tui/rendering/renderer.ts`:
```typescript
if (cell.char === '') {
  lastX = x;
  lastY = y;
  continue;  // Skip but track position
}
```

## Current Issues

1. **Intermittent character rendering** - Characters at end of lines with emojis still flicker when scrolling
2. **Tab bleed-through** - Content from other tabs is now bleeding through (NEW ISSUE after changes)

## Suspected Root Causes

### Theory 1: Dirty Tracking Issue
When placeholder cells are skipped in the renderer, the dirty tracking may not properly mark cells that need to be redrawn, causing stale content to show.

### Theory 2: Cursor Position Mismatch
The terminal's actual cursor position after writing a wide character may not match what the renderer expects, causing subsequent characters to be written at wrong positions.

### Theory 3: Cell Comparison Issue
The `cellsEqual()` function may consider certain cells equal when they shouldn't be, preventing dirty marking.

### Theory 4: Double-Buffering Issue
The ScreenBuffer uses dirty tracking to minimize redraws. When cells change (especially around wide characters), the dirty region calculation may be incorrect.

## Rendering Pipeline

1. **Content Source** (Document, PTY buffer)
2. **Element Render** (document-editor.ts, ai-terminal-chat.ts)
   - Calls `buffer.writeString()` or `buffer.set()`
3. **TUI ScreenBuffer** (buffer.ts)
   - Tracks dirty cells, stores cell grid
4. **Renderer** (renderer.ts)
   - Gets dirty cells, builds ANSI output string
5. **Terminal Output** (process.stdout.write)

## Questions to Investigate

1. Is the placeholder cell (char='') being properly handled in all code paths?
2. When scrolling, how are dirty cells determined? Is the entire viewport marked dirty?
3. Could the tab bleed-through be caused by cells not being marked dirty when they should be?
4. Should placeholder cells be rendered as spaces instead of being skipped?
5. Is there a race condition between buffer updates and rendering?

## Suggested Next Steps

1. **Revert placeholder skipping** - Try rendering placeholders as spaces instead of skipping
2. **Force full redraw on scroll** - Mark entire viewport dirty when scrolling
3. **Debug logging** - Add logging to track which cells are dirty vs rendered
4. **Check cellsEqual()** - Verify placeholder cells are compared correctly
5. **Terminal compatibility** - Test if issue is terminal-specific (iTerm2, Terminal.app, etc.)

## Test Cases

```
Line with emoji at start: ✅ FIXED - Some text here
Line with emoji in middle: Status ✅ confirmed today
Line with multiple emojis: ✅ Done ⏸️ Paused ❌ Failed
```

## Relevant Code Locations

- Character width: `src/terminal/ansi.ts:195-260`
- TUI buffer writeString: `src/clients/tui/rendering/buffer.ts:199-265`
- Renderer buildOutput: `src/clients/tui/rendering/renderer.ts:200-232`
- AI chat render: `src/clients/tui/elements/ai-terminal-chat.ts:377-422`
- Terminal session render: `src/clients/tui/elements/terminal-session.ts:804-822`

## Codex January 2025 Analysis

### Placeholder cells never clear the physical terminal
- `ScreenBuffer.writeString` (`src/clients/tui/rendering/buffer.ts:202-264`) and the PTY screen buffer (`src/terminal/screen-buffer.ts:178-225`) now insert placeholder cells (`char === ''`) for the trailing half of every wide glyph. Those cells are marked dirty so the renderer can repaint them.
- Every downstream consumer immediately skips placeholders:
  * `renderer.buildOutput` at `src/clients/tui/rendering/renderer.ts:200-234`
  * PTY → TUI copies in `src/clients/tui/elements/ai-terminal-chat.ts:377-398`
  * PTY sessions in `src/clients/tui/elements/terminal-session.ts:788-817`
- Because we skip them, the second column of a wide emoji is never actually written to stdout. The buffer believes that column now contains a blank, so `clearDirty()` resets the flag, but the terminal still shows whatever glyph used to live there. That explains both current symptoms:
  * “Tab bleed-through” happens because a new tab fills the buffer with placeholders, but those cells never reach the terminal, so the previous tab’s glyphs remain visible.
  * The flickering characters in `CLAUDE_FEEDBACK.md` occur when a line with a wide emoji scrolls past an older frame—the placeholder column alternates between “old glyph from the previous frame” and “blank”, producing a strobe.
- **Fix**: render placeholders as actual spaces instead of skipping them.
  * In the renderer: when `cell.char === ''`, still move the cursor, run `transitionStyle`, and emit `' '` (or another erase character) so the underlying cell is cleared. Keep updating `lastX/lastY` so adjacency logic still works.
  * In the PTY element renderers: stop `continue`‑ing when a PTY cell has `char === ''`; call `buffer.set` with `' '` so the TUI buffer contains a real glyph. That guarantees later diffing will repaint the column even if someone forgets to handle placeholders downstream.
  * Add a regression that renders a PTY buffer containing `A✅B`, flushes twice, and asserts that the column immediately after the emoji contains a space on every frame (no lingering `B`).

### Char-width tables have diverged
- The PTY stack uses `getCharWidth` (`src/terminal/ansi.ts:195-258`), which explicitly marks symbols like ⏸ (U+23F8) as double-width. The TUI stack uses `getCharDisplayWidth` (`src/clients/tui/rendering/buffer.ts:26-78`), which only covers a subset of emoji ranges and treats the same glyph as width 1.
- When the document renderer sees ⏸️, it allocates a single cell and never writes a placeholder, while the terminal still draws the glyph across two columns. Everything after the emoji appears to “drift” or flicker because TUI and PTY disagree about how many cells were consumed.
- **Fix**:
  1. Consolidate the width logic: export one helper (or move the PTY implementation to a shared module) and use it everywhere we compute glyph widths.
  2. Expand the TUI table immediately so it at least mirrors the PTY logic (include U+23F8, media symbols, etc.). Until both layers agree, we’ll keep chasing phantom alignment bugs.
  3. Add unit coverage that asserts `getCharDisplayWidth('⏸️') === getCharWidth('⏸️') === 2` and that zero-width modifiers still report 0.

### Additional recommendations
1. Once placeholders render as spaces, add an integration test that switches tabs containing emoji-rich buffers to ensure no stale glyphs persist.
2. When scrolling PTY-backed panes, mark the whole viewport dirty once (cheap full redraw) so we’re not relying on per-cell dirty tracking to clean up missed placeholders.
3. Consider tagging placeholder cells (`placeholder: true`) so future optimizations can distinguish “second half of a wide glyph” from “user-typed space” without abusing `char === ''`.

## Gemini Analysis (January 2026)

### 1. Root Cause: Placeholder Skipping (The "Ghosting" Effect)
The current implementation of the rendering pipeline in `src/clients/tui/rendering/renderer.ts` and various element renderers (e.g., `ai-terminal-chat.ts`) contains logic to explicitly `continue` or skip cells where `char === ''`. 

*   **Mechanism:** When a wide character (like an emoji) is written to the `ScreenBuffer`, it occupies two cells. The first cell contains the glyph, and the second is a "placeholder" cell with an empty string. 
*   **The Bug:** Because the renderer skips these placeholder cells, it never sends any data to the physical terminal for that column. The internal buffer correctly believes the cell is "blank" (part of a wide glyph), but the terminal emulator continues to display whatever character was previously in that position. 
*   **Result:** This explains the "tab bleed-through"—when switching tabs, the placeholders in the new tab fail to "overwrite" the old characters from the previous tab. It also explains the flickering during scrolling, as the terminal's state and the application's buffer state are constantly out of sync.

### 2. Root Cause: Divergent Width Tables
There is a significant discrepancy between `getCharWidth` in `src/terminal/ansi.ts` and `getCharDisplayWidth` in `src/clients/tui/rendering/buffer.ts`. 

*   **Observation:** The TUI stack's version (`buffer.ts`) is a simplified implementation that lacks many Unicode ranges (media symbols, specific Dingbat ranges, etc.) that the PTY stack (`ansi.ts`) correctly identifies as double-width.
*   **Result:** When the TUI thinks a character is width 1 but the terminal draws it as width 2, the cursor position becomes "drifted" for the remainder of that line. This causes characters at the end of the line to appear at the wrong offset or disappear entirely.

### Proposed Solution (Implementation Plan)

#### A. Unify Character Width Logic
1.  **Shared Utility:** Extract the comprehensive logic from `getCharWidth` (`src/terminal/ansi.ts`) into a new shared utility file: `src/core/char-width.ts`.
2.  **Single Source of Truth:** Update both `src/terminal/ansi.ts` and `src/clients/tui/rendering/buffer.ts` to import and use this shared function. This ensures that the PTY buffer and the TUI buffer always agree on the "geometry" of the text.

#### B. Explicitly Render Placeholders as Spaces
1.  **Update Renderer:** Modify `src/clients/tui/rendering/renderer.ts`. Instead of `continue` when encountering `cell.char === ''`, the renderer must:
    *   Advance the `lastX` and `lastY` tracking.
    *   Emit an actual space (`' '`) to the terminal. This "clears" the ghost character from the terminal's memory.
2.  **Update Element Copying:** In `ai-terminal-chat.ts` and `terminal-session.ts`, ensure that when copying the PTY buffer to the TUI `ScreenBuffer`, placeholders are not skipped. They should be stored in the TUI buffer as is (or converted to spaces) so that the `Renderer` can see them and act on them.

#### C. Validation
1.  **Regression Test:** Create a unit test that writes a string containing wide emojis to a `ScreenBuffer` and asserts that the resulting cell array contains the correct number of placeholders.
2.  **Rendering Test:** Mock the terminal output and verify that the `Renderer` produces an explicit space for every placeholder cell following a wide character.