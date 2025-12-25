# Claude Issues - Cursor Position in AITerminalChat

## Problem Summary

The cursor is not visible in the correct position for Claude Code and Gemini CLI in the `AITerminalChat` element. Codex works correctly.

## Affected Files

- `src/clients/tui/elements/ai-terminal-chat.ts` - Cursor rendering logic (lines ~392-403)
- `src/terminal/screen-buffer.ts` - ANSI parser and cursor tracking

## What We Know

### Debug Log Analysis

From analyzing `debug.log`, we observed:

1. **Cursor position alternates rapidly** between two positions:
   - Content position (e.g., `x=21, y=54` or `x=135, y=54`)
   - Bottom-left position (e.g., `x=0, y=56`)

2. **DECTCEM (cursor visibility) is always OFF** for Claude/Gemini:
   ```
   cursor: x=0, y=56, visible=false, provider=claude-code, shouldDraw=false
   cursor: x=135, y=54, visible=false, provider=claude-code, shouldDraw=false
   ```

3. **setCursor repeatedly sets column to 1**:
   ```
   setCursor: (49,1) -> internal (48,0) [was (48,0)]
   setCursor: (46,1) -> internal (45,0) [was (45,0)]
   ```

### Technology Stack

Both Claude Code and Gemini CLI use **ink** (React-based TUI framework):
- Claude Code: TypeScript + ink
- Gemini CLI: Uses `npm:@jrichman/ink@6.4.6` (custom fork)

Ink manages its own rendering cycle and cursor positioning. It hides the terminal cursor (DECTCEM off) and draws its own cursor using styled characters.

## What We Tried

1. **Idle detection** - Wait 50ms after last PTY data before showing cursor
   - Result: Cursor flickered in bottom-left corner
   - Problem: Cursor position ends up at (0, bottom) after ink's redraw cycle

2. **Respecting DECTCEM** - Only show cursor when `cursorVisible=true`
   - Result: Cursor never shown
   - Problem: Claude/Gemini NEVER set cursor visible

3. **Finding end of content** - Scan last row for content and put cursor there
   - Result: Wrong position
   - Problem: Input field isn't always on the last content row

4. **Using PTY cursor position directly** - Just render at `cursor.x, cursor.y`
   - Result: Cursor at bottom of buffer
   - Problem: PTY cursor position doesn't represent input location

## Root Cause Analysis

Ink-based TUI applications like Claude Code and Gemini CLI:

1. **Hide the terminal cursor** (DECTCEM off) during their entire operation
2. **Manage their own cursor display** using styled characters (inverse text, block chars)
3. **Move the terminal cursor around for drawing** but don't leave it at the input position
4. **Redraw the entire screen** on each update cycle

The terminal cursor position we track is an artifact of ink's rendering, not the logical input position. Ink probably uses sequences like:
- Position cursor at start of row
- Draw content (cursor advances)
- Position cursor elsewhere for next draw operation
- The "input cursor" is drawn as a styled character, not the terminal cursor

## Potential Solutions

1. **Detect ink's cursor character** - Look for inverse-styled characters or block characters (█, ▌, etc.) in the buffer and don't overlay our cursor

2. **Track cursor position during specific events** - The cursor might be positioned correctly right after user input is echoed, not during output

3. **Use a heuristic for the input row** - Claude/Gemini typically show an input prompt. Detect the prompt pattern and position cursor after it

4. **Don't show cursor for ink-based tools** - Accept that ink handles its own cursor and don't draw ours

5. **Parse ink's output more intelligently** - Understand ink's rendering model and extract the logical cursor position

## Code References

Current cursor rendering in `ai-terminal-chat.ts`:
```typescript
// Draw cursor at PTY cursor position for all providers.
// Ink-based tools (Claude/Gemini) position the cursor at the input location
// when the user is typing. We just need to render it there.
if (this.focused && viewOffset === 0 &&
    cursor.y < height && cursor.x < contentWidth) {
  const cursorCell = buffer.get(x + cursor.x, y + cursor.y);
  buffer.set(x + cursor.x, y + cursor.y, {
    char: cursorCell?.char ?? ' ',
    fg: defaultBg,
    bg: cursorBg,
  });
}
```

## Why Codex Works

Codex likely doesn't use ink or uses a simpler terminal interface that:
- Keeps the terminal cursor at the input position
- Doesn't hide the cursor (or shows it when waiting for input)
- Uses standard readline-style input handling
