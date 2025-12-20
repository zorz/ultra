# Terminal Service

The Terminal Service provides terminal I/O abstraction. In ECP architecture, it becomes a client-side concern (only needed for TUI).

## Current State

### Location
- `src/terminal/ansi.ts` - ANSI escape codes and utilities
- `src/terminal/index.ts` - High-level Terminal API
- `src/terminal/input.ts` - Raw input parsing
- `src/terminal/pty.ts` - Pseudo-terminal (PTY) support

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Terminal (index.ts)                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  High-level API: init(), render(), moveTo(), setFg()     │  │
│  │  Output buffering for flicker-free rendering              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│         ┌────────────────────┴────────────────────┐              │
│         ▼                                         ▼              │
│  ┌─────────────┐                           ┌─────────────┐       │
│  │   ANSI      │                           │ InputHandler│       │
│  │  (ansi.ts)  │                           │ (input.ts)  │       │
│  │  Escape     │                           │  Key/Mouse  │       │
│  │  Codes      │                           │  Parsing    │       │
│  └─────────────┘                           └─────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        PTY (pty.ts)                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ScreenBuffer: Terminal cell grid with scrollback        │  │
│  │  AnsiParser: State machine for escape sequences          │  │
│  │  PTY: bun-pty integration for shell processes            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### ANSI Module (`ansi.ts`)

```typescript
// Control sequences
const ESC = '\x1b';
const CSI = '\x1b[';

// Cursor control
const CURSOR = {
  hide: CSI + '?25l',
  show: CSI + '?25h',
  moveTo: (row, col) => CSI + row + ';' + col + 'H',
  // ... moveUp, moveDown, moveRight, moveLeft
};

// Screen control
const SCREEN = {
  clear: CSI + '2J',
  clearLine: CSI + '2K',
  enterAlt: CSI + '?1049h',
  exitAlt: CSI + '?1049l',
  // ...
};

// Colors (16 + 256 + RGB)
const FG = { black, red, green, yellow, blue, magenta, cyan, white, /* bright variants */ };
const BG = { /* same colors */ };
function fgHex(hex: string): string;
function bgHex(hex: string): string;

// Mouse tracking
const MOUSE = {
  enableBasic, disableBasic,
  enableButton, disableButton,
  enableAny, disableAny,
  enableSGR, disableSGR  // For coordinates > 223
};

// Utilities
function getDisplayWidth(str: string): number;  // CJK awareness
function truncateToWidth(str: string, maxWidth: number): string;
function padToWidth(str: string, width: number, align: 'left'|'right'|'center'): string;
```

### Terminal Class (`index.ts`)

```typescript
class Terminal {
  // Properties
  width: number;
  height: number;

  // Lifecycle
  init(): void;
  cleanup(): void;

  // Output buffering
  startBuffer(): void;
  flushBuffer(): void;

  // Cursor
  moveTo(row: number, col: number): void;
  hideCursor(): void;
  showCursor(): void;
  setCursorShape(shape: 'block' | 'underline' | 'bar'): void;

  // Colors
  setFg(color: string): void;
  setBg(color: string): void;
  setFgHex(hex: string): void;
  setBgHex(hex: string): void;
  setFgRgb(r: number, g: number, b: number): void;
  setBgRgb(r: number, g: number, b: number): void;

  // Styles
  bold(): void;
  italic(): void;
  underline(): void;
  inverse(): void;
  dim(): void;
  resetStyle(): void;

  // Drawing
  drawAt(row: number, col: number, text: string): void;
  drawStyledAt(row: number, col: number, text: string, options?: DrawOptions): void;
  fillRect(row: number, col: number, width: number, height: number, char: string): void;
  clearLine(row: number): void;

  // Input
  onKey(callback: KeyCallback): Unsubscribe;
  onMouse(callback: MouseCallback): Unsubscribe;
  onResize(callback: ResizeCallback): Unsubscribe;

  // Mouse
  enableMouse(): void;
  disableMouse(): void;
}
```

### InputHandler (`input.ts`)

```typescript
interface KeyEvent {
  key: string;      // 'a', 'ENTER', 'UP', 'F1', etc.
  char?: string;    // Original character if printable
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;    // Cmd on macOS
}

interface MouseEventData {
  type: 'press' | 'release' | 'move' | 'wheel';
  button: 'left' | 'middle' | 'right' | 'none' | 'wheelUp' | 'wheelDown';
  x: number;
  y: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

class InputHandler {
  start(): void;
  stop(): void;
  onKey(callback: KeyCallback): Unsubscribe;
  onMouse(callback: MouseCallback): Unsubscribe;
  onResize(callback: ResizeCallback): Unsubscribe;
}
```

**Supported Input Formats:**
- CSI u (Fixterms/Kitty keyboard protocol)
- Legacy escape sequences (xterm-style)
- SGR mouse events
- X10 mouse events (legacy)
- Control characters
- macOS Option key Unicode

### PTY Module (`pty.ts`)

```typescript
interface PTYOptions {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  scrollback?: number;
}

interface TerminalCell {
  char: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  inverse: boolean;
}

class PTY {
  async start(): Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  isRunning(): boolean;

  // Buffer access
  getBuffer(): TerminalCell[][];
  getCursor(): { x: number, y: number };
  getScrollback(): TerminalCell[][];
  getViewOffset(): number;

  // Scrolling
  scrollViewUp(lines: number): void;
  scrollViewDown(lines: number): void;
  resetViewOffset(): void;

  // Callbacks
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
  onTitle(callback: (title: string) => void): void;
  onUpdate(callback: () => void): void;
}
```

**ScreenBuffer** maintains terminal state:
- 2D grid of TerminalCell
- Cursor position and attributes
- Scrollback history (configurable limit)
- View offset for scrolling through history

**AnsiParser** processes escape sequences:
- State machine: normal → escape → csi/osc
- Implements cursor movement, clearing, colors
- Graphics rendition (SGR) for colors/styles

### Current Issues

| Issue | Location | Description |
|-------|----------|-------------|
| Console.error usage | pty.ts:719 | Uses console.error instead of debugLog |
| No buffer size limit | input.ts | Input buffer grows unbounded |
| Shift detection heuristic | input.ts:494 | Unreliable for non-ASCII |
| Shell default | pty.ts:663 | `/bin/zsh` may not exist |
| Hardcoded ANSI colors | pty.ts:54-57 | Doesn't match theme |
| Title callback unused | pty.ts:831 | OSC sequences ignored |
| Tab stops hardcoded | pty.ts | Always 8, not configurable |

---

## Target State

In ECP architecture, the Terminal Service becomes **client-side only**. The server doesn't need terminal I/O.

### Client-Side Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TUI Client (clients/tui/)                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Terminal Service (local to TUI)                          │  │
│  │  - Input handling                                         │  │
│  │  - Output rendering                                       │  │
│  │  - PTY management                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ECP Client Connection                                    │  │
│  │  - Send commands to server                                │  │
│  │  - Receive notifications                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                        JSON-RPC 2.0
                              │
                              ▼
                        ECP Server
```

### Embedded Terminal (PTY) in ECP

While terminal I/O is client-side, **embedded terminal sessions** (the terminal pane) could be server-managed:

```typescript
// ECP methods for embedded terminal
"terminal/create": {
  shell?: string,
  cwd?: string,
  env?: Record<string, string>,
  cols?: number,
  rows?: number
} => {
  terminalId: string
}

"terminal/write": {
  terminalId: string,
  data: string
} => {
  success: boolean
}

"terminal/resize": {
  terminalId: string,
  cols: number,
  rows: number
} => {
  success: boolean
}

"terminal/close": {
  terminalId: string
} => {
  success: boolean
}

"terminal/list": {} => {
  terminals: TerminalInfo[]
}

// Notifications
"terminal/output": {
  terminalId: string,
  data: string
}

"terminal/exit": {
  terminalId: string,
  exitCode: number
}
```

This allows:
- Remote terminal access over ECP
- AI agents to run commands
- Multiple clients sharing terminal sessions

### Service Architecture

```typescript
// clients/tui/terminal/interface.ts
interface TerminalIO {
  // Lifecycle
  init(): void;
  cleanup(): void;

  // Screen dimensions
  getWidth(): number;
  getHeight(): number;

  // Rendering
  startBuffer(): void;
  flushBuffer(): void;
  moveTo(row: number, col: number): void;
  write(text: string): void;

  // Styling
  setFg(color: string): void;
  setBg(color: string): void;
  setStyle(style: TextStyle): void;
  resetStyle(): void;

  // Input
  onKey(callback: KeyCallback): Unsubscribe;
  onMouse(callback: MouseCallback): Unsubscribe;
  onResize(callback: ResizeCallback): Unsubscribe;

  // Mouse
  enableMouse(): void;
  disableMouse(): void;
}

// services/terminal/interface.ts (for embedded terminals)
interface EmbeddedTerminalService {
  create(options: TerminalOptions): Promise<string>;  // Returns terminalId
  write(terminalId: string, data: string): void;
  resize(terminalId: string, cols: number, rows: number): void;
  close(terminalId: string): void;
  list(): TerminalInfo[];

  onOutput(terminalId: string, callback: (data: string) => void): Unsubscribe;
  onExit(terminalId: string, callback: (code: number) => void): Unsubscribe;
}
```

---

## Migration Steps

### Phase 1: Reorganize

1. **Move terminal I/O to clients/tui/**
   - ansi.ts → clients/tui/terminal/ansi.ts
   - index.ts → clients/tui/terminal/terminal.ts
   - input.ts → clients/tui/terminal/input.ts

2. **Keep PTY in services/**
   - For embedded terminal sessions
   - Expose via ECP

3. **Fix issues**
   - Replace console.error with debugLog
   - Add input buffer size limit
   - Fix shell detection

### Phase 2: Create Embedded Terminal Service

1. **Create EmbeddedTerminalService**
   - Manage multiple PTY sessions
   - Expose via ECP

2. **Add ECP adapter**
   - Map JSON-RPC methods
   - Handle output streaming

### Phase 3: TUI Client

1. **Create TUI client structure**
   - Local terminal I/O
   - ECP connection
   - UI rendering

### Migration Checklist

```markdown
- [ ] Create clients/tui/terminal/ directory
- [ ] Move ansi.ts, terminal.ts, input.ts to client
- [ ] Create services/terminal/ for PTY
- [ ] Define EmbeddedTerminalService interface
- [ ] Fix console.error usage
- [ ] Add input buffer size limit
- [ ] Fix shell detection (fallback to /bin/sh)
- [ ] Create EmbeddedTerminalServiceAdapter for ECP
- [ ] Update terminal-pane.ts to use service
- [ ] Add tests
```

### Files to Move

| Current | Target |
|---------|--------|
| `src/terminal/ansi.ts` | `src/clients/tui/terminal/ansi.ts` |
| `src/terminal/index.ts` | `src/clients/tui/terminal/terminal.ts` |
| `src/terminal/input.ts` | `src/clients/tui/terminal/input.ts` |
| `src/terminal/pty.ts` | `src/services/terminal/pty.ts` |

### New Structure

```
src/
├── services/terminal/      # Server-side (embedded terminals)
│   ├── interface.ts        # EmbeddedTerminalService
│   ├── pty.ts              # PTY management
│   ├── adapter.ts          # ECP adapter
│   └── index.ts
│
└── clients/tui/terminal/   # Client-side (TUI I/O)
    ├── ansi.ts             # ANSI escape codes
    ├── terminal.ts         # Terminal class
    ├── input.ts            # Input handling
    └── index.ts
```
