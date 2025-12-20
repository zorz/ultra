# File Service

The File Service abstracts file system access, enabling Ultra to work with local files, SSH, FTP, cloud storage, and other backends.

## Current State

### Location
File operations are currently **scattered across multiple locations**:

- `src/core/document.ts` - `Document.fromFile()`, `save()`, `saveAs()`, `reload()`
- `src/ui/components/file-tree.ts` - Directory listing, file watching, create/rename/delete
- `src/ui/components/file-picker.ts` - File search and indexing
- `src/config/user-config.ts` - Config file I/O
- `src/state/session-manager.ts` - Session file I/O

### Current Implementation

#### Document File I/O (`document.ts`)

```typescript
class Document {
  // Read
  static async fromFile(filePath: string): Promise<Document> {
    const file = Bun.file(filePath);
    const content = await file.text();
    return new Document(content, filePath);
  }

  // Write
  async save(): Promise<boolean> {
    if (!this.filePath) return false;
    const content = this.lineEnding === '\r\n'
      ? this.content.replace(/\n/g, '\r\n')
      : this.content;
    await Bun.write(this.filePath, content);
    this.isDirty = false;
    return true;
  }

  // Metadata
  async getFileModTime(): Promise<number> {
    const file = Bun.file(this.filePath!);
    return file.lastModified;
  }
}
```

#### File Tree Operations (`file-tree.ts`)

```typescript
// Directory listing
async loadDirectory(dirPath: string): Promise<FileEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries.map(entry => ({
    name: entry.name,
    path: path.join(dirPath, entry.name),
    isDirectory: entry.isDirectory(),
    // ... git status, etc.
  }));
}

// File watching
const watcher = watch(dirPath, { recursive: true }, (event, filename) => {
  // Refresh tree on change
});

// File operations
await mkdir(newPath, { recursive: true });
await rename(oldPath, newPath);
await unlink(filePath);
await rm(dirPath, { recursive: true });
```

#### File Search (`file-picker.ts`)

```typescript
// Uses fileSearch singleton from separate module
const results = await fileSearch.search(query, {
  maxResults: 100,
  excludePatterns: settings.get('files.exclude')
});
```

### Current Issues

| Issue | Location | Description |
|-------|----------|-------------|
| Scattered implementation | Multiple files | File I/O spread across codebase |
| No abstraction | Document.ts | Hardcoded `Bun.file()` usage |
| Silent failures | file-tree.ts | 5 TODOs for missing error dialogs |
| No unified watching | Various | Each component manages own watchers |
| Platform-specific | paths | Uses Node.js path module directly |
| No access control | All | No permission checking |
| Blocking operations | Some | Mix of sync and async |

### File Type Detection

Currently uses extension mapping in `document.ts`:
```typescript
private detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    // ... 30+ extensions
  };
  return map[ext] || 'plaintext';
}
```

---

## Target State

### ECP Interface

```typescript
// File content operations
"file/read": { uri: string } => { content: string, encoding: string, modTime: number }
"file/write": { uri: string, content: string, encoding?: string } => { success: boolean, modTime: number }
"file/stat": { uri: string } => { exists: boolean, isDirectory: boolean, size: number, modTime: number }
"file/delete": { uri: string } => { success: boolean }
"file/rename": { oldUri: string, newUri: string } => { success: boolean }
"file/copy": { sourceUri: string, targetUri: string } => { success: boolean }

// Directory operations
"file/readDir": { uri: string } => { entries: FileEntry[] }
"file/createDir": { uri: string, recursive?: boolean } => { success: boolean }
"file/deleteDir": { uri: string, recursive?: boolean } => { success: boolean }

// File search
"file/search": { pattern: string, options?: SearchOptions } => { results: SearchResult[] }
"file/glob": { pattern: string, options?: GlobOptions } => { uris: string[] }

// File watching
"file/watch": { uri: string, recursive?: boolean } => { watchId: string }
"file/unwatch": { watchId: string } => { success: boolean }

// Notifications (server → client)
"file/didChange": { uri: string, changeType: 'created' | 'changed' | 'deleted' }
"file/didCreate": { uri: string }
"file/didDelete": { uri: string }
"file/didRename": { oldUri: string, newUri: string }
```

### Service Architecture

```typescript
// services/file/interface.ts
interface FileService {
  // Content operations
  read(uri: string): Promise<FileContent>
  write(uri: string, content: string, options?: WriteOptions): Promise<WriteResult>

  // Metadata
  stat(uri: string): Promise<FileStat>
  exists(uri: string): Promise<boolean>

  // File operations
  delete(uri: string): Promise<void>
  rename(oldUri: string, newUri: string): Promise<void>
  copy(sourceUri: string, targetUri: string): Promise<void>

  // Directory operations
  readDir(uri: string): Promise<FileEntry[]>
  createDir(uri: string, options?: CreateDirOptions): Promise<void>
  deleteDir(uri: string, options?: DeleteDirOptions): Promise<void>

  // Search
  search(pattern: string, options?: SearchOptions): Promise<SearchResult[]>
  glob(pattern: string, options?: GlobOptions): Promise<string[]>

  // Watching
  watch(uri: string, callback: WatchCallback, options?: WatchOptions): WatchHandle

  // Events
  onFileChange(callback: FileChangeCallback): Unsubscribe
}

interface FileContent {
  content: string;
  encoding: string;
  modTime: number;
  size: number;
}

interface FileStat {
  uri: string;
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modTime: number;
  createTime: number;
}

interface FileEntry {
  name: string;
  uri: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  modTime?: number;
}
```

### Provider Pattern

```typescript
// services/file/provider.ts
interface FileProvider {
  readonly scheme: string;  // 'file', 'ssh', 'ftp', 's3', etc.

  // All FileService methods...
  read(uri: string): Promise<FileContent>
  write(uri: string, content: string, options?: WriteOptions): Promise<WriteResult>
  // ...etc
}

// services/file/local.ts
class LocalFileProvider implements FileProvider {
  readonly scheme = 'file';

  async read(uri: string): Promise<FileContent> {
    const path = this.uriToPath(uri);
    const file = Bun.file(path);
    return {
      content: await file.text(),
      encoding: 'utf-8',
      modTime: file.lastModified,
      size: file.size
    };
  }
  // ...
}

// services/file/ssh.ts (future)
class SSHFileProvider implements FileProvider {
  readonly scheme = 'ssh';
  // ...
}

// services/file/service.ts
class FileServiceImpl implements FileService {
  private providers = new Map<string, FileProvider>();

  registerProvider(provider: FileProvider): void {
    this.providers.set(provider.scheme, provider);
  }

  private getProvider(uri: string): FileProvider {
    const scheme = new URL(uri).protocol.slice(0, -1);
    const provider = this.providers.get(scheme);
    if (!provider) throw new Error(`No provider for scheme: ${scheme}`);
    return provider;
  }

  async read(uri: string): Promise<FileContent> {
    return this.getProvider(uri).read(uri);
  }
  // ...delegate all methods to appropriate provider
}
```

### URI Scheme

All file references use URIs:
- Local: `file:///home/user/project/src/app.ts`
- SSH: `ssh://user@host/path/to/file.ts`
- FTP: `ftp://host/path/to/file.ts`
- S3: `s3://bucket/path/to/file.ts`

### Watch Manager

Centralized file watching with deduplication:

```typescript
class WatchManager {
  private watchers = new Map<string, { watcher: FSWatcher, refCount: number }>();

  watch(uri: string, callback: WatchCallback): WatchHandle {
    const key = this.normalizeUri(uri);
    let entry = this.watchers.get(key);

    if (!entry) {
      entry = {
        watcher: this.createWatcher(uri),
        refCount: 0
      };
      this.watchers.set(key, entry);
    }

    entry.refCount++;
    entry.watcher.on('change', callback);

    return {
      dispose: () => {
        entry!.refCount--;
        if (entry!.refCount === 0) {
          entry!.watcher.close();
          this.watchers.delete(key);
        }
      }
    };
  }
}
```

---

## Migration Steps

### Phase 1: Create FileService Interface

1. **Define interface** (`services/file/interface.ts`)
   - All file operations
   - Provider abstraction
   - Event types

2. **Create LocalFileProvider**
   - Wrap existing Bun.file() usage
   - Add proper error handling
   - Implement all interface methods

3. **Create WatchManager**
   - Centralized file watching
   - Reference counting
   - Debouncing

### Phase 2: Migrate Existing Code

1. **Extract file I/O from Document**
   - Document.fromFile() → FileService.read()
   - Document.save() → FileService.write()
   - Keep Document focused on text editing

2. **Update FileTree**
   - Use FileService for all operations
   - Use WatchManager for watching
   - Add proper error handling

3. **Update FilePicker**
   - Use FileService.search()
   - Use FileService.glob()

4. **Update Config/Session**
   - Use FileService for config I/O
   - Use FileService for session I/O

### Phase 3: Add ECP Adapter

1. **Create FileServiceAdapter**
   - Map JSON-RPC methods to FileService
   - Handle streaming for large files
   - Rate limit watch notifications

### Migration Checklist

```markdown
- [ ] Create services/file/ directory
- [ ] Define FileService interface
- [ ] Define FileProvider interface
- [ ] Create LocalFileProvider implementation
- [ ] Create WatchManager
- [ ] Create FileServiceImpl with provider registry
- [ ] Migrate Document.fromFile() to FileService
- [ ] Migrate Document.save() to FileService
- [ ] Migrate FileTree operations to FileService
- [ ] Add error handling with user feedback
- [ ] Create FileServiceAdapter for ECP
- [ ] Add tests for all operations
- [ ] Update CLAUDE.md with new patterns
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/core/document.ts` | Remove file I/O, accept content in constructor |
| `src/ui/components/file-tree.ts` | Use FileService, proper error handling |
| `src/ui/components/file-picker.ts` | Use FileService.search() |
| `src/config/user-config.ts` | Use FileService for config I/O |
| `src/state/session-manager.ts` | Use FileService for session I/O |

### New Files to Create

```
src/services/file/
├── interface.ts      # FileService, FileProvider interfaces
├── types.ts          # FileStat, FileEntry, etc.
├── local.ts          # LocalFileProvider
├── watch-manager.ts  # Centralized watching
├── service.ts        # FileServiceImpl
├── adapter.ts        # ECP adapter
└── index.ts          # Public exports
```

### Error Handling

```typescript
// services/file/errors.ts
class FileError extends Error {
  constructor(
    public readonly code: FileErrorCode,
    public readonly uri: string,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
  }
}

enum FileErrorCode {
  NOT_FOUND = 'FILE_NOT_FOUND',
  ACCESS_DENIED = 'ACCESS_DENIED',
  IS_DIRECTORY = 'IS_DIRECTORY',
  NOT_DIRECTORY = 'NOT_DIRECTORY',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  UNKNOWN = 'UNKNOWN'
}

// Usage in provider
async read(uri: string): Promise<FileContent> {
  try {
    const path = this.uriToPath(uri);
    const file = Bun.file(path);

    if (!await file.exists()) {
      throw new FileError(FileErrorCode.NOT_FOUND, uri, `File not found: ${uri}`);
    }

    return {
      content: await file.text(),
      // ...
    };
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw new FileError(FileErrorCode.UNKNOWN, uri, `Failed to read: ${uri}`, error);
  }
}
```
