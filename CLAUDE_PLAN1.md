# Ultra 1.0 Consolidated Development Plan

This document consolidates feedback from Codex and Gemini with the existing Ultra 1.0 architectural vision to create a prioritized, actionable development plan.

## Executive Summary

Ultra is transitioning from a monolithic terminal editor to a modular **Editor Command Protocol (ECP) Server** architecture. Both Codex and Gemini feedback identified critical issues that must be addressed before this migration can succeed:

1. **Dual Configuration Systems** - The largest architectural divergence blocking migration
2. **Build/Typecheck Breakage** - Stale imports preventing CI and development
3. **Render Performance Issues** - Full buffer clearing defeating dirty-tracking optimization
4. **Hardcoded Values** - Magic numbers scattered instead of using settings
5. **Documentation Drift** - Docs referencing outdated paths and versions

The plan below organizes work into four phases, ordered by dependency and impact.

---

## Phase 1: Foundation Fixes (Critical Blockers)

These issues block development workflow and must be fixed first.

### 1.1 Fix Typecheck Breakage in defaults.ts

**Issue (Codex #1):** `src/config/defaults.ts` imports types from non-existent paths:
```typescript
import type { KeyBinding } from '../input/keymap.ts';      // Does not exist
import type { Theme } from '../ui/themes/theme-loader.ts'; // Does not exist
```

**Impact:** TypeScript checking fails, IDE diagnostics broken, CI blocked.

**Resolution:**
1. Update imports to correct locations:
   - `KeyBinding` should import from `../services/session/types.ts`
   - `Theme` should import from `../services/session/types.ts` or a dedicated types file
2. Update `build.ts` to generate correct import paths
3. Verify with `bun run typecheck`

**Reasoning:** This is a 5-minute fix that unblocks the entire development workflow. Without passing typechecks, no other work can be validated.

---

### 1.2 Fix Platform-Specific Build Assumptions

**Issue (Codex #4):** `build.ts` hardcodes `--target=bun-darwin-arm64`:
```typescript
await $`bun build --compile --target=bun-darwin-arm64 --external node-pty ./src/index.ts --outfile ultra`;
```

**Impact:** Builds fail on Linux, Windows, and Intel macOS.

**Resolution:**
1. Detect platform and architecture at build time:
   ```typescript
   const platform = process.platform;  // 'darwin', 'linux', 'win32'
   const arch = process.arch;          // 'arm64', 'x64'
   const target = `bun-${platform}-${arch}`;
   ```
2. Add build matrix documentation for supported targets
3. Update PTY loader (`src/terminal/pty-loader.ts`) to match

**Reasoning:** Enables CI/CD pipelines and contributor builds on different platforms.

---

### 1.3 Create Missing Test Fixtures Directory

**Issue (Codex #6):** `bunfig.toml` defines `@fixtures/*` alias pointing to non-existent `tests/fixtures/`.

**Resolution:**
1. Create `tests/fixtures/` directory
2. Add `.gitkeep` or initial fixture files
3. Document fixture usage in `architecture/testing/fixtures.md`

**Reasoning:** Prevents future test failures and aligns documentation with reality.

---

## Phase 2: Configuration Unification (Highest Priority Architecture Work)

This is the largest architectural issue identified by both reviewers.

### 2.1 Audit Current Configuration State

**Issue (Codex #2, #3):** Two independent configuration systems exist:

| Aspect | TUI Config | ECP/Services | **Unified Decision** |
|--------|------------|--------------|---------------------|
| Config Root | `~/.ultra/` | `~/.config/ultra/` | `~/.ultra/` (default, overridable) |
| Settings File | `settings.jsonc` | `settings.json` | `settings.jsonc` (fallback to `.json`) |
| Key Prefix | `tui.*` | `ultra.*` | Scoped: `tui.*`, `editor.*`, `ultra.*` |
| Theme Default | `catppuccin-frappe` | `One Dark` | `catppuccin-frappe` |
| Sidebar Width | `tui.sidebar.width` (36) | `ultra.sidebar.width` (30) | `tui.sidebar.width` (36) |

**Impact:** TUI and ECP clients observe different settings; validation confusion; user changes not applied where expected.

### 2.2 Unified Configuration Architecture (Decided)

1. **Config Root:** `~/.ultra/` (default, configurable in settings)

2. **Key Naming:** Scoped by what it handles:
   - `tui.*` - TUI-specific settings (sidebar, terminal panel, etc.)
   - `editor.*` - Editor behavior (tabSize, wordWrap, etc.)
   - `ultra.*` - Ultra application settings (ai, session, etc.)

3. **File Format:** JSONC by default, fallback to JSON
   - Look for `settings.jsonc` first
   - Fall back to `settings.json` if not found
   - Unify all settings into `settings.jsonc` as starting point

### 2.3 Implement Unified Settings System

**Steps:**
1. Create `src/services/session/unified-schema.ts` combining all settings from:
   - `config/default-settings.jsonc` (72 settings)
   - `src/services/session/schema.ts` (partial overlap)
   - `src/clients/tui/config/config-manager.ts` (TUI-specific)

2. Ensure schema covers ALL settings used anywhere:
   - `files.watchFiles` (missing from schema)
   - `editor.undoHistoryLimit` (missing from schema)
   - `ai.defaultProvider` (missing from schema)
   - `editor.diagnostics.curlyUnderline` (missing from schema)

3. Update `TUIConfigManager` to use the unified schema for validation

4. Migrate config paths:
   - If `~/.config/ultra/` is chosen, migrate from `~/.ultra/`
   - Add migration logic similar to existing `migrateFromLegacy()`

5. Add CI check to detect schema/defaults drift:
   ```typescript
   // test: all keys in default-settings.jsonc exist in schema
   for (const key of Object.keys(defaultSettings)) {
     expect(settingsSchema.properties[key]).toBeDefined();
   }
   ```

**Reasoning:** Without unified configuration, the ECP architecture cannot function correctly. Multiple clients will see different settings, leading to inconsistent behavior.

---

## Phase 3: Performance & Quality Improvements

These issues affect user experience but don't block architecture work.

### 3.1 Optimize Render Loop

**Issue (Gemini #1):** `Window.render()` calls `buffer.clear()` before every frame:
```typescript
render(): ScreenBuffer {
  const bg = this.getThemeColor('editor.background', '#1e1e1e');
  this.buffer.clear(bg, '#cccccc');  // Defeats dirty tracking!
  // ... render components ...
}
```

**Impact:** Full screen rewrite on every frame, causing potential flickering and high CPU usage.

**Resolution:**
1. Remove blanket `buffer.clear()` from main render loop
2. Ensure all components (`PaneContainer`, `StatusBar`, `Sidebar`) paint their full background
3. Add targeted clearing only for overlays when they close
4. Consider implementing `buffer.diff()` for incremental updates

**Reasoning:** The ScreenBuffer already has dirty-tracking infrastructure. The full clear defeats this optimization completely.

---

### 3.2 Connect Hardcoded Values to Settings

**Issue (Codex #7, Gemini #3):** Magic numbers used instead of settings.

**Specific instances:**
| Location | Current | Should Use |
|----------|---------|------------|
| `src/core/document.ts:813` | `const tabSize = 2` | `sessionService.getSetting('editor.tabSize')` |

**Resolution:**
1. Inject settings into `Document` class (via constructor or method parameter)
2. Update `outdent()` to use injected tabSize
3. Search for other hardcoded values: `grep -r "= 2" --include="*.ts" src/`

**Reasoning:** Per CLAUDE.md principle #2: "Settings Over Hardcoded Values" - never hardcode configurable values.

---

### 3.3 Implement Keybinding `when` Clauses

**Issue (Codex #8):** `when` conditions in keybindings are parsed but never evaluated.

**Location:** `src/services/session/local.ts` TODO in `resolveKeybinding()`

**Resolution:**
1. Define evaluation context interface:
   ```typescript
   interface KeybindingContext {
     editorHasMultipleCursors: boolean;
     editorHasFocus: boolean;
     terminalHasFocus: boolean;
     // etc.
   }
   ```
2. Implement `evaluateWhenClause(clause: string, context: KeybindingContext): boolean`
3. Filter keybindings by context in `resolveKeybinding()`

**Reasoning:** Without `when` clause support, conditional keybindings don't work, leading to command conflicts (e.g., Escape should only clear cursors when `editorHasMultipleCursors`).

---

### 3.4 Complete LSP References Picker

**Issue (Codex #10):** "Find References" has no UI to display results.

**Resolution:**
1. Create `src/clients/tui/overlays/references-picker.ts`
2. Extend `SearchableDialog<ReferenceLocation>` (similar to file picker)
3. Display file path, line number, and preview for each reference
4. Navigate to selection on Enter

**Reasoning:** Completes the LSP feature set for 1.0 release.

---

## Phase 4: Documentation & Cleanup

### 4.1 Update Documentation

**Issues (Codex #5, Gemini #2):**
- README shows `v0.8.1`, runtime prints `v1.0.0`, package.json is `0.1.0`
- Old paths referenced (`src/ui`, `src/features/*`)
- Testing docs reference non-existent `tests/e2e/`
- CLAUDE.md claims `GIT_EDITOR` is missing but it's set in `src/services/git/cli.ts`

**Resolution:**
1. Decide canonical version (recommend `1.0.0` for the rewrite)
2. Update all version references:
   - `README.md` line 3
   - `package.json` version field
   - Any runtime version strings
3. Update path references in `README.md` and `architecture/*.md`
4. Remove or update `tests/e2e/` references in testing docs
5. Update CLAUDE.md:
   - Remove GIT_EDITOR warning (it's now set)
   - Update file path examples to match new structure

---

### 4.2 Remove or Archive Legacy Code

**Issue (Gemini #2):** `src/archived/` should be explicitly deprecated.

**Resolution:**
1. Verify no active code imports from `src/archived/`
2. Add README.md to `src/archived/` explaining it's deprecated
3. Consider removing entirely if confirmed unused

---

### 4.3 Handle Generated Documentation

**Issue (Codex observation):** `docs/api/` appears to be checked in.

**Resolution:**
1. Add `docs/api/` to `.gitignore`
2. Generate docs in CI and publish separately
3. Or: Keep in git but ensure it's regenerated on release

---

## Phase 5: Testing & Validation

**Critical requirement:** Run tests after every significant change to validate correctness.

### 5.1 Establish Testing Discipline

**Issue:** Changes have been made without running tests to validate.

**Resolution:**
1. Run `bun test` after every phase completion
2. Run `bun run typecheck` after any TypeScript changes
3. Document test failures and fix before proceeding

### 5.2 ECP-Based Programmatic Testing

**Opportunity:** The ECP architecture enables programmatic user testing.

Per the architecture plan, the ECP Server model allows:
- Headless operation of Ultra (no UI required)
- JSON-RPC commands for all editor operations
- Automated test scenarios via `TestECPClient`

**Implementation:**
1. Use existing `TestECPClient` from `tests/helpers/` for integration tests
2. Create test scenarios that simulate user workflows:
   ```typescript
   // Example: Test file open, edit, save workflow
   const client = new TestECPClient();
   const { documentId } = await client.request('document/open', { uri: 'test.txt' });
   await client.request('document/insert', { documentId, text: 'Hello' });
   await client.request('document/save', { documentId });
   // Verify file contents
   ```
3. Add ECP integration tests for each service:
   - Document operations (open, edit, save, undo/redo)
   - File operations (read, write, delete)
   - Git operations (status, stage, commit)
   - Session operations (save, restore)
   - LSP operations (completion, hover, definition)

### 5.3 Test Coverage Requirements

**New features and bug fixes MUST include tests** (per CLAUDE.md):

| Change Type | Required Tests |
|-------------|---------------|
| New service method | Unit test for method |
| New ECP endpoint | Integration test via TestECPClient |
| Bug fix | Regression test that reproduces the bug |
| Configuration change | Test that validates settings are applied |

### 5.4 Validation Checkpoints

After each phase, verify:

| Phase | Validation |
|-------|------------|
| Phase 1 | `bun run typecheck` passes, `bun run build` succeeds |
| Phase 2 | Configuration tests pass, settings load correctly |
| Phase 3 | Render performance measured, no regressions |
| Phase 4 | Documentation builds, version numbers consistent |
| Phase 5 | All tests pass, coverage maintained |

---

## Implementation Priority Matrix

| Priority | Task | Effort | Impact | Dependencies |
|----------|------|--------|--------|--------------|
| P0 | 1.1 Fix typecheck imports | 15 min | Critical | None |
| P0 | 1.2 Fix build platform detection | 30 min | High | None |
| P0 | 1.3 Create fixtures directory | 5 min | Low | None |
| P1 | 2.1-2.3 Unify configuration | 1-2 days | Critical | 1.1 |
| P2 | 3.1 Optimize render loop | 2-4 hours | High | None |
| P2 | 3.2 Connect settings to document | 1 hour | Medium | 2.1-2.3 |
| P2 | 3.3 Implement when clauses | 2-4 hours | Medium | 2.1-2.3 |
| P2 | 3.4 LSP references picker | 4-6 hours | Medium | None |
| P3 | 4.1-4.3 Documentation cleanup | 2-3 hours | Medium | All above |
| P0 | 5.1 Run tests after each phase | Ongoing | Critical | None |
| P2 | 5.2 ECP integration tests | 1-2 days | High | 2.1-2.3 |
| P1 | 5.3 Add missing test coverage | Ongoing | High | Per change |

---

## Decisions Made

The following decisions have been confirmed:

### 1. Configuration Root Location
**Decision:** `~/.ultra/` (default, configurable in settings)
- Simpler path, already used by TUI
- Users can override via settings if they prefer XDG

### 2. Version Number
**Decision:** `0.5.0`
- Significant progress has been made
- Not yet 1.0 - more work needed

### 3. Settings Key Naming
**Decision:** Scoped by what it handles
- `tui.*` - TUI-specific settings (sidebar, terminal panel, etc.)
- `editor.*` - Editor behavior (tabSize, wordWrap, etc.)
- `ultra.*` - Ultra application settings (ai, session, etc.)

### 3a. Settings File Format
**Decision:** JSONC with JSON fallback
- Look for `settings.jsonc` first
- Fall back to `settings.json` if not found
- Unify all settings into `settings.jsonc`

### 3b. Theme Default
**Decision:** `catppuccin-frappe` (unify across all configs)

### 4. Generated Docs
**Decision:** Keep in git, regenerate on commit (manual for now)

### 5. Archived Code
**Decision:** Extract unimplemented features to BACKLOG.md, then delete `src/archived/`
- MCP Server and AI Integration identified as backlog items
- Most UI components already reimplemented in new TUI
- See BACKLOG.md for full analysis
- **Cleanup required:** Remove `--legacy` flag from `src/index.ts` (currently imports archived/app.ts)
- **Version update:** Change version from `v1.0.0` to `v0.5.0` in help text

---

## Completed Phases

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 | ✅ Complete | Foundation fixes (typecheck, build, fixtures) |
| Phase 2 | ✅ Complete | Configuration unification |
| Phase 3 | ✅ Complete | Performance & quality (render loop, settings, when clauses, LSP references picker) |
| Phase 4 | ✅ Complete | Documentation cleanup, version updates |
| Phase 5 | ✅ Complete | Testing & validation (1514 tests passing, workflow integration tests added) |

---

## Post-Implementation Feedback

### Gemini Feedback Summary

**Status:** v0.5.0 Ready (Pre-release) - 1514/1514 tests passing (100%)

**Key Achievements Verified:**
1. **Integration Workflow Testing** - The addition of `workflows.test.ts` validates the "handshake" between independent services using the same JSON-RPC protocol that real clients use.
2. **Render Performance** - The render loop is now optimized for dirty-rect tracking.
3. **Service Layer Stability** - All core ECP services have both unit and integration tests.

**Recommendations:**
1. **Hardening Workflow Tests** - Ensure `TempWorkspace` helper sets `user.name` and `user.email` locally (already done).
2. **LSP Workflow Expansion** - Add LSP interaction tests (completion, find references navigation).
3. **Persistence Testing** - Add session save/restore workflow tests.
4. **Documentation Drift** - Update `architecture/testing/overview.md` with new workflow testing patterns.

### Codex Feedback Summary

**Current Read:**
- ECP service surface area is stable and comprehensive
- Test coverage solid; end-to-end workflow coverage is a good direction
- Remaining gaps are mostly in "polish" features (LSP UX, incremental updates)

**Key Findings:**
1. **Workflow tests need tracking** - `tests/integration/workflows.test.ts` must be added to git.
2. **Git config addressed** - `TempWorkspace.gitInit()` now configures identity (already done).
3. **LSP TODOs remain** - References picker and incremental document updates still pending.

**Recommended Next Steps:**
1. Add `tests/integration/workflows.test.ts` to git
2. Implement LSP references picker flow and document incremental update tracking
3. UI polish pass after LSP work

---

## Phase 6: Next Steps (Post-Feedback)

Based on the consolidated feedback from Gemini and Codex, here are the prioritized next steps:

### 6.1 Immediate Actions (P0)

| Task | Description | Status |
|------|-------------|--------|
| Commit workflow tests | Add `tests/integration/workflows.test.ts` to version control | Pending |
| Commit gutter fix | Add the gutter width fix for markdown rendering | Pending |

### 6.2 LSP Polish (P1)

| Task | Description | Effort |
|------|-------------|--------|
| LSP Workflow Tests | Add integration tests for completion and references navigation | 2-4 hours |
| Incremental Document Updates | Implement efficient change tracking in `src/services/document/local.ts` | 4-6 hours |
| References Picker UX | Ensure ReferencesPicker works end-to-end with navigation | 2-3 hours |

**LSP Workflow Test Scenarios:**
```typescript
// Scenario 1: Completion flow
// Open TypeScript file -> Wait for LSP -> Trigger completion -> Accept -> Verify content

// Scenario 2: Find References flow
// Open file -> Find references -> Select from picker -> Verify navigation
```

### 6.3 Persistence Testing (P1)

| Task | Description | Effort |
|------|-------------|--------|
| Session Persistence Test | Open files/terminals -> Save -> Shutdown -> Restart -> Load -> Verify state | 3-4 hours |

**Persistence Test Scenario:**
```typescript
// Open documents with specific cursor positions
// Set sidebar width, terminal visibility
// Save session with name
// Shutdown server completely
// Restart server
// Load session
// Verify: documents reopened, cursors restored, UI state matches
```

### 6.4 Documentation Updates (P2)

| Task | Description | Effort |
|------|-------------|--------|
| Update testing overview | Add workflow testing patterns to `architecture/testing/overview.md` | 1 hour |
| Update CLAUDE.md | Add workflow test examples and patterns | 30 min |

### 6.5 Archived Code Cleanup (P2)

| Task | Description | Status |
|------|-------------|--------|
| Delete src/archived/ | Remove folder and `--legacy` flag from `src/index.ts` | Pending |
| Update version in help | Change from `v1.0.0` to `v0.5.0` in help text | Pending |

---

## Implementation Priority Matrix (Updated)

| Priority | Task | Effort | Impact | Dependencies |
|----------|------|--------|--------|--------------|
| P0 | Commit workflow tests + gutter fix | 5 min | Critical | None |
| P1 | LSP workflow integration tests | 2-4 hours | High | None |
| P1 | Session persistence tests | 3-4 hours | High | None |
| P1 | Incremental document updates | 4-6 hours | Medium | None |
| P2 | Documentation updates | 1-2 hours | Medium | P1 tasks |
| P2 | Archived code cleanup | 30 min | Low | None |

---

## Success Criteria for v0.5.0 Release

1. ✅ All 1514+ tests passing
2. ✅ Typecheck clean
3. ✅ Core ECP services stable (Document, File, Git, LSP, Session, Syntax, Terminal)
4. ✅ Workflow integration tests covering cross-service scenarios
5. ⬜ LSP workflow tests added
6. ⬜ Session persistence tests added
7. ⬜ All changes committed to git
8. ⬜ Documentation updated with new patterns

---

## Appendix: Raw Feedback

### Gemini Feedback (Full)

The addition of `tests/integration/workflows.test.ts` is the most significant recent update:
- **Why it matters:** It validates the "handshake" between independent services using the same JSON-RPC protocol that real clients use.
- **Verified Flows:**
  - Edit-Save-Commit: Open -> Edit -> Save to Disk -> Git Stage -> Git Commit
  - Selective Staging: Creating multiple files and staging only a subset
  - Git Discard: Verifying that discarding changes correctly reverts file content
  - Memory-to-Disk: Creating files in memory and persisting via FileService

**Confidence Score:** Very High

### Codex Feedback (Full)

- The ECP service surface area looks stable and comprehensive for document, file, git, and config flows.
- Test coverage is solid for individual services; the new end-to-end workflow coverage is a good direction.
- Remaining gaps are mostly in "polish" features (LSP UX and incremental updates), not core edit/IO paths.

**Recommended focus:** LSP references picker flow and document incremental update tracking.
