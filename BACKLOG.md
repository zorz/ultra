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

## Services

## ECP

## Testing
