# CODEX Feedback for Ultra 1.0

## Scope & Approach
Reviewed the current `ux-fixes-20251226.3` worktree with a focus on the new ECP server, git timeline UI, AI/terminal tooling, and configuration plumbing. No automated tests were run in this pass.

## Key Findings & Risks (Ordered by Severity)

### 1) ECP session APIs never persist to disk
- **Where**: `src/ecp/server.ts:74-101`, `src/services/session/local.ts:257-300`.
- **What**: `ECPServer` constructs `LocalSessionService` but never calls `setSessionPaths`, so `saveSession/listSessions/tryLoadLastSession` skip disk writes because `sessionPaths` stays `null`.
- **Impact**: Remote clients using ECP think sessions were saved, yet nothing hits disk. Session restores, `session/list`, and `session/delete` silently fail after the process restarts.
- **Recommendation**: Accept session path settings in `ECPServerOptions` (defaulting to `~/.ultra/sessions/...`) and call `sessionService.setSessionPaths()` before exposing the adapter. Add coverage around `session/save` to guard against future regressions.

### 2) Git timeline still uses workspace-relative paths
- **Where**: `src/clients/tui/client/tui-client.ts:1067-1076`.
- **What**: `loadTimelineForEditor` strips `this.workingDirectory` from document URIs and hands the remainder to `gitCliService.fileLog/show`. That only works when the workspace root *is* the repo root; nested workspaces produce invalid repo-relative paths.
- **Impact**: In monorepos the timeline always renders empty and “open file @ commit” fails with `fatal: Path '...' does not exist in 'commit'`. Users cannot inspect history for files outside the repo root.
- **Recommendation**: Resolve the actual repo root via `gitCliService.getRoot`, compute `relative(root, filePath)`, and fall back gracefully when the file is outside the repo. Add a regression test for workspaces rooted below the repo.

### 3) Settings schema drops the `tui.` prefix
- **Where**: `src/services/session/schema.ts:200-250`.
- **What**: The schema entries for tab bar, outline, and timeline settings are named `tabBar.scrollAmount`, `outline.*`, `timeline.*` instead of `tui.tabBar.scrollAmount`, `tui.outline.*`, `tui.timeline.*`.
- **Impact**: `validateSetting` rejects the real keys (`tui.outline.autoFollow`, etc.), so ECP `config/set`, CLI tools, or any consumer of `SessionService` cannot change those settings (“Unknown setting”). Defaults also drift if schema-derived helpers are ever used.
- **Recommendation**: Rename the schema properties to match the actual keys (or add aliases) and add validation tests for the `tui.*` settings so the mismatch cannot reappear.

### 4) Commit viewers create untracked editors with no URI
- **Where**: `src/clients/tui/client/tui-client.ts:1099-1123`.
- **What**: `openFileAtCommit` creates a `DocumentEditor`, injects text, and focuses it without assigning a URI or marking the buffer read-only.
- **Impact**: The editor status bar shows “Untitled”, save attempts overwrite nothing, diagnostics/LSP ignore the document, and users can edit a historical snapshot believing it’s tied to a file. The buffer is also invisible to session restore.
- **Recommendation**: Use a virtual URI like `ultra://git/<hash>/<relativePath>` and call `editor.setUri()` with a read-only flag or wiring to a temp file. Hook save attempts to reopen the diff or warn the user.

### 5) Terminal backends force `-il` shell flags with no override
- **Where**: `src/terminal/pty.ts:97-103`, `src/terminal/backends/node-pty.ts:56-61`.
- **What**: Both bun-pty and node-pty backends append `['-il']` regardless of the configured shell, and `PTYBackendOptions` exposes no setting to change or remove the flags.
- **Impact**: Shells that don’t support `-il` (fish, nu, Windows shells, custom binaries) fail to spawn. Even supported shells can’t run with user-specified args (e.g., login vs. non-login) because the code overwrites them.
- **Recommendation**: Respect `options.args`, add a `terminal.integrated.shellArgs` setting, and default to `['-il']` only when the shell is zsh/bash. Validate by spawning at least one non-POSIX shell in CI.

### 6) `tui.outline.showIcons` setting still unused
- **Where**: Setting definition `src/config/settings.ts:38-42`; rendering `src/clients/tui/elements/outline-panel.ts:716-780`.
- **What**: The Outline panel always renders the symbol icon (`SYMBOL_ICONS`), and no code path consults `tui.outline.showIcons`.
- **Impact**: Users editing settings see no effect, which undermines trust and clutters the settings schema. Also, ECP/CLI tooling will continue to reject this setting because of the schema bug above.
- **Recommendation**: Gate the icon drawing on `this.ctx.getSetting('tui.outline.showIcons', true)` (and adjust layout when icons are hidden) or remove the setting entirely until it’s supported.

### 7) Tab-bar scroll amount ignores user settings
- **Where**: `src/clients/tui/elements/terminal-panel.ts:250-266`, `src/clients/tui/client/tui-client.ts:290-302`.
- **What**: The terminal panel directly calls `localSessionService.getSetting('tui.tabBar.scrollAmount')`, but `LocalSessionService` never ingests values from `TUIConfigManager` (no `setSetting`/`updateSettings` calls). All other UI components read from the config manager provided via `ElementContext`.
- **Impact**: Editing `tui.tabBar.scrollAmount` in settings changes editor tab scrolling but not the terminal tabs, so the UI behaves inconsistently and user expectations are violated.
- **Recommendation**: Use the element context (`this.ctx.getSetting`) for the tab scroll amount, or synchronize `localSessionService` with the loaded settings once during startup.

## Coverage & Testing Gaps
- The newly introduced ECP stack (document/file/git/session/terminal adapters) lacks integration tests; the missing session-path wiring would have been caught by a simple `session/save` → restart → `session/list` test.
- Git timeline regressions still have no automated coverage for nested repos or commit-open flows.
- PTY backends don’t have even smoke tests for spawning non-zsh shells, so the forced `-il` regression went unnoticed.

## Suggested Next Steps
1. Fix the ECP session-path plumbing and extend the E2E ECP tests to cover session save/load/list flows.
2. Normalize git timeline paths using the repo root, and add a regression test so nested workspaces don’t break again.
3. Audit configuration handling so schema keys, context getters, and UI usage stay in sync (outline/timeline/tabBar settings plus terminal tab scroll).
