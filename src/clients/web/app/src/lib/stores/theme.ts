/**
 * Theme Store
 *
 * Svelte store for the current theme state.
 */

import { writable, derived } from 'svelte/store';
import type { Theme } from '../theme/loader';

/**
 * Writable store for the current theme.
 */
export const themeStore = writable<Theme | null>(null);

/**
 * Derived store for theme type (dark/light).
 */
export const themeType = derived(themeStore, ($theme) => $theme?.type ?? 'dark');

/**
 * Derived store for whether dark mode is active.
 */
export const isDark = derived(themeType, ($type) => $type === 'dark');

/**
 * Get a specific theme color.
 */
export function getThemeColor(theme: Theme | null, key: string, fallback: string = '#000000'): string {
  return theme?.colors[key] ?? fallback;
}

export default themeStore;
