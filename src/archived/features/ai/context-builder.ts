/**
 * Context Builder (Placeholder)
 * 
 * Builds context for AI requests from current editor state.
 */

import type { AIContext } from './claude-client.ts';
import type { Document } from '../../core/document.ts';

export class ContextBuilder {
  private projectRoot: string = '';
  private openDocuments: Document[] = [];
  private activeDocument: Document | null = null;

  setProjectRoot(root: string): void {
    this.projectRoot = root;
  }

  setOpenDocuments(documents: Document[]): void {
    this.openDocuments = documents;
  }

  setActiveDocument(document: Document | null): void {
    this.activeDocument = document;
  }

  async buildContext(): Promise<AIContext> {
    const context: AIContext = {
      currentFile: null,
      openFiles: [],
      projectRoot: this.projectRoot,
      projectStructure: await this.getProjectStructure(),
      recentDiagnostics: []
    };

    // Current file context
    if (this.activeDocument) {
      const doc = this.activeDocument;
      const cursor = doc.primaryCursor;
      
      context.currentFile = {
        path: doc.filePath || 'untitled',
        content: doc.content,
        language: doc.language,
        cursorPosition: cursor.position
      };

      // Add selection if present
      const selectedText = doc.getSelectedText();
      if (selectedText && cursor.selection) {
        context.currentFile.selection = {
          text: selectedText,
          range: {
            start: cursor.selection.anchor,
            end: cursor.selection.head
          }
        };
      }
    }

    // Open files list
    context.openFiles = this.openDocuments.map(doc => ({
      path: doc.filePath || 'untitled',
      language: doc.language
    }));

    return context;
  }

  private async getProjectStructure(): Promise<string> {
    // TODO: Implement project structure listing
    if (!this.projectRoot) return '';
    
    try {
      // Use simple directory listing for now
      // Could use `tree` command or walk directories
      return `Project root: ${this.projectRoot}`;
    } catch {
      return '';
    }
  }
}

export const contextBuilder = new ContextBuilder();

export default contextBuilder;
