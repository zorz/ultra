# Document Service

The Document Service is the core of Ultra, managing text buffers, cursors, selections, and edit history.

## Current State

### Location
- `src/core/buffer.ts` - Piece table buffer implementation
- `src/core/cursor.ts` - Cursor and multi-cursor management
- `src/core/document.ts` - Document model combining buffer + cursor + undo
- `src/core/undo.ts` - Undo/redo system

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Document                                 │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │   Buffer    │  │  CursorManager  │  │    UndoManager      │  │
│  │  (content)  │  │  (positions)    │  │    (history)        │  │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘  │
│                                                                  │
│  Metadata: filePath, fileName, language, isDirty, encoding       │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### Buffer (`buffer.ts`)
**Piece Table Implementation** - Efficient for insert-heavy workloads

```typescript
interface Position { line: number; column: number; }
interface Range { start: Position; end: Position; }

class Buffer {
  // Content access
  getContent(): string
  getLine(lineNumber: number): string
  getLineLength(lineNumber: number): number

  // Editing
  insert(offset: number, text: string): void
  insertAt(position: Position, text: string): void
  delete(start: number, end: number): void
  deleteRange(start: Position, end: Position): void
  replace(start: number, end: number, text: string): void

  // Position conversion
  positionToOffset(position: Position): number
  offsetToPosition(offset: number): Position

  // State management
  clone(): Buffer
  getSnapshot(): BufferSnapshot
  restoreSnapshot(snapshot: BufferSnapshot): void

  // Performance
  readonly version: number  // Increments on each change
}
```

**Internals:**
- `originalBuffer: string` - Initial content (immutable)
- `addBuffer: string` - All inserted text (append-only)
- `pieces: Piece[]` - Array of spans referencing either buffer
- `lineCache: number[]` - Lazy line boundary index

#### CursorManager (`cursor.ts`)

```typescript
interface Cursor {
  position: Position;
  selection: Selection | null;
  desiredColumn: number;  // For vertical movement
}

class CursorManager {
  // Access
  getCursors(): Cursor[]
  getPrimaryCursor(): Cursor

  // Single cursor
  setSingle(position: Position): void
  setPosition(index: number, position: Position): void

  // Multi-cursor
  addCursor(position: Position): void
  addCursorWithSelection(position: Position, selection: Selection): void
  clearSecondary(): void

  // Movement
  moveCursors(mover: (cursor: Cursor) => Position, selecting: boolean): void

  // Selection
  setSelections(selections: Selection[]): void
  getSelections(): Selection[]
  getSelectedRanges(): Range[]
  clearSelections(): void

  // State
  getSnapshot(): CursorSnapshot
  restoreSnapshot(snapshot: CursorSnapshot): void
}
```

#### UndoManager (`undo.ts`)

```typescript
interface EditOperation {
  type: 'insert' | 'delete';
  position: Position;
  text: string;
}

interface UndoAction {
  operations: EditOperation[];
  cursorsBefore: Cursor[];
  cursorsAfter: Cursor[];
  timestamp?: number;
}

class UndoManager {
  push(action: UndoAction): void
  undo(): UndoAction | null
  redo(): UndoAction | null
  canUndo(): boolean
  canRedo(): boolean
  clear(): void
  breakUndoGroup(): void  // Prevent merging with next operation

  readonly undoCount: number
  readonly redoCount: number
}
```

**Smart Merging:**
- Consecutive single-character inserts on same line merge
- Consecutive backspaces merge
- 300ms timeout between groups
- Multi-cursor operations don't merge

#### Document (`document.ts`)

```typescript
class Document {
  // Factory
  static async fromFile(filePath: string): Promise<Document>

  // Metadata
  readonly filePath: string | null
  readonly fileName: string
  readonly language: string
  isDirty: boolean
  encoding: string
  lineEnding: '\n' | '\r\n'

  // Buffer delegation
  readonly content: string
  readonly lineCount: number
  readonly length: number
  readonly version: number
  getLine(lineNumber: number): string

  // Editing
  insert(text: string): void
  backspace(): void
  delete(): void
  newline(): void
  insertWithAutoDedent(char: string): void
  outdent(): void

  // Cursor movement
  moveLeft/Right/Up/Down(selecting: boolean): void
  moveToLineStart/End(selecting: boolean): void
  moveWordLeft/Right(selecting: boolean): void
  movePageUp/Down(linesPerPage: number, selecting: boolean): void
  moveToDocumentStart/End(selecting: boolean): void

  // Selection
  selectAll(): void
  selectLine(): void
  selectNextOccurrence(): void
  selectAllOccurrences(): void
  addCursorAbove/Below(): void
  splitSelectionIntoLines(): void

  // Selection access
  getSelectedText(): string
  getAllSelectedTexts(): string[]

  // File I/O
  async save(): Promise<boolean>
  async saveAs(filePath: string): Promise<boolean>
  async reload(): Promise<void>

  // Undo/Redo
  undo(): void
  redo(): void
}
```

### Supporting Modules

#### Auto-Indent (`auto-indent.ts`)
- `calculateNewLineIndent()` - Smart indentation for new lines
- `shouldIncreaseIndent()` - Detect indent triggers (`{`, `:`, `=>`)
- `shouldDedentOnChar()` - Auto-dedent on closing brackets
- `findMatchingBracketIndent()` - Match opening bracket's indent

#### Auto-Pair (`auto-pair.ts`)
- `shouldAutoPair()` - When to insert closing bracket/quote
- `shouldSkipClosing()` - Skip over existing closing char
- `shouldDeletePair()` - Backspace deletes both

#### Bracket Match (`bracket-match.ts`)
- `findMatchingBracket()` - For highlight rendering
- Supports: `{}`, `[]`, `()`
- Priority: cursor position, then character before cursor

#### Fold Manager (`fold.ts`)
- `computeRegions()` - Detect foldable regions
- `toggleFold()`, `foldAll()`, `unfoldAll()`
- `visibleToBuffer()`, `bufferToVisible()` - Line mapping

### Current Issues

| Issue | Location | Description |
|-------|----------|-------------|
| Hardcoded tabSize | `document.ts:813` | Uses `2` instead of `settings.get('editor.tabSize')` |
| Exposed internals | `cursor.ts` | `getMutableCursors()` exposes internal array |
| No validation | Various | Operations assume valid state |
| Global settings | `document.ts` | Direct dependency on settings singleton |
| No change events | `document.ts` | No DocumentChangeListener pattern |
| Memory unbounded | `cache.ts` | CacheManager has no size limits |
| Line cache rebuild | `buffer.ts` | Full rebuild on any edit |

---

## Target State

### ECP Interface

The Document Service exposes these ECP methods:

```typescript
// Document lifecycle
"document/open": { uri: string } => { documentId: string, content: string, version: number }
"document/close": { documentId: string } => { success: boolean }
"document/list": {} => { documents: DocumentInfo[] }

// Content access
"document/content": { documentId: string } => { content: string, version: number }
"document/line": { documentId: string, line: number } => { text: string }
"document/range": { documentId: string, range: Range } => { text: string }

// Editing
"document/insert": { documentId: string, position: Position, text: string } => OperationResult
"document/delete": { documentId: string, range: Range } => OperationResult
"document/replace": { documentId: string, range: Range, text: string } => OperationResult
"document/edit": { documentId: string, edits: Edit[] } => OperationResult  // Batch edits

// Cursor management
"cursor/get": { documentId: string } => { cursors: Cursor[] }
"cursor/set": { documentId: string, cursors: Cursor[] } => { success: boolean }
"cursor/move": { documentId: string, direction: Direction, selecting: boolean } => { cursors: Cursor[] }

// Selection
"selection/get": { documentId: string } => { selections: Selection[] }
"selection/set": { documentId: string, selections: Selection[] } => { success: boolean }
"selection/selectAll": { documentId: string } => { selection: Selection }

// Undo/Redo
"document/undo": { documentId: string } => OperationResult
"document/redo": { documentId: string } => OperationResult
"document/undoHistory": { documentId: string } => { canUndo: boolean, canRedo: boolean, undoCount: number }

// Notifications (server → client)
"document/didChange": { documentId: string, version: number, changes: Change[] }
"document/didSave": { documentId: string, uri: string }
"cursor/didChange": { documentId: string, cursors: Cursor[] }
```

### Service Architecture

```typescript
// services/document/interface.ts
interface DocumentService {
  // Lifecycle
  openDocument(uri: string): Promise<DocumentHandle>
  closeDocument(documentId: string): Promise<void>
  getDocument(documentId: string): DocumentHandle | null
  listDocuments(): DocumentInfo[]

  // Content
  getContent(documentId: string): string
  getLine(documentId: string, line: number): string
  getRange(documentId: string, range: Range): string

  // Editing
  insert(documentId: string, position: Position, text: string): OperationResult
  delete(documentId: string, range: Range): OperationResult
  replace(documentId: string, range: Range, text: string): OperationResult
  applyEdits(documentId: string, edits: Edit[]): OperationResult

  // Cursors
  getCursors(documentId: string): Cursor[]
  setCursors(documentId: string, cursors: Cursor[]): void
  moveCursors(documentId: string, direction: Direction, selecting: boolean): Cursor[]

  // Undo
  undo(documentId: string): OperationResult
  redo(documentId: string): OperationResult

  // Events
  onDocumentChange(callback: DocumentChangeCallback): Unsubscribe
  onCursorChange(callback: CursorChangeCallback): Unsubscribe
}

// services/document/local.ts
class LocalDocumentService implements DocumentService {
  // Implementation using existing Buffer, CursorManager, UndoManager
}

// services/document/adapter.ts
class DocumentServiceAdapter {
  // Maps ECP JSON-RPC calls to DocumentService methods
  handleRequest(method: string, params: unknown): Promise<unknown>
}
```

### Key Improvements

1. **Document IDs**: UUID-based document identification (not file paths)
2. **Version Tracking**: Every edit increments version for conflict detection
3. **Change Events**: Proper event emission on all changes
4. **Batch Edits**: Support multiple edits in one operation
5. **Edit Validation**: Validate positions and ranges before applying
6. **Memory Bounds**: LRU cache for document metadata

---

## Migration Steps

### Phase 1: Interface Extraction (No Breaking Changes)

1. **Create DocumentService interface** (`services/document/interface.ts`)
   - Define all public methods
   - Define event types
   - Define result types

2. **Create DocumentHandle wrapper**
   - Wraps existing Document class
   - Adds document ID
   - Adds event emission

3. **Add change event emission**
   - Modify Buffer to emit on changes
   - Modify CursorManager to emit on cursor changes
   - No external API changes

### Phase 2: Service Implementation

1. **Create LocalDocumentService**
   - Implements DocumentService interface
   - Uses existing Buffer/Cursor/Undo internally
   - Manages document registry

2. **Fix known issues**
   - Use settings for tabSize
   - Add input validation
   - Add memory bounds to cache

3. **Add DocumentServiceAdapter**
   - JSON-RPC method handlers
   - Parameter validation
   - Error responses

### Phase 3: Integration

1. **Update App to use DocumentService**
   - Replace direct Document usage
   - Route through service

2. **Update UI components**
   - Get document via service
   - Subscribe to change events

3. **Add tests**
   - Unit tests for service methods
   - Integration tests for ECP protocol

### Migration Checklist

```markdown
- [ ] Create services/document/ directory structure
- [ ] Define DocumentService interface
- [ ] Create DocumentHandle wrapper class
- [ ] Add EventEmitter to Buffer class
- [ ] Add EventEmitter to CursorManager class
- [ ] Create LocalDocumentService implementation
- [ ] Fix hardcoded tabSize (document.ts:813)
- [ ] Add validation to all public methods
- [ ] Add memory limits to cache
- [ ] Create DocumentServiceAdapter for ECP
- [ ] Update App.ts to use DocumentService
- [ ] Update EditorContent to use DocumentService
- [ ] Update all dialogs using Document directly
- [ ] Add comprehensive tests
- [ ] Update CLAUDE.md with new patterns
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/core/buffer.ts` | Add EventEmitter, emit on changes |
| `src/core/cursor.ts` | Add EventEmitter, emit on changes |
| `src/core/document.ts` | Remove file I/O (move to FileService), fix tabSize |
| `src/core/undo.ts` | No changes needed |
| `src/core/cache.ts` | Add size limits, LRU eviction |
| `src/app.ts` | Use DocumentService instead of Document directly |
| `src/ui/panels/editor-content.ts` | Subscribe to document events |

### New Files to Create

```
src/services/document/
├── interface.ts      # DocumentService interface
├── types.ts          # DocumentHandle, OperationResult, etc.
├── local.ts          # LocalDocumentService implementation
├── adapter.ts        # ECP adapter
└── index.ts          # Public exports
```
