/**
 * AI Panel Component (Placeholder)
 * 
 * Chat interface for Claude AI integration.
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { FG, BG, CURSOR, STYLE } from '../../terminal/ansi.ts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export class AIPanel implements MouseHandler {
  private rect: Rect = { x: 1, y: 1, width: 40, height: 20 };
  private messages: ChatMessage[] = [];
  private inputText: string = '';
  private scrollOffset: number = 0;

  setRect(rect: Rect): void {
    this.rect = rect;
  }

  addMessage(message: ChatMessage): void {
    this.messages.push(message);
  }

  clearMessages(): void {
    this.messages = [];
  }

  setInput(text: string): void {
    this.inputText = text;
  }

  render(ctx: RenderContext): void {
    // Background
    ctx.fill(this.rect.x, this.rect.y, this.rect.width, this.rect.height, ' ', undefined, '#262626');

    // Title bar
    ctx.drawStyled(this.rect.x, this.rect.y, ' AI ASSISTANT'.padEnd(this.rect.width), '#d0d0d0', '#3a3a3a');

    // Placeholder content
    ctx.drawStyled(this.rect.x + 2, this.rect.y + 2, 'AI panel coming soon...', '#8a8a8a', '#262626');

    // Input area at bottom
    const inputDisplay = ('> ' + this.inputText).slice(0, this.rect.width);
    ctx.drawStyled(this.rect.x, this.rect.y + this.rect.height - 1, inputDisplay.padEnd(this.rect.width), '#bcbcbc', '#444444');
  }

  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    // TODO: Implement AI panel mouse events
    return false;
  }
}

export const aiPanel = new AIPanel();

export default aiPanel;
