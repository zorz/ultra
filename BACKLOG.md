# Ultra 1.0 Backlog

Issues and improvements to address in future sessions.

## TUI

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

- [ ] **Shift+click selection not working** - Shift+click to extend selection in the DocumentEditor is not functioning. The code exists in `handleMouse()` but the shift modifier may not be reaching the handler correctly. Investigate:
  - Whether the input handler is correctly parsing the shift modifier for mouse events
  - Whether the mouse event is being intercepted before reaching the editor
  - The `setCursorPosition(clickPos, true)` call with extend=true

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

- [ ] **Save terminal buffer to session** - Currently, terminal sessions in panes are restored but start fresh (empty buffer). Consider saving and restoring the terminal scrollback buffer so users can see previous output after restarting. This would require:
  - Serializing the terminal buffer (scrollback + visible) to session state
  - Handling potentially large buffer sizes (compression or truncation)
  - Restoring buffer content when recreating the terminal session

- [x] **File tree keyboard shortcuts and file operations** - The file tree now has keyboard shortcuts for common file operations:
  - `n` to create new file (inline input for name)
  - `N` (shift+n) to create new folder
  - `r` or `F2` to rename file/folder (inline input)
  - `d` or `Delete` to delete file/folder (with y/n confirmation)
  - `Enter` or `Space` to open file / expand folder
  - Hint bar shows shortcuts when focused
  - Dialog input appears at bottom and handles Escape to cancel

- [x] **Terminal and editor scroll-up boundary jitter** - Mostly fixed by only triggering re-renders when scroll position actually changes. Previously, scroll events at boundaries would still call `markDirty()` even when scroll position was clamped and unchanged, causing unnecessary re-renders. Note: Very fast touchpad scrolling at the top boundary may still cause minor jitter - this appears to be related to terminal emulator behavior with rapid scroll events rather than application rendering.

- [ ] **AI terminal chat cursor position incorrect** - The cursor highlight in AI terminal chats (Claude Code, Codex) appears at the wrong position (often at the bottom of the buffer where status messages are written). The issue is that TUI applications like Claude Code use cursor positioning to render their UI, and the final PTY cursor position may not reflect the actual input location. Current implementation tracks DECTCEM cursor visibility (`CSI ?25h/l`) but this doesn't fully solve the problem. Possible approaches:
  - Let the TUI app render its own cursor character and don't overlay ours
  - Parse application-specific cursor position hints
  - Track cursor save/restore sequences more carefully
  - Research how other terminal emulators handle embedded TUI applications

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

## ECP

## Testing
