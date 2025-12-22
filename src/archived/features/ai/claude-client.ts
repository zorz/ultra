/**
 * Claude AI Client (Placeholder)
 * 
 * Anthropic Claude API integration for AI assistance.
 */

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIContext {
  currentFile: {
    path: string;
    content: string;
    language: string;
    cursorPosition: { line: number; column: number };
    selection?: { text: string; range: { start: { line: number; column: number }; end: { line: number; column: number } } };
  } | null;
  openFiles: Array<{ path: string; language: string }>;
  projectRoot: string;
  projectStructure: string;
  recentDiagnostics: Array<{ message: string; severity: string; file: string; line: number }>;
}

export interface AIStreamChunk {
  type: 'text' | 'done' | 'error';
  content?: string;
  error?: string;
}

export class ClaudeClient {
  private apiKey: string = '';
  private model: string = 'claude-sonnet-4-20250514';
  private abortController: AbortController | null = null;

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  setModel(model: string): void {
    this.model = model;
  }

  async *chat(messages: AIMessage[], context: AIContext): AsyncIterable<AIStreamChunk> {
    // TODO: Implement streaming chat with Claude API
    yield { type: 'text', content: 'AI integration coming soon...' };
    yield { type: 'done' };
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private buildSystemPrompt(context: AIContext): string {
    let prompt = `You are an AI coding assistant integrated into a terminal code editor called Ultra. 
You help users write, understand, and improve their code.

Current context:`;

    if (context.currentFile) {
      prompt += `\n\nCurrent file: ${context.currentFile.path} (${context.currentFile.language})`;
      if (context.currentFile.selection) {
        prompt += `\nSelected text:\n\`\`\`\n${context.currentFile.selection.text}\n\`\`\``;
      }
    }

    if (context.projectStructure) {
      prompt += `\n\nProject structure:\n${context.projectStructure}`;
    }

    if (context.recentDiagnostics.length > 0) {
      prompt += '\n\nRecent errors/warnings:';
      for (const diag of context.recentDiagnostics.slice(0, 5)) {
        prompt += `\n- ${diag.severity}: ${diag.message} (${diag.file}:${diag.line})`;
      }
    }

    return prompt;
  }
}

export const claudeClient = new ClaudeClient();

export default claudeClient;
