# Buffer Module

The Buffer module provides Ultra's core text storage using a piece table data structure.

## Overview

Ultra uses a [piece table](https://en.wikipedia.org/wiki/Piece_table) instead of a gap buffer or rope. This provides:

- **O(1) average insert/delete** - Operations don't require moving large amounts of text
- **Efficient undo/redo** - Original content is never modified
- **Memory efficiency** - Text isn't duplicated on edits

## Location

```
src/core/buffer.ts
```

## Integration with Document Service

The Buffer is the low-level text storage used by the Document Service:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Document Service                                │
│  (src/services/document/)                                           │
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │  Document   │───▶│   Buffer    │    │ Undo Stack  │             │
│  │  (wrapper)  │    │ (piece tbl) │    │ (snapshots) │             │
│  └─────────────┘    └─────────────┘    └─────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
```

Clients access text through the Document Service ECP API, not the Buffer directly.

## Key Concepts

### Piece Table Structure

```
Original Buffer: "Hello World"  (immutable)
Add Buffer: " Beautiful"        (append-only)

Pieces: [
  { source: 'original', start: 0, length: 5 },   // "Hello"
  { source: 'add', start: 0, length: 10 },       // " Beautiful"
  { source: 'original', start: 5, length: 6 }    // " World"
]

Result: "Hello Beautiful World"
```

### Position vs Offset

- **Offset**: Absolute character index from start of document (0-indexed)
- **Position**: `{ line, column }` - both 0-indexed

```typescript
// Convert between them
const offset = buffer.positionToOffset({ line: 5, column: 10 });
const position = buffer.offsetToPosition(150);
```

## API Reference

### Constructor

```typescript
const buffer = new Buffer();                    // Empty buffer
const buffer = new Buffer("Initial content");   // With content
```

### Properties

```typescript
buffer.length;     // Total character count
buffer.lineCount;  // Number of lines
```

### Reading Content

```typescript
// Get full content
const content = buffer.getContent();

// Get a specific line (0-indexed, without newline)
const line = buffer.getLine(5);

// Get content by offset range
const text = buffer.getRange(start, end);

// Get content by position range
const text = buffer.getRangeByPosition(
  { line: 0, column: 5 },
  { line: 2, column: 10 }
);

// Get line length (excluding newline)
const len = buffer.getLineLength(lineNumber);
```

### Modifying Content

```typescript
// Insert at offset
buffer.insert(offset, "text to insert");

// Insert at position
buffer.insertAt({ line: 5, column: 0 }, "text");

// Delete by offset range (returns deleted text)
const deleted = buffer.delete(start, end);

// Delete by position range
const deleted = buffer.deleteRange(startPos, endPos);

// Replace (delete + insert)
const deleted = buffer.replace(start, end, "new text");
const deleted = buffer.replaceRange(startPos, endPos, "new text");
```

### Position Conversion

```typescript
// Position to offset
const offset = buffer.positionToOffset({ line: 5, column: 10 });

// Offset to position
const pos = buffer.offsetToPosition(150);
// Returns: { line: 5, column: 10 }
```

### Snapshots (for undo/redo)

```typescript
// Get current state
const snapshot = buffer.getSnapshot();
// Returns: { pieces: [...], addBuffer: "..." }

// Restore from snapshot
buffer.restoreSnapshot(snapshot);

// Clone buffer (deep copy)
const copy = buffer.clone();
```

## Types

```typescript
interface Position {
  line: number;    // 0-indexed line number
  column: number;  // 0-indexed column (character offset)
}

interface Range {
  start: Position;
  end: Position;
}
```

## Internal Structure

### Piece

```typescript
interface Piece {
  source: 'original' | 'add';
  start: number;   // Start offset in source buffer
  length: number;  // Length of this piece
}
```

### Line Cache

The buffer maintains a line cache for efficient line-based operations:

```typescript
interface LineInfo {
  pieceIndex: number;
  offsetInPiece: number;
  lineStartOffset: number;  // Absolute offset from document start
}
```

The cache is invalidated after any modification and rebuilt lazily.

## Usage Examples

### Basic Editing

```typescript
import { Buffer } from './core/buffer.ts';

const buffer = new Buffer("Hello World");

// Insert at position
buffer.insertAt({ line: 0, column: 5 }, " Beautiful");
console.log(buffer.getContent()); // "Hello Beautiful World"

// Delete range
buffer.delete(0, 6);
console.log(buffer.getContent()); // "Beautiful World"
```

### Line-Based Operations

```typescript
const buffer = new Buffer(`line 1
line 2
line 3`);

console.log(buffer.lineCount);      // 3
console.log(buffer.getLine(1));     // "line 2"
console.log(buffer.getLineLength(0)); // 6
```

### Undo Support

```typescript
const buffer = new Buffer("Hello");

// Save state before edit
const beforeEdit = buffer.getSnapshot();

// Make edit
buffer.insert(5, " World");
console.log(buffer.getContent()); // "Hello World"

// Undo
buffer.restoreSnapshot(beforeEdit);
console.log(buffer.getContent()); // "Hello"
```

## Performance Characteristics

| Operation | Average | Worst Case |
|-----------|---------|------------|
| Insert | O(1) | O(n) pieces |
| Delete | O(n) pieces | O(n) pieces |
| Get line | O(1) cached | O(n) uncached |
| Position to offset | O(log n) | O(log n) |
| Offset to position | O(log n) | O(log n) |

## Document Service Integration

The Document Service wraps Buffer and provides:

- ECP API for clients
- File I/O operations
- Dirty state tracking
- Undo/redo history management
- LSP notifications

```typescript
// Via ECP (preferred)
const { content } = await ecpServer.request('document/content', { documentId });

// Internally, Document Service uses Buffer
class LocalDocumentService {
  private documents: Map<string, { buffer: Buffer; ... }>;

  async getContent(documentId: string): Promise<string> {
    const doc = this.documents.get(documentId);
    return doc.buffer.getContent();
  }
}
```

## Related Documentation

- [ECP Protocol](../architecture/ecp.md) - Editor Command Protocol
- [Document Service](../architecture/overview.md) - Document Service ECP API
- [Data Flow](../architecture/data-flow.md) - Text editing flow
