/**
 * User Configuration Manager
 * 
 * Manages user configuration in ~/.ultra directory.
 * Creates default config files if they don't exist and watches for changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { settings } from './settings.ts';
import { settingsLoader } from './settings-loader.ts';
import { keymap } from '../input/keymap.ts';
import { keybindingsLoader } from '../input/keybindings-loader.ts';
import { themeLoader } from '../ui/themes/theme-loader.ts';
import { defaultKeybindings, defaultSettings, defaultThemes } from './defaults.ts';

export interface ThemeInfo {
  name: string;
  displayName: string;
  path: string;
  isBuiltIn: boolean;
}

export class UserConfigManager {
  private configDir: string;
  private themesDir: string;
  private settingsPath: string;
  private keybindingsPath: string;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private onReloadCallback?: () => void;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private currentThemePath: string = '';

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    this.configDir = path.join(home, '.ultra');
    this.themesDir = path.join(this.configDir, 'themes');
    this.settingsPath = path.join(this.configDir, 'settings.json');
    this.keybindingsPath = path.join(this.configDir, 'keybindings.json');
  }

  /**
   * Set callback for when config is reloaded
   */
  onReload(callback: () => void): void {
    this.onReloadCallback = callback;
  }

  /**
   * Initialize user config directory and files
   */
  async init(): Promise<void> {
    // Ensure config directory exists
    await this.ensureConfigDir();

    // Create default files if they don't exist
    await this.ensureDefaultFiles();

    // Load user config
    await this.loadUserConfig();

    // Start watching for changes
    this.watchConfigFiles();
  }

  /**
   * Ensure ~/.ultra directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.promises.mkdir(this.configDir, { recursive: true });
      await fs.promises.mkdir(this.themesDir, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        console.error('Failed to create config directory:', error);
      }
    }
  }

  /**
   * Create default config files if they don't exist
   */
  private async ensureDefaultFiles(): Promise<void> {
    // Check and create settings.json
    if (!await this.fileExists(this.settingsPath)) {
      const defaultSettingsContent = JSON.stringify(defaultSettings, null, 2);
      await this.writeFile(this.settingsPath, defaultSettingsContent);
    }

    // Check and create keybindings.json
    if (!await this.fileExists(this.keybindingsPath)) {
      const defaultKeybindingsContent = JSON.stringify(defaultKeybindings, null, 2);
      await this.writeFile(this.keybindingsPath, defaultKeybindingsContent);
    }

    // Copy default themes to themes directory
    await this.ensureDefaultThemes();
  }

  /**
   * Copy default themes to user themes directory
   */
  private async ensureDefaultThemes(): Promise<void> {
    for (const [themeName, themeData] of Object.entries(defaultThemes)) {
      const themePath = path.join(this.themesDir, `${themeName}.json`);
      if (!await this.fileExists(themePath)) {
        const themeContent = JSON.stringify(themeData, null, 2);
        await this.writeFile(themePath, themeContent);
      }
    }
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Write file with error handling
   */
  private async writeFile(filePath: string, content: string): Promise<void> {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      console.error(`Failed to write ${filePath}:`, error);
    }
  }

  /**
   * Load user configuration files
   */
  async loadUserConfig(): Promise<void> {
    // Load embedded defaults first
    keymap.loadBindings(defaultKeybindings);
    settings.update(defaultSettings);

    // Load user settings (overrides defaults)
    try {
      const userSettings = await settingsLoader.loadFromFile(this.settingsPath);
      if (userSettings && Object.keys(userSettings).length > 0) {
        settings.update(userSettings);
      }
    } catch {
      // Use defaults if user file fails to load
    }

    // Load user keybindings (overrides defaults)
    try {
      const userBindings = await keybindingsLoader.loadFromFile(this.keybindingsPath);
      if (userBindings.length > 0) {
        keymap.loadBindings(userBindings);
      }
    } catch {
      // Use defaults if user file fails to load
    }

    // Load theme
    await this.loadTheme();
  }

  /**
   * Load theme based on current settings
   */
  async loadTheme(themeName?: string): Promise<void> {
    const name = themeName || settings.get('workbench.colorTheme') || 'catppuccin-frappe';
    
    // First try to load from user themes directory
    const userThemePath = path.join(this.themesDir, `${name}.json`);
    try {
      if (await this.fileExists(userThemePath)) {
        await themeLoader.loadFromFile(userThemePath);
        
        // Only set up watcher if path changed
        if (this.currentThemePath !== userThemePath) {
          this.currentThemePath = userThemePath;
          this.watchThemeFile(userThemePath);
        }
        return;
      }
    } catch {
      // Fall through to embedded themes
    }
    
    // Fall back to embedded theme
    const embeddedTheme = defaultThemes[name];
    if (embeddedTheme) {
      themeLoader.parse(JSON.stringify(embeddedTheme));
      // Remove theme watcher for embedded themes
      const existingWatcher = this.watchers.get('theme');
      if (existingWatcher) {
        existingWatcher.close();
        this.watchers.delete('theme');
      }
      this.currentThemePath = '';
    } else {
      // Fall back to catppuccin-frappe
      if (defaultThemes['catppuccin-frappe']) {
        themeLoader.parse(JSON.stringify(defaultThemes['catppuccin-frappe']));
        this.currentThemePath = '';
      }
    }
  }

  /**
   * Watch theme file for changes
   */
  private watchThemeFile(themePath: string): void {
    // Remove existing theme watcher
    const existingWatcher = this.watchers.get('theme');
    if (existingWatcher) {
      existingWatcher.close();
      this.watchers.delete('theme');
    }

    try {
      const watcher = fs.watch(themePath, { persistent: false }, (eventType) => {
        // Handle both 'change' and 'rename' events (some editors replace files)
        if (eventType === 'change' || eventType === 'rename') {
          const existingTimer = this.debounceTimers.get('theme');
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          
          const timer = setTimeout(async () => {
            this.debounceTimers.delete('theme');
            
            // If file was renamed/replaced, re-setup watcher
            if (eventType === 'rename') {
              // Check if file still exists, then re-watch
              if (await this.fileExists(themePath)) {
                this.watchThemeFile(themePath);
              }
            }
            
            await this.reloadConfig('theme');
          }, 100);
          
          this.debounceTimers.set('theme', timer);
        }
      });

      this.watchers.set('theme', watcher);
    } catch {
      // Ignore watch errors
    }
  }

  /**
   * Get list of available themes
   */
  async getAvailableThemes(): Promise<ThemeInfo[]> {
    const themes: ThemeInfo[] = [];
    
    try {
      const files = await fs.promises.readdir(this.themesDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const themePath = path.join(this.themesDir, file);
        const themeName = file.replace('.json', '');
        
        try {
          const content = await fs.promises.readFile(themePath, 'utf-8');
          const parsed = JSON.parse(content);
          
          themes.push({
            name: themeName,
            displayName: parsed.name || themeName,
            path: themePath,
            isBuiltIn: themeName in defaultThemes
          });
        } catch {
          // Skip invalid theme files
          themes.push({
            name: themeName,
            displayName: themeName,
            path: themePath,
            isBuiltIn: themeName in defaultThemes
          });
        }
      }
    } catch {
      // If themes dir doesn't exist or can't be read, return embedded themes
      for (const [name, theme] of Object.entries(defaultThemes)) {
        themes.push({
          name,
          displayName: theme.name,
          path: '',
          isBuiltIn: true
        });
      }
    }
    
    // Sort alphabetically by display name
    themes.sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    return themes;
  }

  /**
   * Get current theme file path
   */
  getCurrentThemePath(): string {
    if (this.currentThemePath) {
      return this.currentThemePath;
    }
    
    // Return path to theme in themes dir
    const themeName = settings.get('workbench.colorTheme') || 'catppuccin-frappe';
    return path.join(this.themesDir, `${themeName}.json`);
  }

  /**
   * Get themes directory path
   */
  getThemesDir(): string {
    return this.themesDir;
  }

  /**
   * Change theme and update settings
   */
  async changeTheme(themeName: string): Promise<void> {
    // Update settings
    settings.update({ 'workbench.colorTheme': themeName } as any);

    // Save to settings file
    try {
      const currentSettings = await settingsLoader.loadFromFile(this.settingsPath);
      const newSettings = { ...currentSettings, 'workbench.colorTheme': themeName };
      await this.writeFile(this.settingsPath, JSON.stringify(newSettings, null, 2));
    } catch {
      // Ignore save errors
    }

    // Load the theme
    await this.loadTheme(themeName);

    // Notify app
    if (this.onReloadCallback) {
      this.onReloadCallback();
    }
  }

  /**
   * Save a single setting to disk and update in-memory settings
   */
  async saveSetting(key: string, value: any): Promise<void> {
    // Update in-memory settings
    settings.update({ [key]: value } as any);

    // Save to settings file
    try {
      const currentSettings = await settingsLoader.loadFromFile(this.settingsPath);
      const newSettings = { ...currentSettings, [key]: value };
      await this.writeFile(this.settingsPath, JSON.stringify(newSettings, null, 2));
    } catch (error) {
      console.error(`Failed to save setting ${key}:`, error);
    }

    // If theme changed, reload it
    if (key === 'workbench.colorTheme') {
      await this.loadTheme(value);
    }

    // Notify app to re-render
    if (this.onReloadCallback) {
      this.onReloadCallback();
    }
  }

  /**
   * Watch config files for changes
   */
  private watchConfigFiles(): void {
    this.watchFile(this.settingsPath, 'settings');
    this.watchFile(this.keybindingsPath, 'keybindings');
  }

  /**
   * Watch a single file for changes
   */
  private watchFile(filePath: string, type: string): void {
    try {
      const watcher = fs.watch(filePath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          // Debounce to avoid multiple rapid reloads
          const existingTimer = this.debounceTimers.get(type);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          
          const timer = setTimeout(async () => {
            this.debounceTimers.delete(type);
            await this.reloadConfig(type);
          }, 100);
          
          this.debounceTimers.set(type, timer);
        }
      });

      this.watchers.set(type, watcher);
    } catch (error) {
      console.error(`Failed to watch ${filePath}:`, error);
    }
  }

  /**
   * Reload a specific config type
   */
  private async reloadConfig(type: string): Promise<void> {
    try {
      if (type === 'settings') {
        // Reload settings
        settings.update(defaultSettings);  // Reset to defaults first
        const userSettings = await settingsLoader.loadFromFile(this.settingsPath);
        if (userSettings && Object.keys(userSettings).length > 0) {
          settings.update(userSettings);
        }
        // Reload theme in case it changed
        await this.loadTheme();
      } else if (type === 'keybindings') {
        // Reload keybindings
        keymap.loadBindings(defaultKeybindings);  // Reset to defaults first
        const userBindings = await keybindingsLoader.loadFromFile(this.keybindingsPath);
        if (userBindings.length > 0) {
          keymap.loadBindings(userBindings);
        }
      } else if (type === 'theme') {
        // Reload current theme
        await this.loadTheme();
      }

      // Notify app to re-render
      if (this.onReloadCallback) {
        this.onReloadCallback();
      }
    } catch (error) {
      console.error(`Failed to reload ${type}:`, error);
    }
  }

  /**
   * Get the config directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Get the settings file path
   */
  getSettingsPath(): string {
    return this.settingsPath;
  }

  /**
   * Get the keybindings file path
   */
  getKeybindingsPath(): string {
    return this.keybindingsPath;
  }

  /**
   * Cleanup watchers
   */
  destroy(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}

export const userConfigManager = new UserConfigManager();
export default userConfigManager;
