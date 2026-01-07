# Ultra 1.0 Backlog

Issues and improvements to address in future sessions.

## TUI

- [ ] **AITerminalChat two spaces after emoji** - In the AI terminal chat (Claude Code, etc.), there are two spaces rendered after emoji characters like ● (bullet), ✅ (checkbox), etc. The underlying issue is a mismatch between our character width calculations and how the terminal actually renders these characters. Current state:
  - Character leakage/artifacts when scrolling: FIXED
  - Document editor emoji rendering: FIXED
  - Wide emoji (✅, ❌) rendering: FIXED
  - Extra space after bullets in AITerminalChat: NOT FIXED
  - Root cause: After writing a non-ASCII character, we invalidate cursor position to force repositioning for the next character. This prevents misalignment but results in an extra space being visible.
  - Potential solutions: Terminal-specific width detection, or accepting the visual quirk for now.

- [ ] **Git panel hint bar truncation** - The keyboard shortcut hints at the bottom of the git panel are truncated to fit narrow widths. Need a better solution that either:
  - Dynamically shows fewer hints based on available width
  - Uses abbreviated key names (e.g., `s` instead of `s:stage`)
  - Shows hints in a tooltip/overlay on hover or key press
  - Scrolls horizontally or wraps to additional lines

- [ ] **Consolidate list item selection rendering** - Both `FileTree` and `GitPanel` have similar logic for rendering selected items with active/inactive backgrounds. Consider:
  - Adding a helper method to `BaseElement` for list item colors
  - Creating a `ListElement` base class with shared selection rendering
  - Extracting theme color constants for list selection states

- [ ] **Double-click file opening delay** - There is a noticeable delay when double-clicking a file to open it from either the file tree or git panel. Investigate and optimize the file opening path. This is also present when opening the app and files are reopened from the previous session.

- [x] **Chord keybinding support** - Chord keybindings (e.g., `ctrl+k ctrl+c` for comment) are now supported:
  - Detects partial chord and waits for next key (500ms timeout)
  - Shows visual indicator in status bar (e.g., "ctrl+k ...")
  - Clears status when chord completes or times out
  - Default chords: ctrl+k ctrl+c/u (comment/uncomment), ctrl+k ctrl+0/j (fold all/unfold all), ctrl+k ctrl+s/o (session save/open)

- [x] **Auto-indent** - Smart auto-indentation when pressing Enter:
  - Maintains current line's indentation by default
  - Increases indent after `{`, `[`, `(`, `:`, arrow functions, etc.
  - Between brackets (e.g., `{|}`): creates indented line with closing bracket below
  - Tab key respects `editor.tabSize` and `editor.insertSpaces` settings
  - Configurable via `editor.autoIndent`: `'none'`, `'keep'`, or `'full'`

- [x] **Shift+click selection not working** - Fixed. The issue was that double/triple click detection was checked BEFORE shift/ctrl modifiers, so a fast shift+click would trigger word selection instead of extending selection. Now modifiers are checked first, so:
  - Shift+click always extends selection (regardless of click speed)
  - Ctrl+click always adds a cursor (regardless of click speed)
  - Double/triple click only triggers for plain clicks without modifiers

- [ ] **Select block / Duplicate block** - Add commands for selecting and duplicating code blocks:
  - `ctrl+b` - Select the code block containing the cursor (expand selection to matching brackets/braces)
  - `ctrl+b d` (chord) - Duplicate the selected block
  - Requires detecting block boundaries (matching `{}`, `[]`, `()`)
  - Should handle nesting levels to progressively expand selection
  - Consider language-specific block semantics (functions, classes, etc.)

- [ ] **Kitty terminal ctrl+shift+key conflicts** - Kitty terminal has default shortcuts that intercept ctrl+shift+p, ctrl+shift+k, etc. before they reach the application. The first keypress is consumed by Kitty, and only subsequent presses get through. Solutions:
  - Document that users need to unbind these in Kitty config (`map ctrl+shift+p no_op`)
  - Consider alternative default keybindings that don't conflict with Kitty
  - Detect Kitty terminal and show a warning/hint about configuring shortcuts

- [x] **Undo/redo not working** - Undo/redo is now fully functional:
  - Ctrl+Z for undo, Ctrl+Shift+Z or Ctrl+Y for redo
  - Operation-based undo system tracks insert/delete operations
  - Time-based grouping (300ms) merges consecutive operations
  - Multi-cursor support in undo/redo
  - Undo history persists across session restarts
  - Configurable history limit via `editor.undoHistoryLimit` setting

- [ ] **Additional file watch modes** - The `files.watchFiles` setting currently supports `'onFocus'` and `'off'`. Add additional modes:
  - `'visible'` - Watch all documents that are currently visible (focused + visible in other panes). This handles multi-pane workflows where you edit in one pane and see results in another.
  - `'always'` - Watch all open documents continuously using fs watchers. Higher system overhead but provides instant updates.
  - For `'visible'` mode, need to track which documents are currently rendered on screen across all panes
  - For `'always'` mode, add/remove fs.watch watchers as documents are opened/closed

- [ ] **Terminal tabs cursor handling with multiple terminals** - When there is more than one terminal tab, cursor handling doesn't work properly. Each terminal session has its own PTY with its own cursor state, but switching tabs may not properly update cursor visibility/position. Investigate:
  - Whether cursor state is preserved when switching between terminal tabs
  - If the active terminal's cursor is being rendered correctly
  - Whether inactive terminals are incorrectly showing or affecting cursor state

- [ ] **Sidebar accordion state flash on load** - When restoring a session, the sidebar briefly shows the default accordion state (all panels expanded) before applying the saved state. This happens because sidebar initialization runs before session restore. To fix:
  - Option 1: Defer first sidebar render until session state is known
  - Option 2: Pass saved accordion state to sidebar initialization
  - Option 3: Initialize all accordion sections as collapsed until session loads

- [ ] **Save terminal buffer to session** - Currently, terminal sessions in panes are restored but start fresh (empty buffer). Consider saving and restoring the terminal scrollback buffer so users can see previous output after restarting. This would require:
  - Serializing the terminal buffer (scrollback + visible) to session state
  - Handling potentially large buffer sizes (compression or truncation)
  - Restoring buffer content when recreating the terminal session

- [ ] **oh-my-zsh terminal compatibility** - The embedded terminal doesn't work correctly with oh-my-zsh. Symptoms: blank prompt, no input echo (though commands execute). The issue is that oh-my-zsh uses zsh's line editor (zle) which relies on terminal escape sequences our ANSI parser doesn't fully support. Starship alone works fine. To fix:
  - Implement scroll regions (CSI r - DECSTBM)
  - Add more DEC private modes (bracketed paste 2004, application cursor 1, etc.)
  - Possibly implement alternate screen buffer (mode 1049)
  - Test with various zsh frameworks (oh-my-zsh, prezto, zinit)

- [x] **File tree keyboard shortcuts and file operations** - The file tree now has keyboard shortcuts for common file operations:
  - `n` to create new file (inline input for name)
  - `N` (shift+n) to create new folder
  - `r` or `F2` to rename file/folder (inline input)
  - `d` or `Delete` to delete file/folder (with y/n confirmation)
  - `Enter` or `Space` to open file / expand folder
  - Hint bar shows shortcuts when focused
  - Dialog input appears at bottom and handles Escape to cancel

- [x] **Terminal and editor scroll-up boundary jitter** - Mostly fixed by only triggering re-renders when scroll position actually changes. Previously, scroll events at boundaries would still call `markDirty()` even when scroll position was clamped and unchanged, causing unnecessary re-renders. Note: Very fast touchpad scrolling at the top boundary may still cause minor jitter - this appears to be related to terminal emulator behavior with rapid scroll events rather than application rendering.

- [ ] **AI terminal chat cursor position incorrect for Claude/Gemini** - The cursor is not visible for Claude Code and Gemini CLI in AITerminalChat. Codex works correctly. Both Claude and Gemini use **ink** (React-based TUI framework) which hides the terminal cursor (DECTCEM off) and draws its own cursor as styled characters. Multiple approaches were tried without success. **See [CLAUDE_ISSUES.md](./CLAUDE_ISSUES.md) for full details.** Summary of attempts:
  - Idle detection (50ms wait) - cursor flickered at wrong position
  - DECTCEM gating - cursor never shown (ink always hides it)
  - End-of-content detection - wrong position
  - PTY cursor position directly - cursor at bottom of buffer
  - Skip cursor overlay via `usesInkCursor()` hook - ink's cursor still not visible

  Possible root causes to investigate:
  - Our ANSI parser may strip SGR attributes that make ink's cursor visible
  - Ink's cursor character may need specific terminal capabilities we don't support
  - May need to inspect ink's actual escape sequences in a real terminal

- [ ] **Hover on mouse position** - Add automatic hover tooltip when mouse hovers over a symbol for a configurable duration. Requires:
  - Mouse position tracking in DocumentEditor
  - Debounced hover request (e.g., 500ms delay)
  - Setting to enable/disable auto-hover
  - Setting for hover delay duration

- [x] **Squiggly underlines for diagnostics** - Instead of simple underlines, implement VS Code-style squiggly/wavy underlines for errors and warnings. This is more visually distinct but technically challenging in terminal.

- [x] **Find/Replace in files** - Implemented in-file search and replace:
  - Ctrl+F opens find dialog, Ctrl+H opens find and replace
  - Supports case sensitive, whole word, and regex search modes
  - Tab cycles through all focusable elements (fields, toggles, buttons)
  - Mouse click support for all interactive elements
  - Search matches highlighted in editor with current match distinction
  - Dialog positioned at top-right of active editor pane

- [ ] **Find dialog intermittent "not found"** - Sometimes entering a search string reports "No results" even when the text is clearly present in the document. Needs investigation:
  - May be related to regex escaping or search options state
  - Could be a timing issue with search execution
  - Check if query is being cleared or modified unexpectedly

- [x] **Inline diff expander enhancements** - Enhanced the inline diff viewer:
  - Configurable max height with scrolling (keyboard arrows, mouse wheel)
  - Action buttons for stage, revert (with confirmation), close
  - Keyboard shortcuts (s: stage, d: revert, Esc: close)
  - Syntax highlighting preserved inside diff view
  - Mouse click support for buttons

- [x] **Git line changes persist after save** - Fixed issue where gutter change indicators would persist after reverting changes and saving. Root cause was git diff cache not being invalidated after save. Now calls `gitCliService.invalidateCache()` before updating line changes.

- [ ] **Diagnostics panel** - A panel that lists all diagnostics (errors, warnings) for the current file or entire workspace:
  - Filterable by severity (errors, warnings, info, hints)
  - Clickable entries to jump to location
  - Shows file path, line number, message
  - Can be opened via command palette
  - Updates in real-time as diagnostics change

- [x] **PTY loading fails in bundled binary from different directory** - Resolved using IPC sidecar approach. The bundled binary spawns a child `bun` process that runs a PTY bridge script (`~/.ultra/pty-bridge.ts`). The bridge loads node-pty from `~/.ultra/node_modules` and communicates via stdin/stdout JSON messages. See PTY_ERROR.md for details.

## Services

### Database Service

- [ ] **Incremental query result streaming** - For very large result sets (100k+ rows), implement incremental streaming instead of pagination. This allows the UI to display results as they arrive rather than waiting for full page fetches. Requires:
  - Cursor-based result iteration in Postgres backend
  - WebSocket or Server-Sent Events for real-time row delivery to clients
  - Backpressure handling when UI can't keep up with data rate
  - Memory-efficient buffering (don't hold all rows in memory)
  - Integration with existing Paginator component (streaming as an alternative mode)
  - Consider using Postgres `COPY TO STDOUT` for maximum throughput

## ECP

## Testing

- [ ] **Session service test failures** - Multiple tests failing in `tests/integration/session.test.ts` and `tests/unit/services/session/local-session-service.test.ts`:
  - `session/delete` - "Session not found: named-delete-test"
  - `session/current` - Returns null instead of expected session state
  - `getCurrentSession returns session after init` - Returns null
  - `shutdown saves session` - Events array is empty, "saved" event not emitted
  - Root cause appears to be session initialization/lifecycle issues

- [ ] **Git panel test failures** - Tests failing in `tests/unit/clients/tui/elements/git-panel.test.ts`:
  - `Space stages/unstages file` - Returns null instead of expected path
  - `Ctrl+C commits` - Commit callback not triggered
  - May be related to mock setup or event handling changes

---

## Archived Features (from src/archived/)

Features identified from `src/archived/` that have not yet been reimplemented in the new TUI architecture. These should be migrated or reimplemented as part of the 1.0 effort.

### High Priority

#### MCP Server (Model Context Protocol)

**Source:** `src/archived/features/mcp/`

A JSON-RPC based server that exposes Ultra's functionality as tools for AI assistants (Claude Code, etc.) to use.

**Key Features:**
- Tool registration and execution framework
- Approval system for AI tool calls (once, session, always scopes)
- HTTP transport for communication with external AI clients
- Automatic MCP config file generation for Claude Code integration

**Files:**
- `mcp-server.ts` - Core MCP server with JSON-RPC handling
- `mcp-transport.ts` - HTTP transport layer
- `mcp-tools.ts` - Ultra-specific tool definitions
- `mcp-types.ts` - Type definitions

**Why Important:** Enables Ultra to be used as an MCP server for Claude Code, allowing AI to directly interact with the editor (open files, edit, navigate, run commands).

---

#### AI Integration Layer

**Source:** `src/archived/features/ai/ai-integration.ts`

Orchestrates AI features including MCP server management, AI chat pane management, and the approval system.

**Key Features:**
- MCP server lifecycle management
- Tool handler registration (getContext, openFile, readFile, editFile, etc.)
- AI chat instance management
- Approval persistence across sessions
- Command registration for AI features

**Dependencies:** Requires MCP Server implementation

---

#### AI Approval Dialog

**Source:** `src/archived/ui/components/ai-approval-dialog.ts`

Modal dialog for users to approve/deny AI tool calls with scope selection (once, session, always).

**Key Features:**
- Shows tool name and arguments for review
- Three approval scopes: once, session, always
- Visual display of what the AI wants to do
- Keyboard-driven interface

---

### Medium Priority

#### Project-Wide Search (ripgrep)

**Source:** `src/archived/features/search/project-search.ts`

**Status:** Interface defined, implementation placeholder (TODO in archived code)

Full-text search across project using ripgrep.

**Interface Defined:**
```typescript
interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  includePattern?: string;
  excludePattern?: string;
  maxResults?: number;
}
```

**Note:** The new TUI has `SearchResultBrowser` which may need this backend implementation.

---

### Implementation Notes

#### MCP Server Priority

The MCP Server should be the first backlog item implemented because:

1. **AI Integration Dependency:** The AI Integration layer depends on it
2. **Claude Code Compatibility:** Enables Ultra to work as an MCP server
3. **Existing Code Quality:** The archived implementation is complete and well-structured
4. **Architecture Alignment:** Fits naturally into the ECP/Services model

#### Recommended Migration Path

1. Move MCP types to `src/services/mcp/types.ts`
2. Move MCP server to `src/services/mcp/server.ts`
3. Create MCP transport adapter for new architecture
4. Implement AI approval dialog in new overlay system
5. Create AI integration service in `src/services/ai/`
6. Wire up to TUI client

---

### Components Already Reimplemented

| Archived Component | New TUI Equivalent | Status |
|-------------------|-------------------|--------|
| `command-palette.ts` | `overlays/command-palette.ts` | Done |
| `file-picker.ts` | `overlays/file-picker.ts` | Done |
| `settings-dialog.ts` | `overlays/settings-dialog.ts` | Done |
| `git-panel.ts` | `elements/git-panel.ts` | Done |
| `commit-dialog.ts` | `overlays/commit-dialog.ts` | Done |
| `search-widget.ts` | `overlays/search-replace.ts` | Done |
| `file-tree.ts` | `elements/file-tree.ts` | Done |
| `terminal-pane.ts` | `elements/terminal-session.ts` | Done |
| `ai-panel.ts` | `elements/ai-terminal-chat.ts` | Done |
| `minimap.ts` | `elements/document-editor.ts` | Integrated |
| `save-browser.ts` | `overlays/save-as-dialog.ts` | Done |
| `status-bar.ts` | `components/status-bar.ts` | Done |
| `tab-bar.ts` | `components/tab-bar.ts` | Done |

*Analysis performed on 2024-12-24*
