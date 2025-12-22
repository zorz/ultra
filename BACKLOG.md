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

- [ ] **Chord keybinding support** - Add support for chord keybindings (e.g., `ctrl+d a` to select all occurrences). The keybinding system should:
  - Detect when a partial chord is entered and wait for the next key
  - Show a visual indicator that a chord is in progress
  - Timeout after a reasonable delay if no second key is pressed
  - Support arbitrary chord lengths (2+ keys)

- [ ] **Shift+click selection not working** - Shift+click to extend selection in the DocumentEditor is not functioning. The code exists in `handleMouse()` but the shift modifier may not be reaching the handler correctly. Investigate:
  - Whether the input handler is correctly parsing the shift modifier for mouse events
  - Whether the mouse event is being intercepted before reaching the editor
  - The `setCursorPosition(clickPos, true)` call with extend=true

- [ ] **Kitty terminal ctrl+shift+key conflicts** - Kitty terminal has default shortcuts that intercept ctrl+shift+p, ctrl+shift+k, etc. before they reach the application. The first keypress is consumed by Kitty, and only subsequent presses get through. Solutions:
  - Document that users need to unbind these in Kitty config (`map ctrl+shift+p no_op`)
  - Consider alternative default keybindings that don't conflict with Kitty
  - Detect Kitty terminal and show a warning/hint about configuring shortcuts

- [ ] **Undo/redo not working** - The undo (ctrl+z) and redo (ctrl+shift+z / ctrl+y) commands are bound but not functional. Need to:
  - Verify the DocumentEditor is correctly calling the document service's undo/redo methods
  - Ensure the undo stack is being populated when edits are made
  - Check that the UndoManager is properly grouping changes and tracking state
  - Test with various edit operations (typing, paste, delete, etc.)

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

- [ ] **File tree keyboard shortcuts and file operations** - The file tree lacks keyboard shortcuts for common file operations. Need to add:
  - `n` or `a` to create new file (inline rename input for name)
  - `shift+n` or `shift+a` to create new folder
  - `r` or `F2` to rename file/folder (inline rename input)
  - `d` or `Delete` to delete file/folder (with confirmation dialog)
  - `Enter` to open file / expand folder
  - `Space` to preview file without opening
  - The inline input should appear at the current selection position and handle escape to cancel

- [ ] **Terminal and editor scroll-up boundary jitter** - When scrolling up in the terminal or editor and the viewport reaches the top line (no more scrollback), continued mouse scroll-up causes a weird up/down jitter movement. Instead, scrolling should lock in place when no further scrolling is possible. This only happens with scroll-up, not scroll-down.

- [ ] **Hover on mouse position** - Add automatic hover tooltip when mouse hovers over a symbol for a configurable duration. Requires:
  - Mouse position tracking in DocumentEditor
  - Debounced hover request (e.g., 500ms delay)
  - Setting to enable/disable auto-hover
  - Setting for hover delay duration

- [x] **Squiggly underlines for diagnostics** - Instead of simple underlines, implement VS Code-style squiggly/wavy underlines for errors and warnings. This is more visually distinct but technically challenging in terminal.

- [ ] **Diagnostics panel** - A panel that lists all diagnostics (errors, warnings) for the current file or entire workspace:
  - Filterable by severity (errors, warnings, info, hints)
  - Clickable entries to jump to location
  - Shows file path, line number, message
  - Can be opened via command palette
  - Updates in real-time as diagnostics change

## Services

## ECP

## Testing
