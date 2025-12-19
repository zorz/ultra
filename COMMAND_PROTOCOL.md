

---

## COMMAND-PROTOCOL.md

# Ultra Command Protocol

## Overview

The Command Protocol is a unified API that exposes all editor functionality through a single interface. Every action in Ultra - whether triggered by keyboard shortcut, command palette, CLI, or external agent - flows through this protocol. This means any current implementation of commands needs to be redone to follow this new paradigm.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Command Protocol                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Command Registry                       │    │
│  │     ultra.openFile, ultra.save, ultra.edit, ...         │    │
│  └─────────────────────────────────────────────────────────┘    │
│         ▲           ▲           ▲           ▲                   │
│         │           │           │           │                   │
│    Keybinding   Command      CLI Args    IPC/Agent              │
│                 Palette                   Socket                │
│                                              │                  │
│                                    ┌─────────┴─────────┐        │
│                                    │ Validator Plugin  │        │
│                                    │    (optional)     │        │
│                                    └───────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Single source of truth** - All actions are commands
2. **Source tracking** - Know if command came from human, AI, CLI, or IPC
3. **Validation hooks** - Optional plugin interface for external validators (e.g., COR)
4. **Structured feedback** - Rich error responses for AI agents to learn from
5. **Introspectable** - Commands are queryable, documented, and typed

---

## Directory Structure

```
src/commands/
├── types.ts                    # Core type definitions
├── registry.ts                 # Command registration and lookup
├── executor.ts                 # Command execution with validation hooks
├── context-provider.ts         # Build CommandContext from current state
├── validator-interface.ts      # Plugin interface for external validators
├── validator-registry.ts       # Manage validator plugins
├── core/                       # Built-in commands
│   ├── index.ts               # Export all core commands
│   ├── file.ts                # File operations
│   ├── edit.ts                # Text editing
│   ├── navigation.ts          # Cursor/viewport movement
│   ├── selection.ts           # Selection operations
│   ├── query.ts               # Read-only queries (for agents)
│   ├── view.ts                # UI commands
│   ├── git.ts                 # Git operations
│   └── ai.ts                  # AI-specific commands
└── ipc/
    ├── server.ts              # Unix socket server
    └── client.ts              # Client for CLI/external use
```

---

## Core Types

### src/commands/types.ts

```typescript
import type { JSONSchema7 } from 'json-schema';

// ============================================
// Command Definition
// ============================================

export interface Command<TArgs = unknown, TResult = unknown> {
  /** Unique identifier (e.g., "ultra.openFile") */
  id: string;
  
  /** Human-readable title for command palette */
  title: string;
  
  /** Longer description */
  description?: string;
  
  /** Category for grouping in command palette */
  category?: string;
  
  /** JSON Schema for argument validation */
  args?: JSONSchema7;
  
  /** JSON Schema for return type documentation */
  returns?: JSONSchema7;
  
  /** Command implementation */
  handler: CommandHandler<TArgs, TResult>;
  
  /** Default keybinding (e.g., "ctrl+s") */
  keybinding?: string;
  
  /** Condition for when command is available (e.g., "editorFocus") */
  when?: string;
  
  /** Whether command is exposed to AI agents (default: true) */
  aiExposed?: boolean;
}

export type CommandHandler<TArgs, TResult> = (
  ctx: CommandContext,
  args: TArgs
) => Promise<CommandResult<TResult>>;

// ============================================
// Execution Context
// ============================================

export interface CommandContext {
  /** Who/what invoked this command */
  source: CommandSource;
  
  /** Current editor state */
  editor: EditorState | null;
  
  /** Workspace state */
  workspace: WorkspaceState;
  
  /** Available services */
  services: CommandServices;
  
  /** Validator registry (if validators loaded) */
  validators?: ValidatorRegistry;
  
  /** Arbitrary metadata (validators can attach info here) */
  metadata: Map<string, unknown>;
}

export interface CommandSource {
  /** Source type */
  type: 'human' | 'ai' | 'cli' | 'ipc' | 'internal' | 'extension';
  
  /** Identifier for AI agent (for tracking) */
  agentId?: string;
  
  /** Session identifier (for tracking) */
  sessionId?: string;
  
  /** Extension identifier (if from extension) */
  extensionId?: string;
}

export interface EditorState {
  activeBuffer: {
    path: string;
    content: string;
    language: string;
    isDirty: boolean;
    version: number;
  } | null;
  
  cursor: Position | null;
  selection: Selection | null;
  selections: Selection[];  // Multi-cursor
  visibleRange: Range | null;
}

export interface WorkspaceState {
  root: string;
  openFiles: Array<{ path: string; isDirty: boolean }>;
}

export interface CommandServices {
  git: GitService;
  lsp: LSPService;
  ui: UIService;
  fs: FileSystemService;
}

// ============================================
// Command Results
// ============================================

export interface CommandResult<T = unknown> {
  /** Whether command succeeded */
  success: boolean;
  
  /** Result data (if successful) */
  data?: T;
  
  /** Error info (if failed) */
  error?: CommandError;
  
  /** Warnings (even on success) */
  warnings?: CommandWarning[];
  
  /** Structured feedback for AI agents */
  feedback?: AgentFeedback;
}

export interface CommandError {
  /** Error code (e.g., "FILE_NOT_FOUND", "VALIDATION_FAILED") */
  code: string;
  
  /** Human-readable message */
  message: string;
  
  /** Additional error details */
  details?: unknown;
}

export interface CommandWarning {
  code: string;
  message: string;
  location?: Location;
}

// ============================================
// AI Agent Feedback
// ============================================

export interface AgentFeedback {
  /** What rules were violated */
  violations?: Array<{
    rule: string;
    message: string;
    location?: Location;
    matchedContent?: string;
  }>;
  
  /** How to fix violations */
  suggestions?: Array<{
    description: string;
    replacement?: string;
    import?: string;
    documentation?: string[];
  }>;
  
  /** Additional context for the agent */
  context?: {
    relevantDocs?: string[];
    examples?: string[];
  };
  
  /** Number of prior violations this session (for repeated issues) */
  priorViolationCount?: number;
}

// ============================================
// Common Types
// ============================================

export interface Position {
  line: number;    // 0-indexed
  column: number;  // 0-indexed
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Selection {
  range: Range;
  isReversed: boolean;
  getText(): string;
}

export interface Location {
  path: string;
  range: Range;
}
```

---

## Validator Plugin Interface

### src/commands/validator-interface.ts

External validators (like COR) implement this interface. Ultra calls these hooks but does not implement validation logic itself.

```typescript
// ============================================
// Validator Plugin Interface
// ============================================

/**
 * Interface for external validator plugins.
 * Ultra calls these hooks; validators decide what to enforce.
 */
export interface ValidatorPlugin {
  /** Unique identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Called when plugin is loaded */
  initialize?(ctx: ValidatorContext): Promise<void>;
  
  /** Called when plugin is unloaded */
  dispose?(): Promise<void>;
  
  /**
   * Validate a command before execution.
   * Return { proceed: false } to block.
   */
  validateCommand?(
    command: string,
    args: unknown,
    context: ValidationContext
  ): Promise<ValidationResult>;
  
  /**
   * Validate content before it's written.
   * Called for edit/create operations.
   */
  validateContent?(
    path: string,
    content: string,
    context: ValidationContext
  ): Promise<ContentValidationResult>;
  
  /**
   * Validate file operations (create, delete, rename, move).
   */
  validateFileOperation?(
    operation: 'create' | 'delete' | 'rename' | 'move',
    paths: { source?: string; target?: string },
    context: ValidationContext
  ): Promise<ValidationResult>;
  
  /**
   * Get context to provide to AI before it works on files.
   * Validators can inject guidelines, rules, recent violations, etc.
   */
  getContextForFiles?(paths: string[]): Promise<ValidatorProvidedContext>;
  
  /**
   * Record a violation for tracking/learning.
   */
  recordViolation?(violation: RecordedViolation): Promise<void>;
}

// ============================================
// Validation Types
// ============================================

export interface ValidatorContext {
  workspaceRoot: string;
  getFileContent: (path: string) => Promise<string | null>;
  listFiles: (glob: string) => Promise<string[]>;
}

export interface ValidationContext {
  source: CommandSource;
  workspaceRoot: string;
  activeFile?: string;
  selection?: Selection;
  getFileContent: (path: string) => Promise<string | null>;
  getAST?: (path: string) => Promise<unknown>;
}

export interface ValidationResult {
  /** Whether to proceed with execution */
  proceed: boolean;
  
  /** Rule violations (if blocked) */
  violations?: Violation[];
  
  /** How to fix violations */
  suggestions?: Suggestion[];
  
  /** Warnings (even if proceeding) */
  warnings?: Warning[];
  
  /** Additional context for AI feedback */
  feedbackContext?: string;
}

export interface ContentValidationResult extends ValidationResult {
  /** Line-specific violations */
  lineViolations?: Array<{
    line: number;
    column?: number;
    length?: number;
    rule: string;
    message: string;
  }>;
}

export interface Violation {
  rule: string;
  message: string;
  severity: 'error' | 'warning';
  location?: Location;
  matchedContent?: string;
}

export interface Suggestion {
  description: string;
  replacement?: string;
  import?: string;
  documentation?: string[];
}

export interface Warning {
  code: string;
  message: string;
}

export interface ValidatorProvidedContext {
  /** Guidelines/rules for AI to follow */
  guidelines?: string;
  
  /** File-specific context */
  fileContext?: Record<string, string>;
  
  /** Recent violations by this agent */
  recentViolations?: string;
}

export interface RecordedViolation {
  agentId?: string;
  sessionId?: string;
  timestamp: number;
  command: string;
  rule: string;
  message: string;
  file?: string;
  matchedContent?: string;
}
```

---

## Command Registry

### src/commands/registry.ts

```typescript
import type { Command } from './types';

export class CommandRegistry {
  private commands = new Map<string, Command>();
  
  /**
   * Register a command.
   */
  register<TArgs, TResult>(command: Command<TArgs, TResult>): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command already registered: ${command.id}`);
    }
    this.commands.set(command.id, command as Command);
  }
  
  /**
   * Register multiple commands.
   */
  registerAll(commands: Command[]): void {
    for (const command of commands) {
      this.register(command);
    }
  }
  
  /**
   * Unregister a command.
   */
  unregister(id: string): boolean {
    return this.commands.delete(id);
  }
  
  /**
   * Get a command by ID.
   */
  get(id: string): Command | undefined {
    return this.commands.get(id);
  }
  
  /**
   * Get all registered commands.
   */
  getAll(): Command[] {
    return Array.from(this.commands.values());
  }
  
  /**
   * Get commands exposed to AI agents.
   */
  getAIExposed(): Command[] {
    return this.getAll().filter(c => c.aiExposed !== false);
  }
  
  /**
   * Get commands by category.
   */
  getByCategory(category: string): Command[] {
    return this.getAll().filter(c => c.category === category);
  }
  
  /**
   * Fuzzy search commands by title/id.
   */
  search(query: string): Command[] {
    const q = query.toLowerCase();
    return this.getAll()
      .filter(c => 
        c.id.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        // Prioritize exact matches
        const aExact = a.title.toLowerCase().startsWith(q) ? 0 : 1;
        const bExact = b.title.toLowerCase().startsWith(q) ? 0 : 1;
        return aExact - bExact || a.title.localeCompare(b.title);
      });
  }
  
  /**
   * Check if a command exists.
   */
  has(id: string): boolean {
    return this.commands.has(id);
  }
}
```

---

## Validator Registry

### src/commands/validator-registry.ts

```typescript
import type {
  ValidatorPlugin,
  ValidatorContext,
  ValidationContext,
  ValidationResult,
  ContentValidationResult,
  ValidatorProvidedContext,
  RecordedViolation,
} from './validator-interface';
import type { FileSystemService } from '../services/fs';

export interface AggregatedValidationResult {
  proceed: boolean;
  violations: Violation[];
  suggestions: Suggestion[];
  warnings: Warning[];
  feedbackContext: string;
}

export class ValidatorRegistry {
  private validators = new Map<string, ValidatorPlugin>();
  private context: ValidatorContext;
  
  constructor(workspaceRoot: string, fs: FileSystemService) {
    this.context = {
      workspaceRoot,
      getFileContent: (path) => fs.readFile(path),
      listFiles: (glob) => fs.glob(glob),
    };
  }
  
  /**
   * Register a validator plugin.
   */
  async register(plugin: ValidatorPlugin): Promise<void> {
    if (plugin.initialize) {
      await plugin.initialize(this.context);
    }
    this.validators.set(plugin.id, plugin);
  }
  
  /**
   * Unregister a validator plugin.
   */
  async unregister(id: string): Promise<void> {
    const plugin = this.validators.get(id);
    if (plugin?.dispose) {
      await plugin.dispose();
    }
    this.validators.delete(id);
  }
  
  /**
   * Check if any validators are registered.
   */
  hasValidators(): boolean {
    return this.validators.size > 0;
  }
  
  /**
   * Validate a command across all validators.
   */
  async validateCommand(
    command: string,
    args: unknown,
    context: ValidationContext
  ): Promise<AggregatedValidationResult> {
    const results: ValidationResult[] = [];
    
    for (const plugin of this.validators.values()) {
      if (plugin.validateCommand) {
        try {
          const result = await plugin.validateCommand(command, args, context);
          results.push(result);
        } catch (error) {
          console.error(`Validator ${plugin.id} error:`, error);
        }
      }
    }
    
    return this.aggregateResults(results);
  }
  
  /**
   * Validate content across all validators.
   */
  async validateContent(
    path: string,
    content: string,
    context: ValidationContext
  ): Promise<AggregatedValidationResult> {
    const results: ContentValidationResult[] = [];
    
    for (const plugin of this.validators.values()) {
      if (plugin.validateContent) {
        try {
          const result = await plugin.validateContent(path, content, context);
          results.push(result);
        } catch (error) {
          console.error(`Validator ${plugin.id} error:`, error);
        }
      }
    }
    
    return this.aggregateResults(results);
  }
  
  /**
   * Validate a file operation across all validators.
   */
  async validateFileOperation(
    operation: 'create' | 'delete' | 'rename' | 'move',
    paths: { source?: string; target?: string },
    context: ValidationContext
  ): Promise<AggregatedValidationResult> {
    const results: ValidationResult[] = [];
    
    for (const plugin of this.validators.values()) {
      if (plugin.validateFileOperation) {
        try {
          const result = await plugin.validateFileOperation(operation, paths, context);
          results.push(result);
        } catch (error) {
          console.error(`Validator ${plugin.id} error:`, error);
        }
      }
    }
    
    return this.aggregateResults(results);
  }
  
  /**
   * Get context from all validators for specific files.
   */
  async getContextForFiles(paths: string[]): Promise<ValidatorProvidedContext> {
    const contexts: ValidatorProvidedContext[] = [];
    
    for (const plugin of this.validators.values()) {
      if (plugin.getContextForFiles) {
        try {
          const ctx = await plugin.getContextForFiles(paths);
          contexts.push(ctx);
        } catch (error) {
          console.error(`Validator ${plugin.id} error:`, error);
        }
      }
    }
    
    // Merge all contexts
    return {
      guidelines: contexts.map(c => c.guidelines).filter(Boolean).join('\n\n---\n\n'),
      fileContext: Object.assign({}, ...contexts.map(c => c.fileContext || {})),
      recentViolations: contexts.map(c => c.recentViolations).filter(Boolean).join('\n'),
    };
  }
  
  /**
   * Record a violation across all validators.
   */
  async recordViolation(violation: RecordedViolation): Promise<void> {
    for (const plugin of this.validators.values()) {
      if (plugin.recordViolation) {
        try {
          await plugin.recordViolation(violation);
        } catch (error) {
          console.error(`Validator ${plugin.id} error:`, error);
        }
      }
    }
  }
  
  private aggregateResults(results: ValidationResult[]): AggregatedValidationResult {
    // Block if ANY validator says don't proceed
    const proceed = results.every(r => r.proceed);
    
    return {
      proceed,
      violations: results.flatMap(r => r.violations || []),
      suggestions: results.flatMap(r => r.suggestions || []),
      warnings: results.flatMap(r => r.warnings || []),
      feedbackContext: results.map(r => r.feedbackContext).filter(Boolean).join('\n\n'),
    };
  }
}
```

---

## Command Executor

### src/commands/executor.ts

```typescript
import type {
  Command,
  CommandContext,
  CommandResult,
  CommandSource,
  AgentFeedback,
} from './types';
import type { CommandRegistry } from './registry';
import type { ValidatorRegistry, AggregatedValidationResult } from './validator-registry';
import type { ContextProvider } from './context-provider';
import type { ValidationContext, Violation } from './validator-interface';

export class CommandExecutor {
  constructor(
    private registry: CommandRegistry,
    private validators: ValidatorRegistry | null,
    private contextProvider: ContextProvider
  ) {}
  
  /**
   * Execute a command.
   */
  async execute<TArgs, TResult>(
    commandId: string,
    args: TArgs,
    source: CommandSource
  ): Promise<CommandResult<TResult>> {
    // 1. Find command
    const command = this.registry.get(commandId);
    if (!command) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_COMMAND',
          message: `Command not found: ${commandId}`,
        },
      };
    }
    
    // 2. Build context
    const ctx = await this.contextProvider.buildContext(source, this.validators);
    
    // 3. Validate (for non-human sources, if validators present)
    if (source.type !== 'human' && this.validators?.hasValidators()) {
      const validationResult = await this.runValidation(command, args, ctx);
      if (validationResult) {
        return validationResult as CommandResult<TResult>;
      }
    }
    
    // 4. Execute
    try {
      const result = await command.handler(ctx, args);
      
      // Attach any validation warnings from metadata
      const warnings = ctx.metadata.get('validationWarnings') as CommandWarning[] | undefined;
      if (warnings?.length) {
        result.warnings = [...(result.warnings || []), ...warnings];
      }
      
      return result as CommandResult<TResult>;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error,
        },
      };
    }
  }
  
  /**
   * Run validation for a command.
   * Returns a CommandResult if blocked, null if should proceed.
   */
  private async runValidation(
    command: Command,
    args: unknown,
    ctx: CommandContext
  ): Promise<CommandResult | null> {
    if (!this.validators) return null;
    
    const validationContext = this.buildValidationContext(ctx);
    
    // 1. Validate command itself
    const commandValidation = await this.validators.validateCommand(
      command.id,
      args,
      validationContext
    );
    
    if (!commandValidation.proceed) {
      await this.recordViolations(commandValidation.violations, ctx.source, command.id);
      
      return {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Command blocked by validator',
        },
        feedback: this.buildFeedback(commandValidation),
      };
    }
    
    // 2. For edit commands, validate content
    if (this.isEditCommand(command.id) && args && typeof args === 'object') {
      const editArgs = args as { path?: string; content?: string; text?: string };
      const content = editArgs.content || editArgs.text;
      const path = editArgs.path || ctx.editor?.activeBuffer?.path;
      
      if (content && path) {
        const contentValidation = await this.validators.validateContent(
          path,
          content,
          validationContext
        );
        
        if (!contentValidation.proceed) {
          await this.recordViolations(contentValidation.violations, ctx.source, command.id);
          
          return {
            success: false,
            error: {
              code: 'CONTENT_VALIDATION_FAILED',
              message: 'Content blocked by validator',
            },
            feedback: this.buildFeedback(contentValidation),
          };
        }
        
        // Store warnings for later
        if (contentValidation.warnings?.length) {
          ctx.metadata.set('validationWarnings', contentValidation.warnings);
        }
      }
    }
    
    // 3. For file operations, validate the operation
    if (this.isFileOperation(command.id) && args && typeof args === 'object') {
      const operation = this.getFileOperation(command.id);
      const paths = args as { path?: string; source?: string; target?: string; newPath?: string };
      
      const fileValidation = await this.validators.validateFileOperation(
        operation,
        {
          source: paths.path || paths.source,
          target: paths.newPath || paths.target,
        },
        validationContext
      );
      
      if (!fileValidation.proceed) {
        await this.recordViolations(fileValidation.violations, ctx.source, command.id);
        
        return {
          success: false,
          error: {
            code: 'FILE_OPERATION_VALIDATION_FAILED',
            message: 'File operation blocked by validator',
          },
          feedback: this.buildFeedback(fileValidation),
        };
      }
    }
    
    return null; // Proceed with execution
  }
  
  private buildValidationContext(ctx: CommandContext): ValidationContext {
    return {
      source: ctx.source,
      workspaceRoot: ctx.workspace.root,
      activeFile: ctx.editor?.activeBuffer?.path,
      selection: ctx.editor?.selection || undefined,
      getFileContent: (path) => ctx.services.fs.readFile(path),
    };
  }
  
  private buildFeedback(validation: AggregatedValidationResult): AgentFeedback {
    return {
      violations: validation.violations.map(v => ({
        rule: v.rule,
        message: v.message,
        location: v.location,
        matchedContent: v.matchedContent,
      })),
      suggestions: validation.suggestions.map(s => ({
        description: s.description,
        replacement: s.replacement,
        documentation: s.documentation,
      })),
      context: validation.feedbackContext
        ? { relevantDocs: [validation.feedbackContext] }
        : undefined,
    };
  }
  
  private async recordViolations(
    violations: Violation[] | undefined,
    source: CommandSource,
    command: string
  ): Promise<void> {
    if (!violations?.length || !this.validators) return;
    
    for (const v of violations) {
      await this.validators.recordViolation({
        agentId: source.agentId,
        sessionId: source.sessionId,
        timestamp: Date.now(),
        command,
        rule: v.rule,
        message: v.message,
        matchedContent: v.matchedContent,
      });
    }
  }
  
  private isEditCommand(commandId: string): boolean {
    const editCommands = [
      'ultra.edit',
      'ultra.insertText',
      'ultra.replaceText',
      'ultra.createFile',
    ];
    return editCommands.includes(commandId);
  }
  
  private isFileOperation(commandId: string): boolean {
    const fileOps = [
      'ultra.createFile',
      'ultra.deleteFile',
      'ultra.renameFile',
      'ultra.moveFile',
    ];
    return fileOps.includes(commandId);
  }
  
  private getFileOperation(commandId: string): 'create' | 'delete' | 'rename' | 'move' {
    const map: Record<string, 'create' | 'delete' | 'rename' | 'move'> = {
      'ultra.createFile': 'create',
      'ultra.deleteFile': 'delete',
      'ultra.renameFile': 'rename',
      'ultra.moveFile': 'move',
    };
    return map[commandId] || 'create';
  }
}
```

---

## Core Commands

### src/commands/core/file.ts

```typescript
import type { Command } from '../types';

export const fileCommands: Command[] = [
  {
    id: 'ultra.openFile',
    title: 'Open File',
    category: 'File',
    args: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to open' },
        line: { type: 'number', description: 'Line to go to (1-indexed)' },
        column: { type: 'number', description: 'Column to go to (1-indexed)' },
        preview: { type: 'boolean', description: 'Open in preview mode' },
      },
      required: ['path'],
    },
    returns: {
      type: 'object',
      properties: {
        bufferId: { type: 'string' },
        path: { type: 'string' },
      },
    },
    handler: async (ctx, args) => {
      // Implementation
      return { success: true, data: { bufferId: '...', path: args.path } };
    },
  },
  
  {
    id: 'ultra.save',
    title: 'Save',
    category: 'File',
    keybinding: 'ctrl+s',
    handler: async (ctx) => {
      if (!ctx.editor?.activeBuffer) {
        return { success: false, error: { code: 'NO_ACTIVE_BUFFER', message: 'No file open' } };
      }
      // Implementation
      return { success: true };
    },
  },
  
  {
    id: 'ultra.saveAll',
    title: 'Save All',
    category: 'File',
    handler: async (ctx) => {
      // Implementation
      return { success: true, data: { saved: [] } };
    },
  },
  
  {
    id: 'ultra.createFile',
    title: 'Create File',
    category: 'File',
    args: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path'],
    },
    handler: async (ctx, args) => {
      // Implementation
      return { success: true };
    },
  },
  
  {
    id: 'ultra.deleteFile',
    title: 'Delete File',
    category: 'File',
    args: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        confirm: { type: 'boolean', description: 'Skip confirmation' },
      },
      required: ['path'],
    },
    handler: async (ctx, args) => {
      // Implementation
      return { success: true };
    },
  },
  
  {
    id: 'ultra.renameFile',
    title: 'Rename File',
    category: 'File',
    args: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        newPath: { type: 'string' },
      },
      required: ['path', 'newPath'],
    },
    handler: async (ctx, args) => {
      // Implementation
      return { success: true };
    },
  },
  
  {
    id: 'ultra.closeFile',
    title: 'Close File',
    category: 'File',
    keybinding: 'ctrl+w',
    args: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Specific file to close (default: active)' },
        force: { type: 'boolean', description: 'Close without saving' },
      },
    },
    handler: async (ctx, args) => {
      // Implementation
      return { success: true };
    },
  },
];
```

### src/commands/core/edit.ts

```typescript
import type { Command } from '../types';

export const editCommands: Command[] = [
  {
    id: 'ultra.edit',
    title: 'Edit',
    category: 'Edit',
    args: {
      type: 'object',
      properties: {
        range: {
          type: 'object',
          properties: {
            start: {
              type: 'object',
              properties: { line: { type: 'number' }, column: { type: 'number' } },
            },
            end: {
              type: 'object',
              properties: { line: { type: 'number' }, column: { type: 'number' } },
            },
          },
        },
        text: { type: 'string' },
      },
      required: ['range', 'text'],
    },
    handler: async (ctx, args) => {
      // Implementation
      return { success: true };
    },
  },
  
  {
    id: 'ultra.insertText',
    title: 'Insert Text',
    category: 'Edit',
    args: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        position: {
          type: 'object',
          properties: { line: { type: 'number' }, column: { type: 'number' } },
          description: 'Position to insert at (default: cursor)',
        },
      },
      required: ['text'],
    },
    handler: async (ctx, args) => {
      // Implementation
      return { success: true };
    },
  },
  
  {
    id: 'ultra.replaceText',
    title: 'Replace Text',
    category: 'Edit',
    args: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        replace: { type: 'string' },
        all: { type: 'boolean', description: 'Replace all occurrences' },
        regex: { type: 'boolean', description: 'Treat search as regex' },
      },
      required: ['search', 'replace'],
    },
    handler: async (ctx, args) => {
      // Implementation
      return { success: true, data: { count: 0 } };
    },
  },
  
  {
    id: 'ultra.undo',
    title: 'Undo',
    category: 'Edit',
    keybinding: 'ctrl+z',
    handler: async (ctx) => {
      // Implementation
      return { success: true };
    },
  },
  
  {
    id: 'ultra.redo',
    title: 'Redo',
    category: 'Edit',
    keybinding: 'ctrl+y',
    handler: async (ctx) => {
      // Implementation
      return { success: true };
    },
  },
];
```

### src/commands/core/query.ts

These are read-only commands primarily for AI agents.

```typescript
import type { Command } from '../types';

export const queryCommands: Command[] = [
  {
    id: 'ultra.getFileContent',
    title: 'Get File Content',
    category: 'Query',
    aiExposed: true,
    args: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
    returns: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        language: { type: 'string' },
        lineCount: { type: 'number' },
      },
    },
    handler: async (ctx, args) => {
      const content = await ctx.services.fs.readFile(args.path);
      if (content === null) {
        return { success: false, error: { code: 'FILE_NOT_FOUND', message: `File not found: ${args.path}` } };
      }
      return {
        success: true,
        data: {
          content,
          language: detectLanguage(args.path),
          lineCount: content.split('\n').length,
        },
      };
    },
  },
  
  {
    id: 'ultra.getSelection',
    title: 'Get Selection',
    category: 'Query',
    aiExposed: true,
    returns: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        range: { $ref: '#/definitions/Range' },
        isEmpty: { type: 'boolean' },
      },
    },
    handler: async (ctx) => {
      const selection = ctx.editor?.selection;
      return {
        success: true,
        data: {
          text: selection?.getText() || '',
          range: selection?.range,
          isEmpty: !selection || selection.getText() === '',
        },
      };
    },
  },
  
  {
    id: 'ultra.getDiagnostics',
    title: 'Get Diagnostics',
    category: 'Query',
    aiExposed: true,
    args: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (default: active file)' },
        severity: { type: 'string', enum: ['error', 'warning', 'info', 'hint'] },
      },
    },
    handler: async (ctx, args) => {
      const path = args?.path || ctx.editor?.activeBuffer?.path;
      const diagnostics = await ctx.services.lsp.getDiagnostics(path);
      return { success: true, data: diagnostics };
    },
  },
  
  {
    id: 'ultra.getOpenFiles',
    title: 'Get Open Files',
    category: 'Query',
    aiExposed: true,
    handler: async (ctx) => {
      return { success: true, data: ctx.workspace.openFiles };
    },
  },
  
  {
    id: 'ultra.getWorkspaceInfo',
    title: 'Get Workspace Info',
    category: 'Query',
    aiExposed: true,
    handler: async (ctx) => {
      return {
        success: true,
        data: {
          root: ctx.workspace.root,
          openFileCount: ctx.workspace.openFiles.length,
          activeFile: ctx.editor?.activeBuffer?.path,
        },
      };
    },
  },
  
  {
    id: 'ultra.listCommands',
    title: 'List Commands',
    category: 'Query',
    aiExposed: true,
    args: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        aiOnly: { type: 'boolean' },
      },
    },
    handler: async (ctx, args) => {
      // This needs access to registry - would be injected or accessed differently
      return { success: true, data: [] };
    },
  },
];
```

### src/commands/core/ai.ts

AI-specific commands.

```typescript
import type { Command } from '../types';

export const aiCommands: Command[] = [
  {
    id: 'ultra.ai.getContext',
    title: 'AI: Get Context for Files',
    category: 'AI',
    aiExposed: true,
    description: 'Get relevant context (including validator guidelines) for working on files',
    args: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to get context for',
        },
      },
      required: ['paths'],
    },
    handler: async (ctx, args) => {
      // Get file contents
      const files = await Promise.all(
        args.paths.map(async (path) => ({
          path,
          content: await ctx.services.fs.readFile(path),
          language: detectLanguage(path),
        }))
      );
      
      // Get validator-provided context (COR guidelines, etc.)
      let validatorContext = null;
      if (ctx.validators?.hasValidators()) {
        validatorContext = await ctx.validators.getContextForFiles(args.paths);
      }
      
      return {
        success: true,
        data: {
          files,
          validatorContext,
        },
      };
    },
  },
  
  {
    id: 'ultra.ai.reportProgress',
    title: 'AI: Report Progress',
    category: 'AI',
    aiExposed: true,
    description: 'Report progress on a multi-step task',
    args: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        step: { type: 'number' },
        totalSteps: { type: 'number' },
      },
      required: ['message'],
    },
    handler: async (ctx, args) => {
      // Show progress in UI
      ctx.services.ui.showProgress(args);
      return { success: true };
    },
  },
];
```

---

## IPC Server

### src/commands/ipc/server.ts

```typescript
import { unlinkSync } from 'fs';
import type { CommandExecutor } from '../executor';
import type { CommandRegistry } from '../registry';
import type { CommandSource, CommandResult } from '../types';

const DEFAULT_SOCKET_PATH = '/tmp/ultra.sock';

interface IPCRequest {
  id: string;
  type: 'execute' | 'batch' | 'query' | 'subscribe';
  
  // For execute
  command?: string;
  args?: unknown;
  
  // For batch
  commands?: Array<{ command: string; args?: unknown }>;
  
  // For subscribe
  events?: string[];
  
  // Agent identification
  agentId?: string;
  sessionId?: string;
}

interface IPCResponse {
  id: string;
  success: boolean;
  result?: CommandResult | CommandResult[];
  error?: { code: string; message: string };
}

export class IPCServer {
  private server: ReturnType<typeof Bun.listen> | null = null;
  private socketPath: string;
  private subscribers = new Map<string, Set<Socket>>();
  
  constructor(
    private executor: CommandExecutor,
    private registry: CommandRegistry,
    socketPath?: string
  ) {
    this.socketPath = socketPath || process.env.ULTRA_SOCKET || DEFAULT_SOCKET_PATH;
  }
  
  start(): void {
    // Clean up stale socket
    try {
      unlinkSync(this.socketPath);
    } catch {}
    
    this.server = Bun.listen({
      unix: this.socketPath,
      socket: {
        open: (socket) => {
          // New connection
        },
        data: async (socket, data) => {
          try {
            const request: IPCRequest = JSON.parse(data.toString());
            const response = await this.handleRequest(request);
            socket.write(JSON.stringify(response) + '\n');
          } catch (error) {
            socket.write(JSON.stringify({
              id: 'unknown',
              success: false,
              error: { code: 'PARSE_ERROR', message: 'Invalid request' },
            }) + '\n');
          }
        },
        close: (socket) => {
          // Remove from all subscriptions
          for (const subs of this.subscribers.values()) {
            subs.delete(socket);
          }
        },
        error: (socket, error) => {
          console.error('IPC error:', error);
        },
      },
    });
    
    console.log(`Ultra IPC server listening on ${this.socketPath}`);
  }
  
  private async handleRequest(request: IPCRequest): Promise<IPCResponse> {
    const source: CommandSource = {
      type: 'ipc',
      agentId: request.agentId,
      sessionId: request.sessionId,
    };
    
    switch (request.type) {
      case 'execute':
        if (!request.command) {
          return {
            id: request.id,
            success: false,
            error: { code: 'MISSING_COMMAND', message: 'Command is required' },
          };
        }
        return {
          id: request.id,
          success: true,
          result: await this.executor.execute(request.command, request.args, source),
        };
      
      case 'batch':
        if (!request.commands?.length) {
          return {
            id: request.id,
            success: false,
            error: { code: 'MISSING_COMMANDS', message: 'Commands array is required' },
          };
        }
        const results: CommandResult[] = [];
        for (const cmd of request.commands) {
          results.push(await this.executor.execute(cmd.command, cmd.args, source));
        }
        return { id: request.id, success: true, result: results };
      
      case 'query':
        return {
          id: request.id,
          success: true,
          result: {
            success: true,
            data: this.registry.getAIExposed().map(c => ({
              id: c.id,
              title: c.title,
              description: c.description,
              category: c.category,
              args: c.args,
            })),
          },
        };
      
      case 'subscribe':
        // TODO: Implement event subscription
        return { id: request.id, success: true };
      
      default:
        return {
          id: request.id,
          success: false,
          error: { code: 'UNKNOWN_REQUEST', message: `Unknown request type: ${request.type}` },
        };
    }
  }
  
  /**
   * Emit an event to all subscribers.
   */
  emit(event: string, data: unknown): void {
    const subscribers = this.subscribers.get(event);
    if (!subscribers?.size) return;
    
    const message = JSON.stringify({ type: 'event', event, data }) + '\n';
    for (const socket of subscribers) {
      try {
        socket.write(message);
      } catch {
        // Remove dead socket
        subscribers.delete(socket);
      }
    }
  }
  
  stop(): void {
    this.server?.stop();
    try {
      unlinkSync(this.socketPath);
    } catch {}
  }
  
  getSocketPath(): string {
    return this.socketPath;
  }
}
```

---

## CLI Integration

### src/cli.ts (command handling portion)

```typescript
import { parseArgs } from 'util';

interface CLIOptions {
  command?: string[];
  args?: string;
  json?: boolean;
  socket?: string;
  agent?: string;
  session?: string;
  help?: boolean;
}

export async function handleCLI(): Promise<boolean> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      command: { type: 'string', short: 'c', multiple: true },
      args: { type: 'string', short: 'a' },
      json: { type: 'boolean', short: 'j' },
      socket: { type: 'string', short: 's' },
      agent: { type: 'string' },
      session: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  
  if (values.help) {
    print Help();
    return true;
  }
  
  // If commands specified, execute via IPC
  if (values.command?.length) {
    await executeCommands(values as CLIOptions);
    return true;
  }
  
  // No command mode - return false to continue with normal editor startup
  return false;
}

async function executeCommands(options: CLIOptions): Promise<void> {
  const client = new IPCClient(options.socket);
  
  try {
    await client.connect();
  } catch (error) {
    console.error('Failed to connect to Ultra. Is it running?');
    console.error('Start Ultra first, or run commands will start a new instance.');
    process.exit(1);
  }
  
  for (const cmd of options.command || []) {
    // Parse "command:arg" shorthand or use --args
    const [commandId, inlineArg] = parseCommandString(cmd);
    const args = inlineArg 
      ? parseInlineArg(inlineArg)
      : (options.args ? JSON.parse(options.args) : undefined);
    
    const result = await client.execute(commandId, args, {
      agentId: options.agent,
      sessionId: options.session,
    });
    
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      formatResult(result);
    }
    
    if (!result.success) {
      process.exit(1);
    }
  }
  
  await client.close();
}

function parseCommandString(cmd: string): [string, string | null] {
  // Handle "ultra.openFile:src/app.ts" format
  const colonIndex = cmd.indexOf(':');
  if (colonIndex === -1) {
    return [cmd, null];
  }
  
  // Make sure it's not part of the command ID (e.g., "ultra.git:status" is not valid)
  const commandId = cmd.slice(0, colonIndex);
  const arg = cmd.slice(colonIndex + 1);
  
  return [commandId, arg];
}

function parseInlineArg(arg: string): unknown {
  // Try to parse as JSON first
  try {
    return JSON.parse(arg);
  } catch {
    // If it looks like a path or simple string, wrap appropriately
    if (arg.includes('/') || arg.includes('.')) {
      return { path: arg };
    }
    // For numbers
    if (/^\d+$/.test(arg)) {
      return { line: parseInt(arg, 10) };
    }
    return { value: arg };
  }
}

function formatResult(result: CommandResult): void {
  if (result.success) {
    if (result.data !== undefined) {
      if (typeof result.data === 'object') {
        console.log(JSON.stringify(result.data, null, 2));
      } else {
        console.log(result.data);
      }
    }
    
    if (result.warnings?.length) {
      console.warn('\nWarnings:');
      for (const w of result.warnings) {
        console.warn(`  ⚠ [${w.code}] ${w.message}`);
      }
    }
  } else {
    console.error(`Error: ${result.error?.message || 'Unknown error'}`);
    
    if (result.feedback?.violations?.length) {
      console.error('\nViolations:');
      for (const v of result.feedback.violations) {
        console.error(`  ✗ [${v.rule}] ${v.message}`);
        if (v.matchedContent) {
          console.error(`    Found: ${v.matchedContent}`);
        }
      }
    }
    
    if (result.feedback?.suggestions?.length) {
      console.error('\nSuggestions:');
      for (const s of result.feedback.suggestions) {
        console.error(`  → ${s.description}`);
        if (s.replacement) {
          console.error(`    Use: ${s.replacement}`);
        }
        if (s.documentation?.length) {
          console.error(`    See: ${s.documentation.join(', ')}`);
        }
      }
    }
  }
}

function printHelp(): void {
  console.log(`
Ultra - Terminal Code Editor

Usage:
  ultra [options] [files...]

Options:
  -c, --command <cmd>    Execute command (can be used multiple times)
  -a, --args <json>      JSON arguments for command
  -j, --json             Output results as JSON
  -s, --socket <path>    Custom IPC socket path
  --agent <id>           Agent identifier (for tracking)
  --session <id>         Session identifier (for tracking)
  -h, --help             Show this help

Examples:
  # Open files
  ultra src/app.ts src/index.ts

  # Execute single command
  ultra -c "ultra.openFile" -a '{"path":"src/app.ts","line":42}'

  # Command shorthand
  ultra -c "ultra.openFile:src/app.ts"

  # Multiple commands
  ultra -c "ultra.openFile:src/app.ts" -c "ultra.goToLine" -a '{"line":42}'

  # AI agent with tracking
  ultra -c "ultra.getFileContent:src/app.ts" --agent claude --session abc123 --json

  # List available commands
  ultra -c "ultra.listCommands" --json
`);
}
```

---

## IPC Client

### src/commands/ipc/client.ts

```typescript
import { connect } from 'bun';

const DEFAULT_SOCKET_PATH = '/tmp/ultra.sock';

interface IPCRequest {
  id: string;
  type: 'execute' | 'batch' | 'query' | 'subscribe';
  command?: string;
  args?: unknown;
  commands?: Array<{ command: string; args?: unknown }>;
  events?: string[];
  agentId?: string;
  sessionId?: string;
}

interface IPCResponse {
  id: string;
  success: boolean;
  result?: any;
  error?: { code: string; message: string };
}

export class IPCClient {
  private socket: ReturnType<typeof connect> | null = null;
  private socketPath: string;
  private requestId = 0;
  private pending = new Map<string, { resolve: Function; reject: Function }>();
  private buffer = '';
  
  constructor(socketPath?: string) {
    this.socketPath = socketPath || process.env.ULTRA_SOCKET || DEFAULT_SOCKET_PATH;
  }
  
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect({
        unix: this.socketPath,
        socket: {
          open: () => resolve(),
          data: (socket, data) => {
            this.buffer += data.toString();
            this.processBuffer();
          },
          error: (socket, error) => reject(error),
          close: () => {
            // Reject all pending requests
            for (const { reject } of this.pending.values()) {
              reject(new Error('Connection closed'));
            }
            this.pending.clear();
          },
        },
      });
    });
  }
  
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response: IPCResponse = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          if (response.success) {
            pending.resolve(response.result);
          } else {
            pending.reject(response.error);
          }
        }
      } catch (error) {
        console.error('Failed to parse IPC response:', error);
      }
    }
  }
  
  private send(request: IPCRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected'));
        return;
      }
      
      this.pending.set(request.id, { resolve, reject });
      this.socket.write(JSON.stringify(request) + '\n');
    });
  }
  
  async execute(
    command: string,
    args?: unknown,
    options?: { agentId?: string; sessionId?: string }
  ): Promise<CommandResult> {
    const id = String(++this.requestId);
    return this.send({
      id,
      type: 'execute',
      command,
      args,
      agentId: options?.agentId,
      sessionId: options?.sessionId,
    });
  }
  
  async batch(
    commands: Array<{ command: string; args?: unknown }>,
    options?: { agentId?: string; sessionId?: string }
  ): Promise<CommandResult[]> {
    const id = String(++this.requestId);
    return this.send({
      id,
      type: 'batch',
      commands,
      agentId: options?.agentId,
      sessionId: options?.sessionId,
    });
  }
  
  async queryCommands(): Promise<Array<{ id: string; title: string; description?: string }>> {
    const id = String(++this.requestId);
    const result = await this.send({ id, type: 'query' });
    return result.data;
  }
  
  async close(): Promise<void> {
    this.socket?.end();
    this.socket = null;
  }
}

// ============================================
// Convenience wrapper for AI agents
// ============================================

export class UltraClient extends IPCClient {
  private agentId?: string;
  private sessionId?: string;
  
  constructor(options?: { socketPath?: string; agentId?: string; sessionId?: string }) {
    super(options?.socketPath);
    this.agentId = options?.agentId;
    this.sessionId = options?.sessionId;
  }
  
  private opts() {
    return { agentId: this.agentId, sessionId: this.sessionId };
  }
  
  // File operations
  async openFile(path: string, options?: { line?: number; column?: number }) {
    return this.execute('ultra.openFile', { path, ...options }, this.opts());
  }
  
  async save() {
    return this.execute('ultra.save', undefined, this.opts());
  }
  
  async createFile(path: string, content?: string) {
    return this.execute('ultra.createFile', { path, content }, this.opts());
  }
  
  // Editing
  async edit(range: Range, text: string) {
    return this.execute('ultra.edit', { range, text }, this.opts());
  }
  
  async insertText(text: string, position?: Position) {
    return this.execute('ultra.insertText', { text, position }, this.opts());
  }
  
  async replaceText(search: string, replace: string, options?: { all?: boolean; regex?: boolean }) {
    return this.execute('ultra.replaceText', { search, replace, ...options }, this.opts());
  }
  
  // Queries
  async getFileContent(path: string) {
    return this.execute('ultra.getFileContent', { path }, this.opts());
  }
  
  async getSelection() {
    return this.execute('ultra.getSelection', undefined, this.opts());
  }
  
  async getDiagnostics(path?: string) {
    return this.execute('ultra.getDiagnostics', { path }, this.opts());
  }
  
  async getOpenFiles() {
    return this.execute('ultra.getOpenFiles', undefined, this.opts());
  }
  
  // AI-specific
  async getContext(paths: string[]) {
    return this.execute('ultra.ai.getContext', { paths }, this.opts());
  }
  
  // Git
  async gitStatus() {
    return this.execute('ultra.git.status', undefined, this.opts());
  }
  
  async gitStage(path?: string) {
    return this.execute('ultra.git.stage', { path }, this.opts());
  }
  
  async gitCommit(message: string) {
    return this.execute('ultra.git.commit', { message }, this.opts());
  }
}
```

---

## Configuration

### ultra.config.json (example)

```json
{
  "validators": [
    {
      "id": "cor",
      "module": "@cor/ultra-plugin",
      "enabled": true
    }
  ],
  "ipc": {
    "socket": "/tmp/ultra.sock",
    "enabled": true
  },
  "commands": {
    "aliases": {
      "o": "ultra.openFile",
      "s": "ultra.save",
      "q": "ultra.quit"
    }
  }
}
```

---

## Integration Points

### Keybindings

```typescript
// In keybinding handler
async function handleKeybinding(key: string): Promise<void> {
  const binding = keybindingRegistry.get(key);
  if (!binding) return;
  
  await executor.execute(binding.command, binding.args, {
    type: 'human',
  });
}
```

### Command Palette

```typescript
// In command palette
function renderCommandPalette(): void {
  const query = inputBuffer;
  const matches = registry.search(query);
  
  // Render matches...
}

async function executeSelected(command: Command): Promise<void> {
  // Prompt for args if needed
  const args = command.args ? await promptForArgs(command.args) : undefined;
  
  await executor.execute(command.id, args, {
    type: 'human',
  });
}
```

### AI Pane Integration

```typescript
// When AI agent in terminal pane makes requests
// Route through IPC client

const client = new UltraClient({
  agentId: 'claude-code',
  sessionId: currentSessionId,
});

// AI can then use typed methods
const context = await client.getContext(['src/ui/pane.ts']);
// Work with context.validatorContext for COR guidelines

const result = await client.edit(range, newCode);
if (!result.success && result.feedback?.violations) {
  // Handle violations, retry with corrections
}
```

---

## Usage Examples

### CLI

```bash
# Basic file operations
ultra -c "ultra.openFile:src/app.ts"
ultra -c "ultra.save"

# With full args
ultra -c "ultra.openFile" -a '{"path":"src/app.ts","line":42}'

# Multiple commands
ultra -c "ultra.openFile:src/app.ts" -c "ultra.goToLine" -a '{"line":100}'

# AI agent with tracking
ultra -c "ultra.getFileContent:src/app.ts" --agent claude --session abc123 --json

# Get context before editing (includes validator guidelines)
ultra -c "ultra.ai.getContext" -a '{"paths":["src/ui/pane.ts"]}' --agent claude --json

# Query available commands
ultra -c "ultra.listCommands" --json
```

### Programmatic (TypeScript)

```typescript
import { UltraClient } from 'ultra/client';

const ultra = new UltraClient({
  agentId: 'my-agent',
  sessionId: 'session-123',
});

await ultra.connect();

// Get context first (includes COR guidelines if available)
const context = await ultra.getContext(['src/app.ts']);

if (context.data?.validatorContext?.guidelines) {
  // Use guidelines in your AI prompt
  console.log('Follow these rules:', context.data.validatorContext.guidelines);
}

// Make edits
const result = await ultra.edit(
  { start: { line: 10, column: 0 }, end: { line: 10, column: 20 } },
  'const x = logger.debug("test");'
);

if (!result.success) {
  // Handle validation failure
  console.error('Violations:', result.feedback?.violations);
  console.log('Suggestions:', result.feedback?.suggestions);
}

await ultra.close();
```

---

## Implementation Order

1. **Types** - Create `src/commands/types.ts` with all interfaces
2. **Registry** - Create `src/commands/registry.ts`
3. **Context Provider** - Create `src/commands/context-provider.ts` to build CommandContext from app state
4. **Executor (basic)** - Create `src/commands/executor.ts` without validation hooks first
5. **Core Commands** - Implement commands in `src/commands/core/`
   - Start with file.ts (openFile, save, close)
   - Then edit.ts (edit, insert, undo, redo)
   - Then query.ts (getFileContent, getSelection)
6. **IPC Server** - Create `src/commands/ipc/server.ts`
7. **IPC Client** - Create `src/commands/ipc/client.ts`
8. **CLI Integration** - Update CLI to handle -c commands
9. **Validator Interface** - Create `src/commands/validator-interface.ts`
10. **Validator Registry** - Create `src/commands/validator-registry.ts`
11. **Executor (with validation)** - Add validation hooks to executor
12. **Remaining Commands** - navigation.ts, selection.ts, view.ts, git.ts, ai.ts
13. **Event System** - Add subscription support to IPC

---

## Testing

```typescript
// Commands are easily testable

import { CommandRegistry } from './registry';
import { CommandExecutor } from './executor';
import { fileCommands } from './core/file';

describe('Command Protocol', () => {
  let registry: CommandRegistry;
  let executor: CommandExecutor;
  
  beforeEach(() => {
    registry = new CommandRegistry();
    registry.registerAll(fileCommands);
    executor = new CommandExecutor(registry, null, mockContextProvider);
  });
  
  test('ultra.openFile opens a file', async () => {
    const result = await executor.execute(
      'ultra.openFile',
      { path: 'test.ts' },
      { type: 'human' }
    );
    
    expect(result.success).toBe(true);
    expect(result.data?.path).toBe('test.ts');
  });
  
  test('unknown command returns error', async () => {
    const result = await executor.execute(
      'ultra.unknownCommand',
      {},
      { type: 'human' }
    );
    
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNKNOWN_COMMAND');
  });
  
  test('validation blocks non-human sources', async () => {
    // With a mock validator that blocks everything
    const validatorRegistry = new ValidatorRegistry(/* ... */);
    await validatorRegistry.register(mockBlockingValidator);
    
    executor = new CommandExecutor(registry, validatorRegistry, mockContextProvider);
    
    const result = await executor.execute(
      'ultra.edit',
      { range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } }, text: 'test' },
      { type: 'ai', agentId: 'test-agent' }
    );
    
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_FAILED');
    expect(result.feedback?.violations?.length).toBeGreaterThan(0);
  });
});
```

Ask any clarifying questions you need to develop your implementation plan and TODOs.