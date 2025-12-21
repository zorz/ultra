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

- [ ] **Double-click file opening delay** - There is a noticeable delay when double-clicking a file to open it from either the file tree or git panel. Investigate and optimize the file opening path.

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

- [ ] **Live settings and keybindings updates** - Currently, settings.json and keybindings.json are only read at startup. Changes require restarting the editor. Need:
  - File watching for settings.json and keybindings.json to apply changes live
  - Command palette commands to change settings directly (like the old TUI had)
  - UI for adjusting settings like terminal height, sidebar width, theme, etc.
  - Settings that affect session state (terminal height, sidebar width) should update both the config and the current session

- [ ] **Terminal tabs cursor handling with multiple terminals** - When there is more than one terminal tab, cursor handling doesn't work properly. Each terminal session has its own PTY with its own cursor state, but switching tabs may not properly update cursor visibility/position. Investigate:
  - Whether cursor state is preserved when switching between terminal tabs
  - If the active terminal's cursor is being rendered correctly
  - Whether inactive terminals are incorrectly showing or affecting cursor state

- [ ] **Save terminal buffer to session** - Currently, terminal sessions in panes are restored but start fresh (empty buffer). Consider saving and restoring the terminal scrollback buffer so users can see previous output after restarting. This would require:
  - Serializing the terminal buffer (scrollback + visible) to session state
  - Handling potentially large buffer sizes (compression or truncation)
  - Restoring buffer content when recreating the terminal session

## Services

## ECP

## Testing
