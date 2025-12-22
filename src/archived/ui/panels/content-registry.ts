/**
 * Content Registry
 *
 * Central registry for panel content types.
 * Manages content factories, tracks active content instances, and handles
 * content lifecycle.
 */

import type {
  PanelContent,
  ContentType,
  ContentState,
  ContentTypeMetadata,
} from './panel-content.interface.ts';
import { CONTENT_TYPE_METADATA, getContentTypeMetadata } from './panel-content.interface.ts';
import { debugLog, isDebugEnabled } from '../../debug.ts';

// ==================== Content Factory ====================

/**
 * Factory function for creating content instances.
 */
export type ContentFactory<T extends PanelContent = PanelContent> = (
  contentId: string,
  options?: Record<string, unknown>
) => T;

/**
 * Factory with restore capability.
 */
export interface ContentFactoryWithRestore<T extends PanelContent = PanelContent> {
  /** Create a new content instance */
  create: ContentFactory<T>;
  /** Restore content from serialized state */
  restore?: (state: ContentState) => T | null;
}

// ==================== Content Registry ====================

/**
 * Central registry for panel content.
 *
 * Responsibilities:
 * - Register content factories for each content type
 * - Create content instances via factories
 * - Track all active content instances
 * - Restore content from session state
 *
 * @example
 * // Register a factory
 * contentRegistry.registerFactory('ai-chat', {
 *   create: (id) => new AIChatContent(id),
 *   restore: (state) => AIChatContent.fromState(state),
 * });
 *
 * // Create content
 * const chat = contentRegistry.createContent('ai-chat', 'chat-1');
 *
 * // Get existing content
 * const existing = contentRegistry.getContent('chat-1');
 */
class ContentRegistry {
  private factories: Map<ContentType, ContentFactoryWithRestore> = new Map();
  private instances: Map<string, PanelContent> = new Map();
  private contentIdCounter: number = 0;

  /**
   * Register a content factory for a content type.
   *
   * @param type - Content type to register
   * @param factory - Factory or factory with restore capability
   */
  registerFactory<T extends PanelContent>(
    type: ContentType,
    factory: ContentFactory<T> | ContentFactoryWithRestore<T>
  ): void {
    const factoryWithRestore: ContentFactoryWithRestore<T> =
      typeof factory === 'function' ? { create: factory } : factory;

    this.factories.set(type, factoryWithRestore as ContentFactoryWithRestore);
    this.debugLog(`Registered factory for content type: ${type}`);
  }

  /**
   * Unregister a content factory.
   *
   * @param type - Content type to unregister
   */
  unregisterFactory(type: ContentType): void {
    this.factories.delete(type);
    this.debugLog(`Unregistered factory for content type: ${type}`);
  }

  /**
   * Check if a factory is registered for a content type.
   */
  hasFactory(type: ContentType): boolean {
    return this.factories.has(type);
  }

  /**
   * Generate a unique content ID.
   */
  generateContentId(type: ContentType): string {
    return `${type}-${++this.contentIdCounter}`;
  }

  /**
   * Create a new content instance.
   *
   * @param type - Type of content to create
   * @param contentId - Optional specific ID (generated if not provided)
   * @param options - Content-specific options
   * @returns New content instance or null if factory not registered
   */
  createContent<T extends PanelContent>(
    type: ContentType,
    contentId?: string,
    options?: Record<string, unknown>
  ): T | null {
    const factory = this.factories.get(type);
    if (!factory) {
      this.debugLog(`No factory registered for content type: ${type}`);
      return null;
    }

    const id = contentId || this.generateContentId(type);

    // Check if content with this ID already exists
    if (this.instances.has(id)) {
      this.debugLog(`Content with ID already exists: ${id}`);
      return this.instances.get(id) as T;
    }

    const content = factory.create(id, options) as T;
    this.instances.set(id, content);
    this.debugLog(`Created content: ${id} (type: ${type})`);

    return content;
  }

  /**
   * Restore content from serialized state.
   *
   * @param state - Serialized content state
   * @returns Restored content instance or null if restore failed
   */
  restoreContent<T extends PanelContent>(state: ContentState): T | null {
    const factory = this.factories.get(state.contentType);
    if (!factory) {
      this.debugLog(`No factory for content type: ${state.contentType}`);
      return null;
    }

    // Check if content with this ID already exists
    if (this.instances.has(state.contentId)) {
      const existing = this.instances.get(state.contentId) as T;
      // Restore state to existing instance
      if (existing.restore) {
        existing.restore(state);
      }
      return existing;
    }

    // Try to use factory's restore method
    if (factory.restore) {
      const content = factory.restore(state) as T | null;
      if (content) {
        this.instances.set(state.contentId, content);
        this.debugLog(`Restored content: ${state.contentId}`);
        return content;
      }
    }

    // Fall back to create + restore
    const content = factory.create(state.contentId) as T;
    if (content.restore) {
      content.restore(state);
    }
    this.instances.set(state.contentId, content);
    this.debugLog(`Created and restored content: ${state.contentId}`);

    return content;
  }

  /**
   * Get an existing content instance by ID.
   *
   * @param contentId - Content ID to look up
   * @returns Content instance or undefined if not found
   */
  getContent<T extends PanelContent>(contentId: string): T | undefined {
    return this.instances.get(contentId) as T | undefined;
  }

  /**
   * Get all content instances of a specific type.
   *
   * @param type - Content type to filter by
   * @returns Array of content instances
   */
  getContentByType<T extends PanelContent>(type: ContentType): T[] {
    const results: T[] = [];
    for (const content of this.instances.values()) {
      if (content.contentType === type) {
        results.push(content as T);
      }
    }
    return results;
  }

  /**
   * Get all content instances.
   *
   * @returns Array of all content instances
   */
  getAllContent(): PanelContent[] {
    return Array.from(this.instances.values());
  }

  /**
   * Register a content instance (for externally created content).
   *
   * @param content - Content instance to register
   */
  registerContent(content: PanelContent): void {
    if (this.instances.has(content.contentId)) {
      this.debugLog(`Content already registered: ${content.contentId}`);
      return;
    }
    this.instances.set(content.contentId, content);
    this.debugLog(`Registered external content: ${content.contentId}`);
  }

  /**
   * Unregister and dispose a content instance.
   *
   * @param contentId - Content ID to remove
   * @returns true if content was removed, false if not found
   */
  disposeContent(contentId: string): boolean {
    const content = this.instances.get(contentId);
    if (!content) {
      return false;
    }

    if (content.dispose) {
      content.dispose();
    }
    this.instances.delete(contentId);
    this.debugLog(`Disposed content: ${contentId}`);
    return true;
  }

  /**
   * Dispose all content instances.
   */
  disposeAll(): void {
    for (const content of this.instances.values()) {
      if (content.dispose) {
        content.dispose();
      }
    }
    this.instances.clear();
    this.debugLog('Disposed all content');
  }

  /**
   * Serialize all content for session state.
   *
   * @returns Array of serialized content states
   */
  serializeAll(): ContentState[] {
    const states: ContentState[] = [];
    for (const content of this.instances.values()) {
      if (content.serialize) {
        states.push(content.serialize());
      }
    }
    return states;
  }

  /**
   * Get metadata for a content type.
   */
  getMetadata(type: ContentType): ContentTypeMetadata {
    return getContentTypeMetadata(type);
  }

  /**
   * Get all registered content types.
   */
  getRegisteredTypes(): ContentType[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Check if a content type can be displayed in a specific region.
   */
  canDisplayInRegion(
    type: ContentType,
    region: 'sidebar-left' | 'sidebar-right' | 'panel-bottom' | 'editor-area'
  ): boolean {
    const metadata = this.getMetadata(type);
    switch (region) {
      case 'sidebar-left':
      case 'sidebar-right':
        return metadata.allowInSidebar;
      case 'panel-bottom':
        return metadata.allowInBottomPanel;
      case 'editor-area':
        return metadata.allowInEditorArea;
      default:
        return false;
    }
  }

  /**
   * Get default region for a content type.
   */
  getDefaultRegion(type: ContentType): 'sidebar-left' | 'sidebar-right' | 'panel-bottom' | 'editor-area' {
    return this.getMetadata(type).defaultRegion;
  }

  /**
   * Debug log helper.
   */
  private debugLog(message: string): void {
    if (isDebugEnabled()) {
      debugLog(`[ContentRegistry] ${message}`);
    }
  }
}

// Singleton export
export const contentRegistry = new ContentRegistry();
export default contentRegistry;
