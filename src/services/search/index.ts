/**
 * Search Service Module
 *
 * Exports search service interface and implementations.
 */

// Types
export type {
  SearchOptions,
  SearchMatchResult,
  SearchFileResult,
  SearchResult,
  ReplaceResult,
  SearchProgress,
  SearchProgressCallback,
  Unsubscribe,
} from './types.ts';

// Interface
export type { SearchService } from './interface.ts';

// Implementation
export { LocalSearchService, localSearchService } from './local.ts';
