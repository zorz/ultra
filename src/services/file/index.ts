/**
 * File Service
 *
 * Abstracts file system access, enabling Ultra to work with local files,
 * SSH, FTP, cloud storage, and other backends through a unified interface.
 *
 * @example
 * ```typescript
 * import { fileService } from './services/file/index.ts';
 *
 * // Read a file
 * const content = await fileService.read('file:///path/to/file.txt');
 *
 * // Write a file
 * await fileService.write('file:///path/to/file.txt', 'Hello, World!');
 *
 * // List directory
 * const entries = await fileService.readDir('file:///path/to/dir');
 *
 * // Watch for changes
 * const handle = fileService.watch('file:///path/to/dir', (event) => {
 *   console.log('Changed:', event.uri, event.type);
 * });
 * // Later: handle.dispose();
 * ```
 */

// Types
export type {
  FileContent,
  FileStat,
  FileEntry,
  WriteOptions,
  WriteResult,
  CreateDirOptions,
  DeleteDirOptions,
  SearchOptions,
  SearchResult,
  GlobOptions,
  WatchOptions,
  WatchHandle,
  WatchCallback,
  FileChangeEvent,
  FileChangeType,
  Unsubscribe,
} from './types.ts';

// Interfaces
export type { FileProvider, FileService } from './interface.ts';

// Errors
export { FileError, FileErrorCode } from './errors.ts';

// Implementations
export { LocalFileProvider, localFileProvider } from './local.ts';
export { FileServiceImpl, fileService } from './service.ts';

// Adapter
export { FileServiceAdapter, ECPErrorCodes } from './adapter.ts';
export type { ECPRequest, ECPResponse, ECPNotification, ECPError } from './adapter.ts';

// Default export is the singleton file service
export { fileService as default } from './service.ts';
