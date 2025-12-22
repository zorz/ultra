/**
 * Panel System
 *
 * Exports for the panel content abstraction layer.
 */

// Interfaces and types
export type {
  PanelContent,
  ScrollablePanelContent,
  FocusablePanelContent,
  ContentType,
  ContentState,
  ContentTypeMetadata,
} from './panel-content.interface.ts';

export {
  EDITOR_AREA_ONLY_TYPES,
  CONTENT_TYPE_METADATA,
  canDisplayInSidebar,
  canDisplayInEditorArea,
  isScrollableContent,
  isFocusableContent,
  isSaveableContent,
  getContentTypeMetadata,
} from './panel-content.interface.ts';

// Panel container
export { PanelContainer, type ContainerDisplayMode, type ContainerState } from './panel-container.ts';

// Tab bar
export { PanelTabBar, type TabDisplayMode, type PanelTab } from './panel-tab-bar.ts';

// Content registry
export { contentRegistry } from './content-registry.ts';
export type { ContentFactory, ContentFactoryWithRestore } from './content-registry.ts';

// Editor content
export { EditorContent, type EditorContentState } from './editor-content.ts';

// AI Chat content
export {
  AIChatContent,
  createAIChatContent,
  type AIProvider,
  type AIProviderConfig,
  type AIChatContentOptions,
} from './ai-chat-content.ts';
