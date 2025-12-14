/**
 * Keymap System
 * 
 * Maps key combinations to commands with support for key chords.
 */

export interface KeyBinding {
  key: string;           // e.g., "cmd+s", "ctrl+shift+p"
  command: string;       // Command ID
  when?: string;         // Context condition (future use)
  args?: any;            // Arguments to pass to command
}

export interface ParsedKey {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;  // Cmd on macOS
  key: string;    // Base key
}

export class Keymap {
  private bindings: Map<string, KeyBinding> = new Map();
  private pendingChord: string | null = null;
  private chordTimeout: ReturnType<typeof setTimeout> | null = null;
  private chordTimeoutMs: number = 500;  // Half second for chord timeout

  /**
   * Load keybindings from config
   */
  loadBindings(bindings: KeyBinding[]): void {
    for (const binding of bindings) {
      const normalized = this.normalizeKey(binding.key);
      this.bindings.set(normalized, binding);
    }
  }

  /**
   * Add a single binding
   */
  addBinding(binding: KeyBinding): void {
    const normalized = this.normalizeKey(binding.key);
    this.bindings.set(normalized, binding);
  }

  /**
   * Remove a binding
   */
  removeBinding(key: string): void {
    const normalized = this.normalizeKey(key);
    this.bindings.delete(normalized);
  }

  /**
   * Get command for a key event
   */
  getCommand(key: ParsedKey): string | null {
    const keyStr = this.keyToString(key);
    
    // Check for chord continuation
    if (this.pendingChord) {
      const chordKey = `${this.pendingChord} ${keyStr}`;
      this.clearChord();
      
      const binding = this.bindings.get(chordKey);
      if (binding) {
        return binding.command;
      }
      // Chord didn't match - fall through to check if this key has its own binding
    }

    // Check for chord start
    const chordPrefix = keyStr + ' ';
    const hasChord = Array.from(this.bindings.keys()).some(k => k.startsWith(chordPrefix));
    
    // Check for direct binding
    const directBinding = this.bindings.get(keyStr);
    
    if (hasChord) {
      // Start chord window, but execute direct binding immediately if it exists
      this.pendingChord = keyStr;
      this.chordTimeout = setTimeout(() => this.clearChord(), this.chordTimeoutMs);
      // Return direct binding - it executes now, but chord window stays open
      return directBinding?.command || null;
    }

    return directBinding?.command || null;
  }

  /**
   * Check if currently waiting for chord
   */
  isChordPending(): boolean {
    return this.pendingChord !== null;
  }

  /**
   * Clear pending chord
   */
  clearChord(): void {
    this.pendingChord = null;
    if (this.chordTimeout) {
      clearTimeout(this.chordTimeout);
      this.chordTimeout = null;
    }
  }

  /**
   * Get all bindings
   */
  getAllBindings(): KeyBinding[] {
    return Array.from(this.bindings.values());
  }

  /**
   * Get binding for command
   */
  getBindingForCommand(commandId: string): KeyBinding | undefined {
    for (const binding of this.bindings.values()) {
      if (binding.command === commandId) {
        return binding;
      }
    }
    return undefined;
  }

  /**
   * Parse a terminal-kit key event into ParsedKey
   */
  parseTerminalKey(keyName: string, data?: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean }): ParsedKey {
    // Handle special key names from terminal-kit
    const specialKeys: Record<string, string> = {
      'ENTER': 'enter',
      'ESCAPE': 'escape',
      'BACKSPACE': 'backspace',
      'DELETE': 'delete',
      'TAB': 'tab',
      'UP': 'up',
      'DOWN': 'down',
      'LEFT': 'left',
      'RIGHT': 'right',
      'HOME': 'home',
      'END': 'end',
      'PAGE_UP': 'pageup',
      'PAGE_DOWN': 'pagedown',
      'INSERT': 'insert',
      'F1': 'f1',
      'F2': 'f2',
      'F3': 'f3',
      'F4': 'f4',
      'F5': 'f5',
      'F6': 'f6',
      'F7': 'f7',
      'F8': 'f8',
      'F9': 'f9',
      'F10': 'f10',
      'F11': 'f11',
      'F12': 'f12'
    };

    // macOS Option+key produces Unicode characters instead of alt modifier
    // Map these back to alt+key combinations
    const macOSOptionChars: Record<string, { alt: boolean; key: string }> = {
      '∫': { alt: true, key: 'b' },      // Option+B
      'ƒ': { alt: true, key: 'f' },      // Option+F
      '©': { alt: true, key: 'g' },      // Option+G  
      '∂': { alt: true, key: 'd' },      // Option+D
      '®': { alt: true, key: 'r' },      // Option+R
      '†': { alt: true, key: 't' },      // Option+T
      '¥': { alt: true, key: 'y' },      // Option+Y
      'ˆ': { alt: true, key: 'i' },      // Option+I
      'ø': { alt: true, key: 'o' },      // Option+O
      'π': { alt: true, key: 'p' },      // Option+P
      'å': { alt: true, key: 'a' },      // Option+A
      'ß': { alt: true, key: 's' },      // Option+S
      '˙': { alt: true, key: 'h' },      // Option+H
      '∆': { alt: true, key: 'j' },      // Option+J
      '˚': { alt: true, key: 'k' },      // Option+K
      '¬': { alt: true, key: 'l' },      // Option+L
      'Ω': { alt: true, key: 'z' },      // Option+Z
      '≈': { alt: true, key: 'x' },      // Option+X
      'ç': { alt: true, key: 'c' },      // Option+C
      '√': { alt: true, key: 'v' },      // Option+V
      '˜': { alt: true, key: 'n' },      // Option+N
      'µ': { alt: true, key: 'm' },      // Option+M
      '¡': { alt: true, key: '1' },      // Option+1
      '™': { alt: true, key: '2' },      // Option+2
      '£': { alt: true, key: '3' },      // Option+3
      '¢': { alt: true, key: '4' },      // Option+4
      '∞': { alt: true, key: '5' },      // Option+5
      '§': { alt: true, key: '6' },      // Option+6
      '¶': { alt: true, key: '7' },      // Option+7
      '•': { alt: true, key: '8' },      // Option+8
      'ª': { alt: true, key: '9' },      // Option+9
      'º': { alt: true, key: '0' },      // Option+0
    };

    // Check for macOS Option+key character first
    if (macOSOptionChars[keyName]) {
      const mapped = macOSOptionChars[keyName];
      return {
        ctrl: false,
        shift: data?.shift || false,
        alt: true,
        meta: false,
        key: mapped.key
      };
    }

    let ctrl = data?.ctrl || false;
    let shift = data?.shift || false;
    let alt = data?.alt || false;
    let meta = data?.meta || false;
    let key = keyName;
    let originalKeyName = keyName;

    // Parse CTRL_, SHIFT_, ALT_ prefixes from terminal-kit
    // Note: On macOS, Cmd key often comes through as CTRL_ in terminal
    while (true) {
      if (keyName.startsWith('CTRL_')) {
        ctrl = true;
        keyName = keyName.slice(5);
      } else if (keyName.startsWith('SHIFT_')) {
        shift = true;
        keyName = keyName.slice(6);
      } else if (keyName.startsWith('ALT_')) {
        alt = true;
        keyName = keyName.slice(4);
      } else {
        break;
      }
    }

    // Normalize key name
    if (specialKeys[keyName]) {
      key = specialKeys[keyName]!;
    } else if (keyName.length === 1) {
      key = keyName.toLowerCase();
    } else {
      key = keyName.toLowerCase();
    }

    // On macOS terminal, Cmd+key often comes as ctrl char (e.g., \x01 for Cmd+A)
    // These are control characters with codes 1-26 mapping to a-z
    if (originalKeyName.length === 1) {
      const code = originalKeyName.charCodeAt(0);
      if (code >= 1 && code <= 26) {
        ctrl = true;
        key = String.fromCharCode(code + 96);  // Convert to a-z
      }
    }
    
    // Handle macOS Option+Arrow which may come as escape sequences
    // ESC+b = word left, ESC+f = word right (emacs style)
    // Or may come as special terminal-kit keys
    if (originalKeyName === 'b' && !ctrl && !shift) {
      // Check if this might be ESC+b (word left) - usually alt is set
      if (alt || data?.alt) {
        alt = true;
        key = 'left';
      }
    } else if (originalKeyName === 'f' && !ctrl && !shift) {
      // Check if this might be ESC+f (word right)
      if (alt || data?.alt) {
        alt = true;
        key = 'right';
      }
    }

    return { ctrl, shift, alt, meta, key };
  }

  /**
   * Convert ParsedKey to string representation
   */
  keyToString(key: ParsedKey): string {
    const parts: string[] = [];
    
    if (key.ctrl) parts.push('ctrl');
    if (key.alt) parts.push('alt');
    if (key.shift) parts.push('shift');
    if (key.meta) parts.push('cmd');
    parts.push(key.key);
    
    return parts.join('+');
  }

  /**
   * Normalize a key string (e.g., "Cmd+S" -> "cmd+s")
   */
  private normalizeKey(key: string): string {
    return key
      .toLowerCase()
      .replace(/\s+/g, ' ')  // Normalize spaces for chords
      .replace('command', 'cmd')
      .replace('control', 'ctrl')
      .replace('option', 'alt');
  }

  /**
   * Format key binding for display
   */
  formatForDisplay(key: string): string {
    return key
      .split('+')
      .map(part => {
        switch (part.toLowerCase()) {
          case 'cmd': return '⌘';
          case 'ctrl': return '⌃';
          case 'alt': return '⌥';
          case 'shift': return '⇧';
          case 'enter': return '↵';
          case 'backspace': return '⌫';
          case 'delete': return '⌦';
          case 'escape': return 'Esc';
          case 'tab': return '⇥';
          case 'up': return '↑';
          case 'down': return '↓';
          case 'left': return '←';
          case 'right': return '→';
          default: return part.toUpperCase();
        }
      })
      .join('');
  }
}

export const keymap = new Keymap();

export default keymap;
