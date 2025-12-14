/**
 * Settings Manager
 * 
 * Manages editor configuration with VS Code compatible settings.json format.
 */

export interface EditorSettings {
  'editor.fontSize': number;
  'editor.tabSize': number;
  'editor.insertSpaces': boolean;
  'editor.wordWrap': 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  'editor.lineNumbers': 'on' | 'off' | 'relative';
  'editor.minimap.enabled': boolean;
  'editor.minimap.width': number;
  'editor.minimap.showSlider': 'always' | 'mouseover';
  'editor.minimap.maxColumn': number;
  'editor.minimap.side': 'left' | 'right';
  'editor.renderWhitespace': 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
  'editor.mouseWheelScrollSensitivity': number;
  'editor.cursorBlinkRate': number;
  'editor.scrollBeyondLastLine': boolean;
  'files.autoSave': 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange';
  'files.exclude': Record<string, boolean>;
  'workbench.colorTheme': string;
  'workbench.sideBar.location': 'left' | 'right';
  'ultra.sidebar.width': number;
  'ultra.ai.model': string;
  'ultra.ai.apiKey': string;
}

const defaultSettings: EditorSettings = {
  'editor.fontSize': 14,
  'editor.tabSize': 2,
  'editor.insertSpaces': true,
  'editor.wordWrap': 'off',
  'editor.lineNumbers': 'on',
  'editor.minimap.enabled': true,
  'editor.minimap.width': 10,
  'editor.minimap.showSlider': 'always',
  'editor.minimap.maxColumn': 120,
  'editor.minimap.side': 'right',
  'editor.renderWhitespace': 'selection',
  'editor.mouseWheelScrollSensitivity': 3,
  'editor.cursorBlinkRate': 500,
  'editor.scrollBeyondLastLine': true,
  'files.autoSave': 'off',
  'files.exclude': {
    '**/node_modules': true,
    '**/.git': true,
    '**/.DS_Store': true
  },
  'workbench.colorTheme': 'One Dark',
  'workbench.sideBar.location': 'left',
  'ultra.sidebar.width': 30,
  'ultra.ai.model': 'claude-sonnet-4-20250514',
  'ultra.ai.apiKey': '${env:ANTHROPIC_API_KEY}'
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
