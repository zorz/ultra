# CODEX Feedback for Ultra 1.0

## Scope & Approach
Reviewed changes since commit `5bec89f` plus the current working tree (`src/clients/tui/elements/ai-terminal-chat.ts`, `src/terminal/screen-buffer.ts`). No tests were executed.

## Key Findings & Risks (Ordered by Severity)

### 1) Git timeline uses workspace-relative paths, not repo-relative
- **Where**: `src/clients/tui/client/tui-client.ts:905`, `src/clients/tui/client/tui-client.ts:949`.
- **What**: `loadTimelineForEditor` strips `this.workingDirectory` to build `filePath`, then passes that to `gitCliService.fileLog` and `gitCliService.show`. Those helpers expect paths relative to the repo root.
- **Impact**: If the workspace is a subdirectory of a repo, timeline history is empty and `openFileAtCommit` fails to resolve file content. This is a functional break for nested workspaces.
- **Recommendation**: Resolve `repoRoot = await gitCliService.getRoot(this.workingDirectory)` and use `path.relative(repoRoot, absoluteFilePath)` before calling `fileLog/show`. Handle the `null` root case gracefully.

### 2) "Open file at commit" creates an untracked editor with no URI
- **Where**: `src/clients/tui/client/tui-client.ts:949`.
- **What**: `openFileAtCommit` creates a `DocumentEditor`, sets content, and focuses it without a URI or registration in `openDocuments`.
- **Impact**: Save flows, LSP integration, status bar metadata, and git indicators are inconsistent. Users can edit content with no persistence model.
- **Recommendation**: Treat commit views as read-only or register a virtual URI (for example, `ultra://git/<hash>/<path>`) and ensure save attempts are handled intentionally.

### 3) PTY cursor visibility is ignored when rendering terminals
- **Where**: `src/clients/tui/elements/terminal-session.ts:813`.
- **What**: The screen buffer tracks DECTCEM, but `TerminalSession` always renders a cursor when focused.
- **Impact**: Apps that intentionally hide the cursor (fzf, htop, full-screen TUIs) will show a cursor block, causing visual glitches and potential alignment issues.
- **Recommendation**: Gate cursor rendering on `this.pty.isCursorVisible()` (or equivalent) when using the PTY buffer.

### 4) Integrated terminal forces `-il` flags for all shells
- **Where**: `src/terminal/backends/node-pty.ts:57`, `src/terminal/pty.ts:87`.
- **What**: Both PTY backends now default to `-il` regardless of shell.
- **Impact**: Shells that do not support `-il` (or expect different flags) may fail to spawn. Users also cannot override args for the bun-pty path.
- **Recommendation**: Add a `terminal.integrated.shellArgs` setting (or detect `zsh`/`bash` and only apply `-il` there). Preserve user-configured args for both backends.

### 5) Scroll region support does not constrain IL/DL to margins
- **Where**: `src/terminal/screen-buffer.ts:446`, `src/terminal/screen-buffer.ts:457`.
- **What**: `insertLines` and `deleteLines` operate on the full buffer and ignore the current scroll region set by DECSTBM.
- **Impact**: TUIs that rely on fixed headers/footers can corrupt lines outside the scroll region. This undermines the new DECSTBM support for oh-my-zsh and similar prompts.
- **Recommendation**: Apply IL/DL within `scrollTop` and `scrollBottom` when the cursor is inside the region, and avoid mutating lines outside those margins.

### 6) Outline setting `outline.showIcons` is defined but unused
- **Where**: `src/config/settings.ts:38`, `src/services/session/schema.ts:233`, `src/clients/tui/elements/outline-panel.ts:725`.
- **What**: The setting exists, but the outline renderer always shows icons and expanders.
- **Impact**: Users can toggle the setting but see no effect, which undermines configuration trust.
- **Recommendation**: Wire the setting into `OutlinePanel` rendering or remove the setting until it is supported.

### 7) AITerminalChat overlays a cursor even when ink owns it
- **Where**: `src/clients/tui/elements/ai-terminal-chat.ts:392`.
- **What**: `AITerminalChat` draws a cursor block unconditionally when focused. Ink-based apps (Claude/Gemini, and likely Codex) hide the terminal cursor and draw their own caret as styled characters.
- **Impact**: Cursor appears in the wrong place or flickers between render passes, because PTY cursor coordinates reflect ink’s paint operations, not the logical input location.
- **Recommendation**: Skip overlay cursor rendering for ink providers, or gate it on `this.pty.isCursorVisible()`. That lets ink’s own cursor glyph remain the only caret and avoids mispositioned overlays. Consider a `usesInkCursor()` hook on subclasses so non-ink providers keep the overlay behavior.

## Coverage & Testing Gaps
- No tests added for the new outline/timeline panels, tab bar scrolling, or PTY ANSI sequences (DECSTBM, IL/DL, ICH/DCH/ECH). These changes are stateful and UI-heavy; targeted tests would reduce regression risk.

## Suggested Next Steps (Actionable)
1. Normalize git timeline paths by resolving repo root and using repo-relative file paths.
2. Decide on a read-only or virtual-document model for commit views and align save/LSP behavior.
3. Respect PTY cursor visibility when rendering terminal sessions.
4. Make shell args configurable or conditional so non-zsh shells can spawn reliably.
5. Constrain IL/DL to the active scroll region and add tests for DECSTBM interactions.
6. Wire `outline.showIcons` into rendering or remove it until it is supported.
