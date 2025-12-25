# CODEX Feedback for Ultra 1.0

## Scope & Approach
Reviewed the repository state with attention to the recent Claude updates to workflow testing. Focused on test reliability, integration coverage, and remaining source TODOs. No automated tests were executed.

## Current Read on the App
- The ECP service surface area looks stable and comprehensive for document, file, git, and config flows.
- Test coverage is solid for individual services; the new end-to-end workflow coverage is a good direction.
- Remaining gaps are mostly in “polish” features (LSP UX and incremental updates), not core edit/IO paths.

## Key Findings & Risks

### 1) New integration workflow test suite is untracked
- **Where**: `tests/integration/workflows.test.ts`.
- **What**: The file is present but not tracked in git, so it will not land unless explicitly added.
- **Impact**: The intended coverage won’t make it into PRs/CI; it’s easy to lose.
- **Next steps**: Add it to version control and run `bun test` to validate it with the rest of the suite.

### 2) Git config flakiness is now addressed in temp workspaces
- **Where**: `tests/helpers/temp-workspace.ts`.
- **What**: `gitInit` now configures `user.name`/`user.email`, which removes a common CI failure when committing in tests.
- **Impact**: Workflow tests are less likely to fail due to missing git identity.
- **Next steps**: Keep this pattern for any new git-backed helpers; still assume `git` must be installed.

### 3) LSP and incremental document updates still marked TODO
- **Where**: `src/clients/tui/client/lsp-integration.ts`, `src/services/document/local.ts`.
- **What**: References picker is not implemented; incremental change tracking for documents is pending.
- **Impact**: LSP UX is incomplete, and document updates may be less efficient than they could be.
- **Next steps**: Prioritize a minimal references picker and incremental change tracking to unblock workflows.

## Recommended Next Steps (Actionable)
1. Add `tests/integration/workflows.test.ts` to git and run the integration suite.
2. Implement LSP references picker flow and document incremental update tracking.
3. Re-evaluate any remaining settings or UX TODOs after LSP work to prepare for a UI polish pass.
