/**
 * Command Palette Component (Placeholder)
 * 
 * Fuzzy search command palette for executing commands.
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Command } from '../../input/commands.ts';

export class CommandPalette implements MouseHandler {
  private isVisible: boolean = false;
  private query: string = '';
  private commands: Command[] = [];
  private filteredCommands: Command[] = [];
  private selectedIndex: number = 0;
  private x: number = 0;
  private y: number = 0;
  private width: number = 60;
  private height: number = 20;

  show(commands: Command[], screenWidth: number, screenHeight: number): void {
    this.isVisible = true;
    this.commands = commands;
    this.filteredCommands = commands;
    this.query = '';
    this.selectedIndex = 0;
    
    // Center the palette
    this.width = Math.min(60, screenWidth - 4);
    this.height = Math.min(20, screenHeight - 4);
    this.x = Math.floor((screenWidth - this.width) / 2) + 1;
    this.y = 2;
  }

  hide(): void {
    this.isVisible = false;
  }

  isOpen(): boolean {
    return this.isVisible;
  }

  setQuery(query: string): void {
    this.query = query;
    this.filter();
  }

  getSelectedCommand(): Command | null {
    return this.filteredCommands[this.selectedIndex] || null;
  }

  selectNext(): void {
    if (this.selectedIndex < this.filteredCommands.length - 1) {
      this.selectedIndex++;
    }
  }

  selectPrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    }
  }

  private filter(): void {
    const lowerQuery = this.query.toLowerCase();
    this.filteredCommands = this.commands.filter(cmd =>
      cmd.title.toLowerCase().includes(lowerQuery) ||
      cmd.id.toLowerCase().includes(lowerQuery)
    );
    this.selectedIndex = 0;
  }

  render(ctx: RenderContext): void {
    if (!this.isVisible) return;

    // Background
    ctx.fill(this.x, this.y, this.width, this.height, ' ', undefined, '#3a3a3a');

    // Input field
    const inputText = ('> ' + this.query).padEnd(this.width - 2);
    ctx.drawStyled(this.x + 1, this.y, inputText, '#d0d0d0', '#4e4e4e');

    // Results
    const maxResults = this.height - 2;
    for (let i = 0; i < maxResults; i++) {
      const cmd = this.filteredCommands[i];
      
      if (!cmd) {
        ctx.drawStyled(this.x + 1, this.y + 1 + i, ' '.repeat(this.width - 2), undefined, '#3a3a3a');
        continue;
      }

      const title = cmd.title.slice(0, this.width - 4);
      if (i === this.selectedIndex) {
        ctx.drawStyled(this.x + 1, this.y + 1 + i, (' ' + title).padEnd(this.width - 2), '#ffffff', '#585858');
      } else {
        ctx.drawStyled(this.x + 1, this.y + 1 + i, (' ' + title).padEnd(this.width - 2), '#bcbcbc', '#3a3a3a');
      }
    }
  }

  containsPoint(x: number, y: number): boolean {
    if (!this.isVisible) return false;
    return (
      x >= this.x &&
      x < this.x + this.width &&
      y >= this.y &&
      y < this.y + this.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    if (!this.isVisible) return false;
    
    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      // Calculate which item was clicked
      const itemY = event.y - this.y - 1;
      if (itemY >= 0 && itemY < this.filteredCommands.length) {
        this.selectedIndex = itemY;
        return true;
      }
    }
    
    return false;
  }
}

export const commandPalette = new CommandPalette();

export default commandPalette;
