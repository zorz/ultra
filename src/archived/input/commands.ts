/**
 * Command Registry
 * 
 * Defines and manages all editor commands.
 */

export interface Command {
  id: string;
  title: string;
  category?: string;
  handler: () => void | Promise<void>;
}

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private listeners: Set<() => void> = new Set();

  /**
   * Register a command
   */
  register(command: Command): void {
    this.commands.set(command.id, command);
    this.notifyListeners();
  }

  /**
   * Register multiple commands
   */
  registerAll(commands: Command[]): void {
    for (const command of commands) {
      this.commands.set(command.id, command);
    }
    this.notifyListeners();
  }

  /**
   * Get a command by ID
   */
  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /**
   * Execute a command by ID
   */
  async execute(id: string): Promise<boolean> {
    const command = this.commands.get(id);
    if (!command) {
      return false;
    }

    try {
      await command.handler();
      return true;
    } catch (error) {
      console.error(`Error executing command ${id}:`, error);
      return false;
    }
  }

  /**
   * Get all commands
   */
  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get commands by category
   */
  getByCategory(category: string): Command[] {
    return this.getAll().filter(cmd => cmd.category === category);
  }

  /**
   * Search commands by title
   */
  search(query: string): Command[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(cmd => 
      cmd.title.toLowerCase().includes(lowerQuery) ||
      cmd.id.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Listen for registry changes
   */
  onChanged(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const commandRegistry = new CommandRegistry();

export default commandRegistry;
