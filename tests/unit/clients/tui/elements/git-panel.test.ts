/**
 * GitPanel Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  GitPanel,
  createGitPanel,
  type GitState,
  type GitChange,
} from '../../../../../src/clients/tui/elements/git-panel.ts';
import { createTestContext, type ElementContext } from '../../../../../src/clients/tui/elements/base.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

// ============================================
// Test Data
// ============================================

function createTestState(): GitState {
  return {
    branch: 'main',
    upstream: 'origin/main',
    ahead: 2,
    behind: 1,
    staged: [
      { path: 'src/index.ts', indexStatus: 'M', workingStatus: ' ' },
      { path: 'src/new.ts', indexStatus: 'A', workingStatus: ' ' },
    ],
    unstaged: [
      { path: 'src/utils.ts', indexStatus: ' ', workingStatus: 'M' },
    ],
    untracked: [
      { path: 'temp.txt', indexStatus: '?', workingStatus: '?' },
    ],
    merging: false,
    rebasing: false,
  };
}

// ============================================
// Tests
// ============================================

describe('GitPanel', () => {
  let panel: GitPanel;
  let ctx: ElementContext;

  beforeEach(() => {
    ctx = createTestContext();
    panel = new GitPanel('git1', 'Source Control', ctx);
    panel.setBounds({ x: 0, y: 0, width: 40, height: 20 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Data Management
  // ─────────────────────────────────────────────────────────────────────────

  describe('data management', () => {
    test('setGitState sets state', () => {
      const state = createTestState();
      panel.setGitState(state);

      const gitState = panel.getGitState();
      expect(gitState.branch).toBe('main');
      expect(gitState.staged).toHaveLength(2);
    });

    test('setBranch updates branch info', () => {
      panel.setBranch('develop', 'origin/develop', 5, 3);

      const state = panel.getGitState();
      expect(state.branch).toBe('develop');
      expect(state.ahead).toBe(5);
      expect(state.behind).toBe(3);
    });

    test('setStagedChanges updates staged list', () => {
      const changes: GitChange[] = [
        { path: 'file.ts', indexStatus: 'A', workingStatus: ' ' },
      ];
      panel.setStagedChanges(changes);

      expect(panel.getGitState().staged).toHaveLength(1);
    });

    test('setUnstagedChanges updates unstaged list', () => {
      const changes: GitChange[] = [
        { path: 'file.ts', indexStatus: ' ', workingStatus: 'M' },
      ];
      panel.setUnstagedChanges(changes);

      expect(panel.getGitState().unstaged).toHaveLength(1);
    });

    test('setUntrackedFiles updates untracked list', () => {
      const changes: GitChange[] = [
        { path: 'new.txt', indexStatus: '?', workingStatus: '?' },
      ];
      panel.setUntrackedFiles(changes);

      expect(panel.getGitState().untracked).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Selection & Navigation
  // ─────────────────────────────────────────────────────────────────────────

  describe('selection and navigation', () => {
    beforeEach(() => {
      panel.setGitState(createTestState());
    });

    test('getSelectedNode returns selected node', () => {
      const node = panel.getSelectedNode();
      expect(node).not.toBeNull();
      expect(node?.type).toBe('section');
      expect(node?.section).toBe('staged');
    });

    test('moveDown moves selection down', () => {
      panel.moveDown();
      const node = panel.getSelectedNode();
      expect(node?.type).toBe('file');
    });

    test('moveUp moves selection up', () => {
      panel.moveDown();
      panel.moveUp();
      const node = panel.getSelectedNode();
      expect(node?.type).toBe('section');
    });

    test('moveUp at top stays at top', () => {
      panel.moveUp();
      const node = panel.getSelectedNode();
      expect(node?.section).toBe('staged');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section Toggle
  // ─────────────────────────────────────────────────────────────────────────

  describe('section toggle', () => {
    beforeEach(() => {
      panel.setGitState(createTestState());
    });

    test('toggleSection collapses section', () => {
      panel.toggleSection(); // Collapse staged section

      // Move down should skip to next section
      panel.moveDown();
      const node = panel.getSelectedNode();
      expect(node?.section).toBe('unstaged');
    });

    test('toggleSection expands collapsed section', () => {
      panel.toggleSection(); // Collapse
      panel.toggleSection(); // Expand

      panel.moveDown();
      const node = panel.getSelectedNode();
      expect(node?.type).toBe('file');
      expect(node?.section).toBe('staged');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  describe('actions', () => {
    test('stageOrUnstage calls onStage for unstaged file', () => {
      let stagedPath: string | null = null;
      const panelWithCallback = new GitPanel('git2', 'Source Control', ctx, {
        onStage: (path) => {
          stagedPath = path;
        },
      });
      panelWithCallback.setBounds({ x: 0, y: 0, width: 40, height: 20 });
      panelWithCallback.setGitState(createTestState());

      // Navigate to unstaged section file
      // staged header, 2 staged files, unstaged header, first unstaged file
      for (let i = 0; i < 4; i++) panelWithCallback.moveDown();

      panelWithCallback.stageOrUnstage();
      expect(stagedPath).toBe('src/utils.ts');
    });

    test('stageOrUnstage calls onUnstage for staged file', () => {
      let unstagedPath: string | null = null;
      const panelWithCallback = new GitPanel('git2', 'Source Control', ctx, {
        onUnstage: (path) => {
          unstagedPath = path;
        },
      });
      panelWithCallback.setBounds({ x: 0, y: 0, width: 40, height: 20 });
      panelWithCallback.setGitState(createTestState());

      panelWithCallback.moveDown(); // First staged file
      panelWithCallback.stageOrUnstage();

      expect(unstagedPath).toBe('src/index.ts');
    });

    test('discardChanges calls onDiscard', () => {
      let discardedPath: string | null = null;
      const panelWithCallback = new GitPanel('git2', 'Source Control', ctx, {
        onDiscard: (path) => {
          discardedPath = path;
        },
      });
      panelWithCallback.setBounds({ x: 0, y: 0, width: 40, height: 20 });
      panelWithCallback.setGitState(createTestState());

      // Navigate to unstaged file
      for (let i = 0; i < 4; i++) panelWithCallback.moveDown();

      panelWithCallback.discardChanges();
      expect(discardedPath).toBe('src/utils.ts');
    });

    test('openDiff calls onOpenDiff', () => {
      let openedPath: string | null = null;
      let wasStaged = false;
      const panelWithCallback = new GitPanel('git2', 'Source Control', ctx, {
        onOpenDiff: (path, staged) => {
          openedPath = path;
          wasStaged = staged;
        },
      });
      panelWithCallback.setBounds({ x: 0, y: 0, width: 40, height: 20 });
      panelWithCallback.setGitState(createTestState());

      panelWithCallback.moveDown(); // First staged file
      panelWithCallback.openDiff();

      expect(openedPath).toBe('src/index.ts');
      expect(wasStaged).toBe(true);
    });

    test('openFile calls onOpenFile', () => {
      let openedPath: string | null = null;
      const panelWithCallback = new GitPanel('git2', 'Source Control', ctx, {
        onOpenFile: (path) => {
          openedPath = path;
        },
      });
      panelWithCallback.setBounds({ x: 0, y: 0, width: 40, height: 20 });
      panelWithCallback.setGitState(createTestState());

      panelWithCallback.moveDown(); // First staged file
      panelWithCallback.openFile();

      expect(openedPath).toBe('src/index.ts');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('renders branch header', () => {
      panel.setGitState(createTestState());

      const buffer = createScreenBuffer({ width: 40, height: 20 });
      panel.render(buffer);

      // Check for 'main' in header
      let foundMain = false;
      for (let x = 0; x < 40; x++) {
        if (buffer.get(x, 0)?.char === 'm' &&
            buffer.get(x + 1, 0)?.char === 'a' &&
            buffer.get(x + 2, 0)?.char === 'i' &&
            buffer.get(x + 3, 0)?.char === 'n') {
          foundMain = true;
          break;
        }
      }
      expect(foundMain).toBe(true);
    });

    test('renders section headers', () => {
      panel.setGitState(createTestState());

      const buffer = createScreenBuffer({ width: 40, height: 20 });
      panel.render(buffer);

      // Check for 'Staged' in output
      let foundStaged = false;
      for (let y = 1; y < 20; y++) {
        for (let x = 0; x < 30; x++) {
          if (buffer.get(x, y)?.char === 'S' &&
              buffer.get(x + 1, y)?.char === 't') {
            foundStaged = true;
            break;
          }
        }
        if (foundStaged) break;
      }
      expect(foundStaged).toBe(true);
    });

    test('renders file names', () => {
      panel.setGitState(createTestState());

      const buffer = createScreenBuffer({ width: 40, height: 20 });
      panel.render(buffer);

      // Check for 'index.ts' in output
      let foundIndex = false;
      for (let y = 1; y < 20; y++) {
        for (let x = 0; x < 35; x++) {
          if (buffer.get(x, y)?.char === 'i' &&
              buffer.get(x + 1, y)?.char === 'n' &&
              buffer.get(x + 2, y)?.char === 'd') {
            foundIndex = true;
            break;
          }
        }
        if (foundIndex) break;
      }
      expect(foundIndex).toBe(true);
    });

    test('renders empty state message', () => {
      // Empty state (no changes)
      panel.setGitState({
        branch: 'main',
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: [],
        untracked: [],
        merging: false,
        rebasing: false,
      });

      const buffer = createScreenBuffer({ width: 40, height: 20 });
      panel.render(buffer);

      // Check for 'No changes'
      let foundEmpty = false;
      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 30; x++) {
          if (buffer.get(x, y)?.char === 'N' &&
              buffer.get(x + 1, y)?.char === 'o') {
            foundEmpty = true;
            break;
          }
        }
        if (foundEmpty) break;
      }
      expect(foundEmpty).toBe(true);
    });

    test('renders merge state', () => {
      const state = createTestState();
      state.merging = true;
      panel.setGitState(state);

      const buffer = createScreenBuffer({ width: 40, height: 20 });
      panel.render(buffer);

      // Check for 'MERGING' in header
      let foundMerging = false;
      for (let x = 0; x < 40; x++) {
        if (buffer.get(x, 0)?.char === 'M' &&
            buffer.get(x + 1, 0)?.char === 'E' &&
            buffer.get(x + 2, 0)?.char === 'R') {
          foundMerging = true;
          break;
        }
      }
      expect(foundMerging).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    beforeEach(() => {
      panel.setGitState(createTestState());
    });

    test('ArrowDown moves selection down', () => {
      panel.handleKey({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      const node = panel.getSelectedNode();
      expect(node?.type).toBe('file');
    });

    test('ArrowUp moves selection up', () => {
      panel.handleKey({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      panel.handleKey({ key: 'ArrowUp', ctrl: false, alt: false, shift: false, meta: false });
      const node = panel.getSelectedNode();
      expect(node?.type).toBe('section');
    });

    test('Enter on section toggles it', () => {
      panel.handleKey({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });

      // Section should be collapsed, so next item is unstaged section
      panel.handleKey({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      const node = panel.getSelectedNode();
      expect(node?.section).toBe('unstaged');
    });

    test('Space stages/unstages file', () => {
      let unstagedPath: string | null = null;
      const panelWithCallback = new GitPanel('git2', 'Source Control', ctx, {
        onUnstage: (path) => {
          unstagedPath = path;
        },
      });
      panelWithCallback.setBounds({ x: 0, y: 0, width: 40, height: 20 });
      panelWithCallback.setGitState(createTestState());

      panelWithCallback.moveDown();
      panelWithCallback.handleKey({ key: ' ', ctrl: false, alt: false, shift: false, meta: false });

      expect(unstagedPath).toBe('src/index.ts');
    });

    test('vim keys work', () => {
      panel.handleKey({ key: 'j', ctrl: false, alt: false, shift: false, meta: false });
      expect(panel.getSelectedNode()?.type).toBe('file');

      panel.handleKey({ key: 'k', ctrl: false, alt: false, shift: false, meta: false });
      expect(panel.getSelectedNode()?.type).toBe('section');
    });

    test('r refreshes', () => {
      let refreshCalled = false;
      const panelWithCallback = new GitPanel('git2', 'Source Control', ctx, {
        onRefresh: () => {
          refreshCalled = true;
        },
      });

      panelWithCallback.handleKey({ key: 'r', ctrl: false, alt: false, shift: false, meta: false });
      expect(refreshCalled).toBe(true);
    });

    test('Ctrl+C commits', () => {
      let commitCalled = false;
      const panelWithCallback = new GitPanel('git2', 'Source Control', ctx, {
        onCommit: () => {
          commitCalled = true;
        },
      });

      panelWithCallback.handleKey({ key: 'c', ctrl: true, alt: false, shift: false, meta: false });
      expect(commitCalled).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  describe('serialization', () => {
    test('getState returns state', () => {
      panel.setGitState(createTestState());
      panel.toggleSection(); // Collapse staged

      const state = panel.getState() as { scrollTop: number; collapsedSections: string[] };

      expect(state.collapsedSections).toContain('staged');
    });

    test('setState restores state', () => {
      panel.setGitState(createTestState());
      panel.setState({
        scrollTop: 0,
        collapsedSections: ['staged'],
      });

      // Staged section should be collapsed
      panel.moveDown();
      const node = panel.getSelectedNode();
      expect(node?.section).toBe('unstaged');
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createGitPanel', () => {
  test('creates git panel', () => {
    const ctx = createTestContext();
    const panel = createGitPanel('git1', 'Source Control', ctx);

    expect(panel).toBeInstanceOf(GitPanel);
    expect(panel.id).toBe('git1');
  });
});
