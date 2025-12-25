# Diff Viewer Enhancement Plan

## Overview

This plan extends the existing `GitDiffBrowser` and `ContentBrowser` architecture to add:
1. Side-by-side diff view
2. Inline editing within the diff viewer
3. LSP diagnostics integration
4. Pinned summary header
5. Auto-refresh with file watching
6. Generic viewer abstraction for future reuse

## Existing Architecture (Reuse, Don't Replace)

```
ContentBrowser<T> (abstract base)
├── buildNodes(artifacts) - abstract
├── renderNode() - abstract
├── getNodeActions() - abstract
├── Tree/flat view modes
├── Keyboard/mouse navigation
├── Scrollbar, hints bar
└── State serialization

GitDiffBrowser extends ContentBrowser<GitDiffArtifact>
├── File → Hunk → Line node hierarchy
├── Stage/unstage/discard at file/hunk level
├── Unified diff rendering
└── Callbacks: onStageFile, onStageHunk, etc.

GitDiffArtifact (data model)
├── filePath, staged, hunks[], changeType
├── additions, deletions counts
└── Node types: GitDiffFileNode, GitDiffHunkNode, GitDiffLineNode

InlineDiffExpander (for in-editor diffs)
├── Expand/collapse at gutter click
├── Stage/revert/close buttons
└── Scrollable hunk content
```

## Phase 1: ContentBrowser Enhancements

### 1.1 Add Pinned Summary Section

Add optional summary section that sticks to top while scrolling.

**File:** `src/clients/tui/elements/content-browser.ts`

```typescript
// New properties
protected summarySection: SummaryItem[] = [];
protected summaryPinned = true;
protected summaryHeight = 0; // Auto-calculated

interface SummaryItem {
  label: string;
  value: string | number;
  color?: string;
  action?: () => void;
}

// New methods
setSummary(items: SummaryItem[]): void;
setSummaryPinned(pinned: boolean): void;
protected renderSummary(buffer, x, y, width): number; // Returns height
```

**Setting:** `tui.contentBrowser.summaryPinned` (default: true)

### 1.2 Add View Mode Enum Extension

Extend view modes to support diff-specific modes.

```typescript
// Current
type ViewMode = 'tree' | 'flat';

// Extended (in subclasses via override)
type DiffViewMode = 'tree' | 'flat' | 'unified' | 'side-by-side';
```

### 1.3 Add Editable Node Support

Add editing capability to nodes (for future use in diff editing, outline editing).

```typescript
interface ArtifactNode<T> {
  // Existing fields...

  // New fields
  editable?: boolean;
  editContent?: string;          // Content when in edit mode
  editCursor?: { line: number; col: number };
}

// New abstract method
protected handleNodeEdit?(node: ArtifactNode<T>, newContent: string): void;
```

## Phase 2: GitDiffBrowser Enhancements

### 2.1 Side-by-Side Rendering Mode

Add `diffViewMode: 'unified' | 'side-by-side'` property.

**File:** `src/clients/tui/elements/git-diff-browser.ts`

```typescript
// New property
private diffViewMode: 'unified' | 'side-by-side' = 'unified';

// New method
setDiffViewMode(mode: 'unified' | 'side-by-side'): void;
toggleDiffViewMode(): void; // Keybinding: 'v'

// Override renderNode for side-by-side
protected override renderNode(): void {
  if (this.diffViewMode === 'side-by-side') {
    this.renderSideBySide(buffer, node, ...);
  } else {
    this.renderUnified(buffer, node, ...);
  }
}
```

**Side-by-side layout (50/50 split):**
```
│ 123 │ old content here     │ 124 │ new content here      │
│ 124 │ deleted line         │     │                       │
│     │                      │ 125 │ added line            │
```

- Left panel: old file (deletions highlighted)
- Right panel: new file (additions highlighted)
- Synced scrolling between panels
- Fixed 50/50 split (resizable divider in backlog)

### 2.2 Pinned Summary Section

Override summary for git-specific stats.

```typescript
protected override buildSummary(): SummaryItem[] {
  const stats = this.calculateStats();
  return [
    { label: 'Files', value: stats.fileCount },
    { label: 'Staged', value: stats.stagedCount, color: 'green' },
    { label: 'Pending', value: stats.pendingCount },
    { label: 'Discarded', value: stats.discardedCount, color: 'red' },
    { label: '+', value: stats.additions, color: 'green' },
    { label: '-', value: stats.deletions, color: 'red' },
  ];
}
```

### 2.3 Inline Editing

Add ability to edit hunk content before staging.

```typescript
// New state
private editingNode: ArtifactNode<GitDiffArtifact> | null = null;
private editBuffer: string[] = [];
private editCursor = { line: 0, col: 0 };
private editMode: 'stage-modified' | 'direct-write' = 'stage-modified';

// Methods
startEdit(node: GitDiffLineNode | GitDiffHunkNode): void;
cancelEdit(): void;
saveEdit(): void;  // Behavior depends on editMode setting

// Keybindings
// 'e' - start editing selected line/hunk
// 'Escape' - cancel edit
// 'Ctrl+S' - save edit
```

**Edit mode rendering:**
- Show editable text area for the selected hunk
- Cursor visible, text input works
- Save behavior (configurable via `tui.diffViewer.editMode`):
  - `stage-modified` (default): Creates modified hunk for staging (non-destructive)
  - `direct-write`: Directly modifies the working tree file (immediate effect)

### 2.4 Auto-Refresh with File Watching

```typescript
// New property
private fileWatcher: FileWatcher | null = null;
private autoRefresh = true;

// Methods
enableAutoRefresh(): void;
disableAutoRefresh(): void;
private onFilesChanged(changedPaths: string[]): void;

// Setting
'tui.diffViewer.autoRefresh': true
```

Use existing file watcher infrastructure or add new watcher for git index.

### 2.5 LSP Diagnostics Integration

Show diagnostics for added/modified lines.

```typescript
// New property
private diagnosticsProvider?: DiagnosticsProvider;

interface DiagnosticsProvider {
  getDiagnostics(filePath: string, lineNumbers: number[]): Diagnostic[];
}

// Rendering enhancement
private renderLineWithDiagnostics(
  buffer: ScreenBuffer,
  node: GitDiffLineNode,
  diagnostics: Diagnostic[]
): void;
```

**Display:**
- Underline lines with diagnostics
- Show diagnostic icons in gutter (⚠️ ❌)
- Tooltip on hover (if enabled)
- Only for 'added' lines (new code)

## Phase 3: Viewer Abstraction (Future Reuse)

### 3.1 ViewerItem<T> Generic Interface

For future OutlineViewer, SpecViewer, etc.

```typescript
// src/clients/tui/viewers/viewer-item.ts

interface ViewerItem<T> {
  id: string;
  data: T;
  collapsed: boolean;
  children: ViewerItem<T>[];

  // Display
  label: string;
  icon?: string;
  description?: string;

  // Behavior
  actions: ViewerAction[];
  editable: boolean;

  // State
  state: 'default' | 'selected' | 'editing' | 'staged' | 'pending';
}

interface ViewerAction {
  id: string;
  label: string;
  shortcut: string;
  enabled: boolean;
  execute: () => void | Promise<void>;
}
```

### 3.2 BaseViewer<T, Item> Pattern

```typescript
// src/clients/tui/viewers/base-viewer.ts

abstract class BaseViewer<T, Item extends ViewerItem<T>> extends BaseElement {
  protected items: Item[] = [];
  protected flatItems: Item[] = [];

  // Summary
  protected abstract buildSummary(): SummaryItem[];

  // Items
  protected abstract buildItems(data: T[]): Item[];
  protected abstract renderItem(item: Item, ...): void;

  // Actions
  protected abstract getItemActions(item: Item): ViewerAction[];

  // Editing
  protected abstract handleItemEdit(item: Item, content: string): void;
}
```

This can be extracted from ContentBrowser when we implement OutlineViewer.

## Phase 4: New Viewers (Future)

### 4.1 OutlineViewer

View/edit functions, classes, symbols without opening full file.

```typescript
interface OutlineItem {
  symbol: Symbol;  // From LSP
  summary?: string; // AI-generated or JSDoc
  code: string[];   // Extracted source
}

class OutlineViewer extends BaseViewer<OutlineItem, OutlineViewerItem> {
  // Show symbols as collapsible tree
  // Expand to see code
  // Edit in place
  // Changes saved back to file
}
```

### 4.2 SpecViewer

Markdown spec-driven development viewer.

```typescript
interface SpecSection {
  type: 'feature' | 'requirement' | 'task' | 'test';
  title: string;
  content: string;
  status: 'todo' | 'in-progress' | 'done';
  children: SpecSection[];
}

class SpecViewer extends BaseViewer<SpecSection, SpecViewerItem> {
  // Show spec structure as tree
  // Status indicators (checkboxes)
  // Inline editing
  // AI integration for spec generation
}
```

## Timeline Panel Integration

The `GitTimelinePanel` already has Enter/double-click triggering `onViewDiff`, but the callback is stubbed:

**Location:** `src/clients/tui/client/tui-client.ts:850-853`

```typescript
onViewDiff: async (commit, _filePath) => {
  // TODO: Show diff for commit
  this.window.showNotification(`View diff: ${commit.shortHash} - ${commit.message}`, 'info');
},
```

**Integration Task (Sprint 1):** Wire up `onViewDiff` to open `GitDiffBrowser` showing:
- For commit diffs: diff between `commit^` and `commit`
- If `filePath` provided: show only that file's diff
- If no `filePath`: show all files changed in that commit

This requires extending `GitDiffBrowser` to support commit-to-commit diffs (not just working tree vs staged).

## Implementation Order

### Sprint 1: Core Enhancements ✓
1. [x] Add summary section to ContentBrowser
2. [x] Add `summaryPinned` setting
3. [x] Add summary to GitDiffBrowser with stats
4. [x] Wire up Timeline Panel `onViewDiff` to open GitDiffBrowser

### Sprint 2: Side-by-Side View ✓
4. [x] Add `diffViewMode` property
5. [x] Implement side-by-side rendering
6. [x] Add 'v' keybinding to toggle view mode
7. [x] Synced scrolling between panels (inherent in single-list design)

### Sprint 3: Auto-Refresh ✓
8. [x] Subscribe to gitCliService.onChange() for git change events
9. [x] Add autoRefresh property and read from settings
10. [x] Implement refresh debouncing (100ms via TIMEOUTS.FILE_WATCH_DEBOUNCE)
11. [x] Add isHistoricalDiff flag to skip auto-refresh for commit diffs

### Sprint 4: LSP Diagnostics ✓
11. [x] Add diagnostics provider interface
12. [x] Integrate with existing LSP service
13. [x] Render diagnostics on added lines (unified and side-by-side views)
14. [ ] Add diagnostic tooltips (backlog - requires hover integration)

### Sprint 5: Inline Editing
15. [ ] Add edit mode state
16. [ ] Implement edit rendering (cursor, input)
17. [ ] Add keybindings (e, Escape, Ctrl+S)
18. [ ] Implement hunk modification for staging

### Sprint 6: Abstraction (After Validation)
19. [ ] Extract ViewerItem interface
20. [ ] Extract BaseViewer from ContentBrowser
21. [ ] Document patterns for future viewers

## File Changes Summary

| File | Change Type |
|------|-------------|
| `src/clients/tui/elements/content-browser.ts` | Modify - add summary, edit support |
| `src/clients/tui/elements/git-diff-browser.ts` | Modify - add side-by-side, edit, diagnostics |
| `src/clients/tui/artifacts/types.ts` | Modify - add editable fields to ArtifactNode |
| `src/services/session/schema.ts` | Modify - add new settings |
| `src/clients/tui/viewers/` | New directory for future viewers |
| `src/clients/tui/viewers/viewer-item.ts` | New - generic item interface |
| `src/clients/tui/viewers/base-viewer.ts` | New - extracted base class (Sprint 6) |

## Settings

```jsonc
{
  // Diff viewer settings
  "tui.diffViewer.summaryPinned": true,
  "tui.diffViewer.defaultViewMode": "unified", // "unified" | "side-by-side"
  "tui.diffViewer.autoRefresh": true,
  "tui.diffViewer.showDiagnostics": true,
  "tui.diffViewer.editMode": "stage-modified", // "stage-modified" | "direct-write"

  // Content browser settings (shared)
  "tui.contentBrowser.summaryPinned": true
}
```

## Keybindings

| Key | Action | Context |
|-----|--------|---------|
| `v` | Toggle unified/side-by-side | DiffViewer focused |
| `p` | Toggle summary pinned | Any ContentBrowser |
| `e` | Start editing selected | Line/hunk selected |
| `Escape` | Cancel edit | Edit mode |
| `Ctrl+S` | Save edit | Edit mode |
| `r` | Refresh | Already exists |
| `s` | Stage | Already exists |
| `d` | Discard | Already exists |
| `u` | Unstage | Already exists |

## Testing Requirements

Each sprint must include tests:

1. **Unit tests** for new methods
2. **Integration tests** for full workflows:
   - Toggle view modes
   - Stage/discard with summary updates
   - Edit and stage modified hunk
   - Auto-refresh on file change
3. **Snapshot tests** for rendering

## Questions Resolved

| Question | Answer |
|----------|--------|
| Keyboard navigation | Both Vim-style and arrow keys (existing) |
| Tab integration | Regular tab in any pane (existing) |
| Context lines | Use existing git default, expandable |
| Refresh behavior | Auto-refresh (new) |
| Summary behavior | Pinned at top, toggleable |
| Generic viewer model | ViewerItem<T> pattern |
| Side-by-side layout | 50/50 fixed split (resizing in backlog) |
| Edit save behavior | Default to stage-modified, configurable |
