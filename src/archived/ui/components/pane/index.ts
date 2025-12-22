/**
 * Pane Components
 *
 * This directory contains decomposed components of the Pane editor.
 * The main Pane class orchestrates these sub-components.
 */

// Gutter rendering (line numbers, git indicators, fold icons)
export {
  PaneGutter,
  paneGutter,
  type GutterTheme,
  type GutterLineContext,
} from './pane-gutter.ts';

// Inline diff widget
export {
  InlineDiffWidget,
  inlineDiffWidget,
  createInlineDiffState,
  type InlineDiffState,
  type InlineDiffCallbacks,
} from './inline-diff.ts';
