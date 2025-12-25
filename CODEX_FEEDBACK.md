# CODEX Feedback for Ultra 1.0

## Scope & Approach
Reviewed changes since commit `5bec89f` (tab bar scrolling, outline panel, git timeline, terminal PTY/ANSI updates, and focus behavior changes). No tests were executed.

## Key Findings & Risks (Ordered by Severity)

### 1) Git timeline file paths are workspace-relative, not repo-relative
- **Where**: `src/clients/tui/client/tui-client.ts:905`, `src/clients/tui/client/tui-client.ts:949`.
- **What**: `loadTimelineForEditor` derives `filePath` by stripping `this.workingDirectory`, then passes it to `gitCliService.fileLog` and `gitCliService.show`. Those git helpers expect a path relative to the repository root, not the workspace root.
- **Impact**: If the workspace is a subdirectory of a repo, the timeline returns no commits and `openFileAtCommit` fails to resolve file content. This is a functional break for nested workspaces.
- **Recommendation**: Resolve `repoRoot = await gitCliService.getRoot(workingDirectory)` and compute `path.relative(repoRoot, absoluteFilePath)` before calling `fileLog/show`. Handle the `null` root case gracefully.

### 2) Terminal cursor visibility is ignored for PTY-backed sessions
- **Where**: `src/clients/tui/elements/terminal-session.ts:813`.
- **What**: The ANSI parser now tracks cursor visibility (DECTCEM), but `TerminalSession` always renders the cursor when focused.
- **Impact**: Apps that hide the cursor (e.g., `fzf`, full-screen TUI apps) will still show a cursor block, causing visual glitches and possible misalignment.
- **Recommendation**: Gate cursor rendering on `this.pty.isCursorVisible()` (or equivalent) when using the PTY buffer.

### 3) “Open file at commit” creates an editor without URI or tracking
- **Where**: `src/clients/tui/client/tui-client.ts:949`.
- **What**: `openFileAtCommit` creates a `DocumentEditor`, sets content, and focuses it but does not set a URI or register it in `openDocuments`.
- **Impact**: Save flows, LSP integration, status bar details, and git indicators may not behave as expected. Users can also edit content with no clear persistence path.
- **Recommendation**: Treat commit views as read-only (explicitly disable editing) or register a virtual URI (e.g., `ultra://git/<hash>/<path>`) and handle save attempts accordingly.

### 4) Outline setting `outline.showIcons` is defined but unused
- **Where**: `src/config/settings.ts:35`, `src/services/session/schema.ts:226`, `src/clients/tui/elements/outline-panel.ts`.
- **What**: The setting exists but the outline renderer always shows icons and expanders.
- **Impact**: Users can toggle the setting but see no effect, which is confusing and undermines configuration trust.
- **Recommendation**: Wire the setting into `OutlinePanel` rendering (e.g., hide icons/expanders, adjust indent/prefix width), or remove the setting until supported.

## Coverage & Testing Gaps
- No tests added for the new outline/timeline panels, tab bar scrolling, or the PTY screen buffer/parser. These changes are UI-heavy and stateful; targeted tests would help prevent regressions.

## Suggested Next Steps (Actionable)
1. Normalize file paths for git timeline operations by resolving repo root first and using repo-relative paths.
2. Respect cursor visibility from the PTY backend when rendering the terminal.
3. Decide on a read-only or virtual-document model for commit views and align save/LSP behavior.
4. Either implement `outline.showIcons` or remove it from settings until it’s supported.
