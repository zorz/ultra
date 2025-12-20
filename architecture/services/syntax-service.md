# Syntax Service

The Syntax Service provides syntax highlighting using Shiki.

## Current State

### Location
- `src/features/syntax/shiki-highlighter.ts` - Single file (278 lines)

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Highlighter                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  shiki: ShikiHighlighter (lazy initialized)               │  │
│  │  languageId: string                                       │  │
│  │  content: string (last parsed)                            │  │
│  │  tokenizedLines: ThemedToken[][] (all lines)              │  │
│  │  lineCache: Map<number, HighlightToken[]>                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                        Shiki Library
```

### API

```typescript
interface HighlightToken {
  start: number;   // Column start (0-indexed)
  end: number;     // Column end (exclusive)
  scope: string;   // TextMate scope (unused)
  color?: string;  // Hex color from theme
}

class Highlighter {
  // Initialization
  async initialize(): Promise<void>
  async waitForReady(): Promise<boolean>
  isReady(): boolean

  // Configuration
  setTheme(themeName: string): void
  async setLanguage(languageId: string): Promise<boolean>
  setLanguageSync(languageId: string): boolean
  getLanguage(): string | null

  // Highlighting
  parse(content: string): void
  highlightLine(lineNumber: number): HighlightToken[]

  // Utilities
  clearCache(): void
  getSupportedLanguages(): string[]
  isLanguageSupported(languageId: string): boolean
}
```

### Supported Languages (50+)

- **Web**: TypeScript, TSX, JavaScript, JSX, JSON, JSONC, HTML, CSS, SCSS, LESS, Markdown
- **Systems**: Rust, Go, C, C++, Python, Java, Kotlin, Swift
- **Data**: XML, SVG, YAML, TOML, Dockerfile, Makefile, SQL, GraphQL
- **Other**: Ruby, Bash, Lua, Perl, R, Scala, Elixir, Erlang, Haskell, Clojure, Vim

### Preloaded Languages (11)

TypeScript, TSX, JavaScript, JSX, JSON, CSS, HTML, Markdown, Bash, Python, Rust, Go

### Themes

- catppuccin-frappe (default)
- catppuccin-mocha
- catppuccin-macchiato
- catppuccin-latte
- github-dark
- github-light

### Current Issues

| Issue | Location | Description |
|-------|----------|-------------|
| Console.error usage | Lines 91-93, 151-155, 205-208 | Uses console.error instead of debugLog |
| Memory for large files | Line 74 | Stores all tokenizedLines in memory |
| Hardcoded themes | Lines 118-125 | No dynamic theme registration |
| No metrics | N/A | No timing or cache stats |
| Scope field unused | Lines 9-14 | TextMate scope never used |

---

## Target State

### ECP Interface

```typescript
// Highlighting (optional - UI clients may do this locally)
"syntax/highlight": {
  content: string,
  languageId: string,
  theme?: string
} => {
  lines: HighlightToken[][]
}

"syntax/highlightLine": {
  content: string,
  languageId: string,
  lineNumber: number,
  theme?: string
} => {
  tokens: HighlightToken[]
}

// Language support
"syntax/languages": {} => { languages: string[] }
"syntax/isSupported": { languageId: string } => { supported: boolean }

// Themes
"syntax/themes": {} => { themes: string[] }
"syntax/setTheme": { theme: string } => { success: boolean }
```

### Service Architecture

```typescript
// services/syntax/interface.ts
interface SyntaxService {
  // Initialization
  isReady(): boolean
  waitForReady(): Promise<boolean>

  // Highlighting
  highlight(content: string, languageId: string): HighlightResult
  highlightLine(content: string, languageId: string, lineNumber: number): HighlightToken[]

  // Incremental highlighting (for large documents)
  createSession(documentId: string, languageId: string): SyntaxSession
  updateSession(sessionId: string, content: string): void
  getSessionTokens(sessionId: string, lineNumber: number): HighlightToken[]
  disposeSession(sessionId: string): void

  // Language support
  getSupportedLanguages(): string[]
  isLanguageSupported(languageId: string): boolean
  detectLanguage(filePath: string): string

  // Themes
  getAvailableThemes(): string[]
  setTheme(theme: string): void
  getTheme(): string

  // Metrics (optional)
  getMetrics?(): SyntaxMetrics
}

interface HighlightResult {
  lines: HighlightToken[][];
  languageId: string;
  timing?: number;
}

interface SyntaxSession {
  sessionId: string;
  documentId: string;
  languageId: string;
  version: number;
}

interface SyntaxMetrics {
  parseCount: number;
  cacheHits: number;
  cacheMisses: number;
  averageParseTime: number;
  memoryUsage: number;
}
```

### Incremental Highlighting

For large documents, full tokenization is expensive. Add session-based incremental highlighting:

```typescript
class SyntaxSessionManager {
  private sessions = new Map<string, SyntaxSession>();

  createSession(documentId: string, languageId: string): SyntaxSession {
    const session = {
      sessionId: generateId(),
      documentId,
      languageId,
      version: 0,
      tokenizedLines: [],
      dirtyLines: new Set<number>()
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  updateLines(sessionId: string, startLine: number, endLine: number, content: string[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Only re-tokenize changed lines
    for (let i = startLine; i <= endLine; i++) {
      session.tokenizedLines[i] = this.tokenizeLine(content[i], session.languageId);
    }

    session.version++;
  }

  getTokens(sessionId: string, lineNumber: number): HighlightToken[] {
    const session = this.sessions.get(sessionId);
    return session?.tokenizedLines[lineNumber] ?? [];
  }
}
```

### Headless Mode

In headless/API mode, syntax highlighting becomes optional:

```typescript
// services/syntax/null.ts
class NullSyntaxService implements SyntaxService {
  isReady(): boolean { return true; }
  async waitForReady(): Promise<boolean> { return true; }

  highlight(_content: string, _languageId: string): HighlightResult {
    return { lines: [], languageId: 'plaintext' };
  }

  highlightLine(_content: string, _languageId: string, _lineNumber: number): HighlightToken[] {
    return [];
  }

  // ... other methods return empty/default values
}
```

---

## Migration Steps

### Phase 1: Refactor Current Code

1. **Fix console.error usage**
   - Replace with debugLog

2. **Add metrics collection**
   - Parse timing
   - Cache hit/miss rates

3. **Optimize memory**
   - Consider windowed tokenization for large files
   - Clear tokens for non-visible lines

### Phase 2: Create SyntaxService

1. **Create interface**
   - Current functionality
   - Session-based API for incremental updates

2. **Implement LocalSyntaxService**
   - Wrap existing Highlighter
   - Add session management

3. **Create NullSyntaxService**
   - For headless mode

### Phase 3: ECP Adapter

1. **Create SyntaxServiceAdapter**
   - Map JSON-RPC methods
   - Handle theme changes

### Migration Checklist

```markdown
- [ ] Create services/syntax/ directory
- [ ] Define SyntaxService interface
- [ ] Fix console.error usage in highlighter
- [ ] Add metrics collection
- [ ] Implement session-based incremental highlighting
- [ ] Create LocalSyntaxService
- [ ] Create NullSyntaxService
- [ ] Create SyntaxServiceAdapter for ECP
- [ ] Add tests
- [ ] Update EditorContent to use service
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/features/syntax/shiki-highlighter.ts` | Fix console.error, add metrics |
| `src/ui/panels/editor-content.ts` | Use SyntaxService |
| `src/ui/components/minimap.ts` | Use SyntaxService |

### New Files to Create

```
src/services/syntax/
├── interface.ts      # SyntaxService interface
├── types.ts          # HighlightToken, SyntaxSession, etc.
├── local.ts          # LocalSyntaxService (wraps highlighter)
├── null.ts           # NullSyntaxService (headless)
├── session.ts        # SyntaxSessionManager
├── adapter.ts        # ECP adapter
└── index.ts          # Public exports
```
