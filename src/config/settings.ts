/**
 * Settings Manager
 * 
 * Manages editor configuration with VS Code compatible settings.json format.
 */

export interface EditorSettings {
  'editor.fontSize': number;
  'editor.tabSize': number;
  'editor.insertSpaces': boolean;
  'editor.autoIndent': 'none' | 'keep' | 'full';
  'editor.autoClosingBrackets': 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';
  'editor.wordWrap': 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  'editor.lineNumbers': 'on' | 'off' | 'relative';
  'editor.folding': boolean;
  'editor.minimap.enabled': boolean;
  'editor.minimap.width': number;
  'editor.minimap.showSlider': 'always' | 'mouseover';
  'editor.minimap.maxColumn': number;
  'editor.minimap.side': 'left' | 'right';
  'editor.renderWhitespace': 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
  'editor.mouseWheelScrollSensitivity': number;
  'editor.cursorBlinkRate': number;
  'editor.scrollBeyondLastLine': boolean;
  'editor.diagnostics.curlyUnderline': boolean;
  'editor.undoHistoryLimit': number;
  'files.autoSave': 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange';
  'files.watchFiles': 'onFocus' | 'always' | 'off';
  'files.exclude': Record<string, boolean>;
  'workbench.colorTheme': string;
  'workbench.startupEditor': string;
  'tui.sidebar.width': number;
  'tui.sidebar.visible': boolean;
  'tui.sidebar.location': 'left' | 'right';
  'tui.sidebar.focusedBackground': string;
  'tui.terminal.height': number;
  'tui.tabBar.scrollAmount': number;
  // TUI Outline panel settings
  'tui.outline.autoFollow': boolean;
  'tui.outline.collapsedOnStartup': boolean;
  'tui.outline.showIcons': boolean;
  'ultra.ai.model': string;
  'ultra.ai.apiKey': string;
  'terminal.integrated.shell': string;
  'terminal.integrated.position': 'bottom' | 'top' | 'left' | 'right';
  'terminal.integrated.defaultHeight': number;
  'terminal.integrated.defaultWidth': number;
  'git.statusInterval': number;
  'git.panel.location': 'sidebar-bottom' | 'sidebar-top' | 'panel';
  'git.panel.openOnStartup': boolean;
  'git.diffContextLines': number;
  'git.inlineDiff.maxHeight': number;
  'git.inlineDiff.contextLines': number;
  'terminal.integrated.openOnStartup': boolean;
  'terminal.integrated.spawnOnStartup': boolean;
  'ai.panel.defaultWidth': number;
  'ai.panel.maxWidthPercent': number;
  'ai.panel.openOnStartup': boolean;
  'ai.panel.initialPrompt': string;
  // Session settings
  /** Whether to restore sessions on startup */
  'session.restoreOnStartup': boolean;
  /** Whether to auto-save session state */
  'session.autoSave': boolean;
  /** Auto-save interval in milliseconds */
  'session.autoSaveInterval': number;
  /** What to save in sessions */
  'session.save.openFiles': boolean;
  'session.save.cursorPositions': boolean;
  'session.save.scrollPositions': boolean;
  'session.save.foldState': boolean;
  'session.save.uiLayout': boolean;
  'session.save.unsavedContent': boolean;
  // LSP settings
  /** Enable/disable LSP features globally */
  'lsp.enabled': boolean;
  /** Debounce delay for completion requests in milliseconds */
  'lsp.completionDebounceMs': number;
  /** Characters that trigger completion immediately */
  'lsp.triggerCharacters': string;
  /** Enable signature help */
  'lsp.signatureHelp.enabled': boolean;
  /** Where to display signature help */
  'lsp.signatureHelp.display': 'inline' | 'statusBar' | 'popup';
  /** Enable diagnostics */
  'lsp.diagnostics.enabled': boolean;
  /** Show diagnostic icons in gutter */
  'lsp.diagnostics.showInGutter': boolean;
  /** Underline diagnostic errors in editor */
  'lsp.diagnostics.underlineErrors': boolean;
  /** Delay before showing diagnostics after typing (ms) */
  'lsp.diagnostics.delay': number;
  /** Enable hover information */
  'lsp.hover.enabled': boolean;
}

const defaultSettings: EditorSettings = {
  'editor.fontSize': 14,
  'editor.tabSize': 2,
  'editor.insertSpaces': true,
  'editor.autoIndent': 'full',
  'editor.autoClosingBrackets': 'always',
  'editor.wordWrap': 'off',
  'editor.lineNumbers': 'on',
  'editor.folding': true,
  'editor.minimap.enabled': true,
  'editor.minimap.width': 10,
  'editor.minimap.showSlider': 'always',
  'editor.minimap.maxColumn': 120,
  'editor.minimap.side': 'right',
  'editor.renderWhitespace': 'selection',
  'editor.mouseWheelScrollSensitivity': 3,
  'editor.cursorBlinkRate': 500,
  'editor.scrollBeyondLastLine': true,
  'editor.diagnostics.curlyUnderline': true,
  'editor.undoHistoryLimit': 1000,
  'files.autoSave': 'off',
  'files.watchFiles': 'onFocus',
  'files.exclude': {
    '**/node_modules': true,
    '**/.git': true,
    '**/.DS_Store': true
  },
  'workbench.colorTheme': 'catppuccin-frappe',
  'workbench.startupEditor': '~/.ultra/BOOT.md',
  'tui.sidebar.width': 36,
  'tui.sidebar.visible': true,
  'tui.sidebar.location': 'left',
  'tui.sidebar.focusedBackground': '#2d3139',
  'tui.terminal.height': 10,
  'tui.tabBar.scrollAmount': 1,
  // TUI Outline panel settings
  'tui.outline.autoFollow': true,
  'tui.outline.collapsedOnStartup': true,
  'tui.outline.showIcons': true,
  'ultra.ai.model': 'claude-sonnet-4-20250514',
  'ultra.ai.apiKey': '${env:ANTHROPIC_API_KEY}',
  'terminal.integrated.shell': process.env.SHELL || '/bin/zsh',
  'terminal.integrated.position': 'bottom',
  'terminal.integrated.defaultHeight': 12,
  'terminal.integrated.defaultWidth': 40,
  'git.statusInterval': 100,
  'git.panel.location': 'sidebar-bottom',
  'git.panel.openOnStartup': true,
  'git.diffContextLines': 3,
  'git.inlineDiff.maxHeight': 15,
  'git.inlineDiff.contextLines': 3,
  'terminal.integrated.openOnStartup': true,
  'terminal.integrated.spawnOnStartup': true,
  'ai.panel.defaultWidth': 80,
  'ai.panel.maxWidthPercent': 50,
  'ai.panel.openOnStartup': true,
  'ai.panel.initialPrompt': 'You are a helpful software engineer working with another software engineer on a coding project using the Ultra IDE',
  // Session settings
  'session.restoreOnStartup': true,
  'session.autoSave': true,
  'session.autoSaveInterval': 30000,
  'session.save.openFiles': true,
  'session.save.cursorPositions': true,
  'session.save.scrollPositions': true,
  'session.save.foldState': true,
  'session.save.uiLayout': true,
  'session.save.unsavedContent': true,
  // LSP settings
  'lsp.enabled': true,
  'lsp.completionDebounceMs': 250,
  'lsp.triggerCharacters': '.:/<@(',
  'lsp.signatureHelp.enabled': true,
  'lsp.signatureHelp.display': 'popup',
  'lsp.diagnostics.enabled': true,
  'lsp.diagnostics.showInGutter': true,
  'lsp.diagnostics.underlineErrors': true,
  'lsp.diagnostics.delay': 500,
  'lsp.hover.enabled': true
};

export class Settings {
  private settings: EditorSettings;
  private listeners: Map<string, Set<(value: any) => void>> = new Map();

  constructor() {
    this.settings = { ...defaultSettings };
  }

  /**
   * Get a setting value
   */
  get<K extends keyof EditorSettings>(key: K): EditorSettings[K] {
    return this.settings[key];
  }

  /**
   * Set a setting value
   */
  set<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void {
    const oldValue = this.settings[key];
    this.settings[key] = value;
    
    if (oldValue !== value) {
      this.notifyListeners(key, value);
    }
  }

  /**
   * Get all settings
   */
  getAll(): EditorSettings {
    return { ...this.settings };
  }

  /**
   * Update multiple settings
   */
  update(partial: Partial<EditorSettings>): void {
    for (const [key, value] of Object.entries(partial)) {
      if (key in this.settings && value !== undefined) {
        // @ts-expect-error - dynamic key assignment
        this.settings[key] = value;
        this.notifyListeners(key, value);
      }
    }
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.settings = { ...defaultSettings };
    for (const key of Object.keys(this.settings) as (keyof EditorSettings)[]) {
      this.notifyListeners(key, this.settings[key]);
    }
  }

  /**
   * Listen for changes to a specific setting
   */
  onChange<K extends keyof EditorSettings>(
    key: K,
    callback: (value: EditorSettings[K]) => void
  ): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
    
    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  /**
   * Process environment variable substitution
   */
  resolveEnvVars(value: string): string {
    return value.replace(/\$\{env:([^}]+)\}/g, (_, envVar) => {
      return process.env[envVar] || '';
    });
  }

  private notifyListeners(key: string, value: any): void {
    const keyListeners = this.listeners.get(key);
    if (keyListeners) {
      for (const listener of keyListeners) {
        listener(value);
      }
    }
  }
}

export const settings = new Settings();

export default settings;
