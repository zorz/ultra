# Session Service

The Session Service manages user state: settings, keybindings, workspace state, and session persistence.

## Current State

### Location
- `src/config/settings.ts` - In-memory settings store
- `src/config/defaults.ts` - Default values (auto-generated)
- `src/config/settings-loader.ts` - JSON file parser
- `src/config/user-config.ts` - Config orchestration and file watching
- `src/state/session-manager.ts` - Session persistence
- `src/input/keymap.ts` - Keybinding management
- `src/input/keybindings-loader.ts` - Keybindings file parser

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    UserConfigManager                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  File Watchers: settings.json, keybindings.json, theme    │  │
│  │  Config Dir: ~/.ultra/                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│         │                  │                    │                │
│         ▼                  ▼                    ▼                │
│  ┌─────────────┐    ┌─────────────┐      ┌─────────────┐        │
│  │  Settings   │    │   KeyMap    │      │ ThemeLoader │        │
│  │ (in-memory) │    │ (bindings)  │      │  (colors)   │        │
│  └─────────────┘    └─────────────┘      └─────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SessionManager                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Auto-save timer (30s interval)                           │  │
│  │  Sessions: ~/.ultra/sessions/                             │  │
│  │  - paths/<hash>.json  (auto by workspace)                 │  │
│  │  - named/<name>.json  (user-named)                        │  │
│  │  - last-session.json  (tracking)                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Settings (`settings.ts`)

```typescript
interface EditorSettings {
  // Editor (14 properties)
  'editor.fontSize': number;
  'editor.tabSize': number;
  'editor.insertSpaces': boolean;
  'editor.autoIndent': 'none' | 'keep' | 'full';
  'editor.autoClosingBrackets': boolean;
  'editor.wordWrap': 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  'editor.lineNumbers': 'on' | 'off' | 'relative';
  'editor.folding': boolean;
  'editor.minimap.enabled': boolean;
  'editor.minimap.width': number;
  'editor.minimap.scale': number;
  'editor.renderWhitespace': 'none' | 'boundary' | 'selection' | 'all';
  'editor.mouseWheelScrollSensitivity': number;
  'editor.cursorBlinkRate': number;

  // Files (2 properties)
  'files.autoSave': 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange';
  'files.exclude': Record<string, boolean>;

  // Workbench (5 properties)
  'workbench.colorTheme': string;
  'workbench.sideBar.visible': boolean;
  'workbench.sideBar.location': 'left' | 'right';
  'workbench.sideBar.background': string;
  'workbench.startupEditor': 'none' | 'welcomePage' | 'previousSession';

  // Terminal (5 properties)
  'terminal.integrated.shell': string;
  'terminal.integrated.defaultHeight': number;
  'terminal.integrated.defaultWidth': number;
  'terminal.integrated.scrollback': number;

  // Session (8 properties)
  'session.restoreOnStartup': boolean;
  'session.autoSave': boolean;
  'session.autoSaveInterval': number;
  'session.save.openFiles': boolean;
  'session.save.cursorPositions': boolean;
  'session.save.scrollPositions': boolean;
  'session.save.foldState': boolean;
  'session.save.uiLayout': boolean;

  // ... more settings
}

class Settings {
  get<K extends keyof EditorSettings>(key: K): EditorSettings[K]
  set<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void
  update(partial: Partial<EditorSettings>): void
  reset(): void
  onChange<K extends keyof EditorSettings>(key: K, callback: (value: EditorSettings[K]) => void): Unsubscribe
  getAll(): EditorSettings
}
```

### Session State

```typescript
interface SessionState {
  // Open documents
  openFiles: Array<{
    filePath: string;
    isActive: boolean;
    cursorPosition?: Position;
    scrollPosition?: Position;
    foldedRegions?: number[];
  }>;

  // UI layout
  sidebarVisible: boolean;
  sidebarWidth: number;
  terminalVisible: boolean;
  terminalHeight: number;

  // Unsaved content (optional)
  unsavedContent?: Record<string, string>;
}
```

### Keybindings

```typescript
interface KeyBinding {
  key: string;           // "ctrl+s", "cmd+k cmd+j"
  command: string;       // Command ID
  when?: string;         // Context condition (NOT IMPLEMENTED)
  args?: any;            // Command arguments
}

class Keymap {
  getCommand(key: ParsedKey): string | null
  getBindingForCommand(commandId: string): string | null
  loadBindings(bindings: KeyBinding[]): void
  addBinding(binding: KeyBinding): void
  removeBinding(key: string): void
  isChordPending(): boolean
  clearChord(): void
}
```

### Current Issues

| Issue | Location | Description |
|-------|----------|-------------|
| Inconsistent defaults | settings.ts vs defaults.ts | Theme, wordWrap differ |
| No validation | settings.ts | Any value accepted |
| when clause unused | keymap.ts | Context conditions not implemented |
| Console.error usage | commands.ts, keybindings-loader.ts | Anti-pattern |
| Fold state not saved | app.ts:490 | TODO comment, always empty |
| No settings schema | N/A | No validation, no discovery |
| Silent failures | settings-loader.ts | Errors swallowed |
| Magic numbers | keymap.ts | 500ms chord timeout hardcoded |

---

## Target State

### ECP Interface

```typescript
// Settings
"config/get": { key: string } => { value: any }
"config/set": { key: string, value: any } => { success: boolean }
"config/getAll": {} => { settings: EditorSettings }
"config/reset": { key?: string } => { success: boolean }
"config/schema": {} => { schema: SettingsSchema }

// Keybindings
"keybindings/get": {} => { bindings: KeyBinding[] }
"keybindings/set": { bindings: KeyBinding[] } => { success: boolean }
"keybindings/add": { binding: KeyBinding } => { success: boolean }
"keybindings/remove": { key: string } => { success: boolean }
"keybindings/resolve": { key: ParsedKey } => { command: string | null }

// Session
"session/save": { name?: string } => { sessionId: string }
"session/load": { sessionId: string } => SessionState
"session/list": {} => { sessions: SessionInfo[] }
"session/delete": { sessionId: string } => { success: boolean }
"session/current": {} => SessionState

// Themes
"theme/list": {} => { themes: ThemeInfo[] }
"theme/get": { name: string } => { theme: Theme }
"theme/set": { name: string } => { success: boolean }

// Notifications
"config/didChange": { key: string, value: any }
"session/didSave": { sessionId: string }
```

### Service Architecture

```typescript
// services/session/interface.ts
interface SessionService {
  // Settings
  getSetting<K extends keyof EditorSettings>(key: K): EditorSettings[K]
  setSetting<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void
  getAllSettings(): EditorSettings
  resetSettings(key?: string): void
  getSettingsSchema(): SettingsSchema
  onSettingChange<K extends keyof EditorSettings>(key: K, callback: (value: EditorSettings[K]) => void): Unsubscribe

  // Keybindings
  getKeybindings(): KeyBinding[]
  setKeybindings(bindings: KeyBinding[]): void
  addKeybinding(binding: KeyBinding): void
  removeKeybinding(key: string): void
  resolveKeybinding(key: ParsedKey): string | null

  // Sessions
  saveSession(name?: string): Promise<string>
  loadSession(sessionId: string): Promise<SessionState>
  listSessions(): Promise<SessionInfo[]>
  deleteSession(sessionId: string): Promise<void>
  getCurrentSession(): SessionState
  setCurrentSession(state: SessionState): void

  // Themes
  listThemes(): Promise<ThemeInfo[]>
  getTheme(name: string): Promise<Theme>
  setTheme(name: string): Promise<void>
  getCurrentTheme(): Theme

  // Lifecycle
  init(): Promise<void>
  shutdown(): Promise<void>
}

interface SettingsSchema {
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    default: any;
    enum?: any[];
    description?: string;
    minimum?: number;
    maximum?: number;
  }>;
}
```

### Settings Validation

```typescript
// services/session/validation.ts
const settingsSchema: SettingsSchema = {
  properties: {
    'editor.fontSize': {
      type: 'number',
      default: 14,
      minimum: 8,
      maximum: 72,
      description: 'Font size in pixels'
    },
    'editor.tabSize': {
      type: 'number',
      default: 4,
      minimum: 1,
      maximum: 16,
      description: 'Number of spaces per tab'
    },
    'editor.wordWrap': {
      type: 'string',
      default: 'off',
      enum: ['off', 'on', 'wordWrapColumn', 'bounded'],
      description: 'Word wrap mode'
    },
    // ... all settings
  }
};

function validateSetting(key: string, value: any): ValidationResult {
  const schema = settingsSchema.properties[key];
  if (!schema) return { valid: false, error: `Unknown setting: ${key}` };

  // Type checking
  if (typeof value !== schema.type) {
    return { valid: false, error: `Expected ${schema.type}, got ${typeof value}` };
  }

  // Enum checking
  if (schema.enum && !schema.enum.includes(value)) {
    return { valid: false, error: `Must be one of: ${schema.enum.join(', ')}` };
  }

  // Range checking
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return { valid: false, error: `Minimum value is ${schema.minimum}` };
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return { valid: false, error: `Maximum value is ${schema.maximum}` };
    }
  }

  return { valid: true };
}
```

### Context Conditions (when clauses)

```typescript
// services/session/context.ts
interface ContextService {
  // Set context values
  set(key: string, value: any): void
  get(key: string): any

  // Evaluate when clause
  evaluate(when: string): boolean
}

class ContextServiceImpl implements ContextService {
  private context = new Map<string, any>();

  // Standard contexts
  // 'editorFocus': boolean
  // 'terminalFocus': boolean
  // 'sidebarFocus': boolean
  // 'editorLangId': string
  // 'editorHasSelection': boolean
  // 'editorHasMultipleCursors': boolean
  // 'gitEnabled': boolean
  // 'inSearchMode': boolean

  evaluate(when: string): boolean {
    // Parse and evaluate conditions like:
    // "editorFocus && !terminalFocus"
    // "editorLangId == 'typescript'"
    // "editorHasSelection"
  }
}
```

---

## Migration Steps

### Phase 1: Consolidate and Fix

1. **Fix defaults inconsistency**
   - Single source of truth for defaults
   - Remove duplicates from settings.ts and defaults.ts

2. **Add settings validation**
   - Define schema for all settings
   - Validate on set()
   - Log validation errors

3. **Fix anti-patterns**
   - Replace console.error with debugLog
   - Add proper error handling

4. **Implement fold state saving**
   - Track fold regions in Document
   - Serialize in session state

### Phase 2: Create SessionService

1. **Create interface**
   - Combine settings, keybindings, sessions, themes
   - Unified lifecycle

2. **Implement LocalSessionService**
   - Wrap existing components
   - Add validation
   - Add schema support

3. **Add context evaluation**
   - Implement when clause parsing
   - Track editor state for contexts

### Phase 3: ECP Adapter

1. **Create SessionServiceAdapter**
   - Map JSON-RPC methods
   - Handle config change notifications

### Migration Checklist

```markdown
- [ ] Create services/session/ directory
- [ ] Define SessionService interface
- [ ] Create settings schema with validation
- [ ] Fix defaults inconsistency (single source of truth)
- [ ] Replace console.error with debugLog
- [ ] Implement fold state saving
- [ ] Implement context evaluation (when clauses)
- [ ] Make chord timeout configurable
- [ ] Create LocalSessionService
- [ ] Create SessionServiceAdapter for ECP
- [ ] Add tests
- [ ] Update app.ts to use service
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/config/settings.ts` | Add validation, remove duplicate defaults |
| `src/config/defaults.ts` | Single source of defaults |
| `src/config/user-config.ts` | Use SessionService |
| `src/input/keymap.ts` | Add context evaluation |
| `src/input/commands.ts` | Fix console.error |
| `src/input/keybindings-loader.ts` | Fix console.error |
| `src/state/session-manager.ts` | Integrate into service |
| `src/app.ts` | Fix fold state saving (line 490) |

### New Files to Create

```
src/services/session/
├── interface.ts      # SessionService interface
├── types.ts          # SessionState, SettingsSchema, etc.
├── schema.ts         # Settings validation schema
├── validation.ts     # Validation logic
├── context.ts        # Context evaluation (when clauses)
├── local.ts          # LocalSessionService
├── adapter.ts        # ECP adapter
└── index.ts          # Public exports
```

### Default Values (Single Source)

```typescript
// services/session/defaults.ts
export const DEFAULT_SETTINGS: EditorSettings = {
  'editor.fontSize': 14,
  'editor.tabSize': 4,
  'editor.insertSpaces': true,
  'editor.autoIndent': 'full',
  'editor.wordWrap': 'off',
  'editor.lineNumbers': 'on',
  'workbench.colorTheme': 'catppuccin-frappe',
  // ... all settings with single authoritative values
};

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // All default keybindings
];
```
