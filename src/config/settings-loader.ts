/**
 * Settings Loader
 *
 * Loads and parses VS Code compatible settings.json files.
 */

import { debugLog } from '../debug.ts';
import type { EditorSettings } from './settings.ts';

export class SettingsLoader {
  /**
   * Load settings from a file path
   */
  async loadFromFile(filePath: string): Promise<Partial<EditorSettings>> {
    try {
      const file = Bun.file(filePath);
      const content = await file.text();
      return this.parse(content);
    } catch (error) {
      // Silently fail for $bunfs paths (expected in compiled binaries)
      if (!filePath.includes('$bunfs')) {
        debugLog(`[SettingsLoader] Failed to load settings from ${filePath}: ${error}`);
      }
      return {};
    }
  }

  /**
   * Parse settings JSON content
   */
  parse(content: string): Partial<EditorSettings> {
    try {
      // Remove comments (simple JSON with comments support)
      const cleanContent = content
        .replace(/\/\/.*$/gm, '')  // Single line comments
        .replace(/\/\*[\s\S]*?\*\//g, '');  // Multi-line comments

      return JSON.parse(cleanContent);
    } catch (error) {
      debugLog(`[SettingsLoader] Failed to parse settings: ${error}`);
      return {};
    }
  }

  /**
   * Merge multiple settings sources with later ones overriding earlier
   */
  merge(...sources: Partial<EditorSettings>[]): Partial<EditorSettings> {
    return Object.assign({}, ...sources);
  }

  /**
   * Find user settings file path
   */
  getUserSettingsPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return `${home}/.config/ultra/settings.json`;
  }

  /**
   * Find workspace settings file path
   */
  getWorkspaceSettingsPath(workspaceRoot: string): string {
    return `${workspaceRoot}/.ultra/settings.json`;
  }
}

export const settingsLoader = new SettingsLoader();

export default settingsLoader;
