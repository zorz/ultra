/**
 * Terminal Pane Component (Placeholder)
 * 
 * Embedded terminal with PTY support.
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';

export class TerminalPane implements MouseHandler {
  private rect: Rect = { x: 1, y: 1, width: 80, height: 10 };
  private isActive: boolean = false;

  setRect(rect: Rect): void {
    this.rect = rect;
  }

  setActive(active: boolean): void {
    this.isActive = active;
  }

  render(ctx: RenderContext): void {
    // Background
    ctx.fill(this.rect.x, this.rect.y, this.rect.width, this.rect.height, ' ', undefined, '#121212');

    // Border/title
    ctx.drawStyled(this.rect.x, this.rect.y, ' TERMINAL'.padEnd(this.rect.width), '#8a8a8a', '#303030');

    // Placeholder content
    ctx.drawStyled(this.rect.x + 2, this.rect.y + 2, 'Terminal coming soon...', '#8a8a8a', '#121212');
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
    // TODO: Implement terminal mouse events
    return false;
  }
}

export const terminalPane = new TerminalPane();

export default terminalPane;
