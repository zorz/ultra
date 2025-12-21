/**
 * FileTree Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  FileTree,
  createFileTree,
  type FileNode,
} from '../../../../../src/clients/tui/elements/file-tree.ts';
import { createTestContext, type ElementContext } from '../../../../../src/clients/tui/elements/base.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

// ============================================
// Test Data
// ============================================

function createTestTree(): FileNode[] {
  return [
    {
      name: 'src',
      path: '/project/src',
      isDirectory: true,
      children: [
        { name: 'index.ts', path: '/project/src/index.ts', isDirectory: false },
        { name: 'utils.ts', path: '/project/src/utils.ts', isDirectory: false },
      ],
    },
    {
      name: 'tests',
      path: '/project/tests',
      isDirectory: true,
      children: [
        { name: 'test.ts', path: '/project/tests/test.ts', isDirectory: false },
      ],
    },
    { name: 'package.json', path: '/project/package.json', isDirectory: false },
    { name: 'README.md', path: '/project/README.md', isDirectory: false },
  ];
}

// ============================================
// Tests
// ============================================

describe('FileTree', () => {
  let tree: FileTree;
  let ctx: ElementContext;

  beforeEach(() => {
    ctx = createTestContext();
    tree = new FileTree('tree1', 'Explorer', ctx);
    tree.setBounds({ x: 0, y: 0, width: 40, height: 20 });
    tree.setRoots(createTestTree());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Data Management
  // ─────────────────────────────────────────────────────────────────────────

  describe('data management', () => {
    test('setRoots sets tree data', () => {
      const roots = tree.getRoots();
      expect(roots).toHaveLength(4);
    });

    test('findNode finds node by path', () => {
      const node = tree.findNode('/project/src/index.ts');
      expect(node).not.toBeNull();
      expect(node?.name).toBe('index.ts');
    });

    test('findNode returns null for unknown path', () => {
      const node = tree.findNode('/unknown/path');
      expect(node).toBeNull();
    });

    test('setChildren updates directory children', () => {
      tree.setChildren('/project/src', [
        { name: 'new.ts', path: '/project/src/new.ts', isDirectory: false },
      ]);

      const node = tree.findNode('/project/src/new.ts');
      expect(node).not.toBeNull();
    });

    test('setGitStatus updates node status', () => {
      tree.setGitStatus('/project/src/index.ts', 'M');
      const node = tree.findNode('/project/src/index.ts');
      expect(node?.gitStatus).toBe('M');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Selection & Navigation
  // ─────────────────────────────────────────────────────────────────────────

  describe('selection and navigation', () => {
    test('getSelectedPath returns first item initially', () => {
      // Directories are sorted first
      const selected = tree.getSelectedPath();
      expect(selected).toBe('/project/src');
    });

    test('selectPath selects node', () => {
      tree.selectPath('/project/package.json');
      expect(tree.getSelectedPath()).toBe('/project/package.json');
    });

    test('moveDown moves selection down', () => {
      tree.moveDown();
      // Should move to next item (tests folder since sorted)
      const selected = tree.getSelectedPath();
      expect(selected).toBe('/project/tests');
    });

    test('moveUp moves selection up', () => {
      tree.moveDown();
      tree.moveUp();
      expect(tree.getSelectedPath()).toBe('/project/src');
    });

    test('moveUp at top stays at top', () => {
      tree.moveUp();
      expect(tree.getSelectedPath()).toBe('/project/src');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Expand/Collapse
  // ─────────────────────────────────────────────────────────────────────────

  describe('expand and collapse', () => {
    test('toggle expands collapsed directory', () => {
      const srcNode = tree.findNode('/project/src');
      expect(srcNode?.expanded).toBeFalsy();

      tree.selectPath('/project/src');
      tree.toggle();

      expect(srcNode?.expanded).toBe(true);
    });

    test('toggle collapses expanded directory', () => {
      const srcNode = tree.findNode('/project/src');
      tree.selectPath('/project/src');
      tree.toggle(); // expand
      tree.toggle(); // collapse

      expect(srcNode?.expanded).toBe(false);
    });

    test('expand expands directory', () => {
      tree.selectPath('/project/src');
      tree.expand();

      const srcNode = tree.findNode('/project/src');
      expect(srcNode?.expanded).toBe(true);
    });

    test('collapse collapses directory', () => {
      tree.selectPath('/project/src');
      tree.toggle(); // expand
      tree.collapse();

      const srcNode = tree.findNode('/project/src');
      expect(srcNode?.expanded).toBe(false);
    });

    test('collapse on file goes to parent', () => {
      tree.selectPath('/project/src');
      tree.toggle(); // expand src
      tree.moveDown(); // select index.ts
      tree.collapse();

      // Should go back to parent src directory
      expect(tree.getSelectedPath()).toBe('/project/src');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Open
  // ─────────────────────────────────────────────────────────────────────────

  describe('open', () => {
    test('openSelected on directory toggles expand', () => {
      tree.selectPath('/project/src');
      tree.openSelected();

      const srcNode = tree.findNode('/project/src');
      expect(srcNode?.expanded).toBe(true);
    });

    test('openSelected on file calls onFileOpen', () => {
      let openedPath: string | null = null;
      const treeWithCallback = new FileTree('tree2', 'Explorer', ctx, {
        onFileOpen: (path) => {
          openedPath = path;
        },
      });
      treeWithCallback.setBounds({ x: 0, y: 0, width: 40, height: 20 });
      treeWithCallback.setRoots(createTestTree());

      // Expand src first
      treeWithCallback.selectPath('/project/src');
      treeWithCallback.toggle();

      // Select a file
      treeWithCallback.selectPath('/project/src/index.ts');
      treeWithCallback.openSelected();

      expect(openedPath).toBe('/project/src/index.ts');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('renders tree items', () => {
      const buffer = createScreenBuffer({ width: 40, height: 20 });
      tree.render(buffer);

      // Check for 'src' in first row
      let foundSrc = false;
      for (let x = 0; x < 40; x++) {
        if (buffer.get(x, 0)?.char === 's') {
          const next = buffer.get(x + 1, 0);
          if (next?.char === 'r') {
            foundSrc = true;
            break;
          }
        }
      }
      expect(foundSrc).toBe(true);
    });

    test('renders expander for directories', () => {
      const buffer = createScreenBuffer({ width: 40, height: 20 });
      tree.render(buffer);

      // Check for expander (▶ or ▼)
      let foundExpander = false;
      for (let x = 0; x < 20; x++) {
        const char = buffer.get(x, 0)?.char;
        if (char === '▶' || char === '▼') {
          foundExpander = true;
          break;
        }
      }
      expect(foundExpander).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    test('ArrowDown moves selection down', () => {
      tree.handleKey({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      expect(tree.getSelectedPath()).toBe('/project/tests');
    });

    test('ArrowUp moves selection up', () => {
      tree.handleKey({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      tree.handleKey({ key: 'ArrowUp', ctrl: false, alt: false, shift: false, meta: false });
      expect(tree.getSelectedPath()).toBe('/project/src');
    });

    test('Enter opens selected', () => {
      tree.selectPath('/project/src');
      tree.handleKey({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });

      const srcNode = tree.findNode('/project/src');
      expect(srcNode?.expanded).toBe(true);
    });

    test('ArrowRight expands directory', () => {
      tree.selectPath('/project/src');
      tree.handleKey({ key: 'ArrowRight', ctrl: false, alt: false, shift: false, meta: false });

      const srcNode = tree.findNode('/project/src');
      expect(srcNode?.expanded).toBe(true);
    });

    test('ArrowLeft collapses directory', () => {
      tree.selectPath('/project/src');
      tree.toggle(); // expand
      tree.handleKey({ key: 'ArrowLeft', ctrl: false, alt: false, shift: false, meta: false });

      const srcNode = tree.findNode('/project/src');
      expect(srcNode?.expanded).toBe(false);
    });

    test('Home goes to first item', () => {
      tree.moveDown();
      tree.moveDown();
      tree.handleKey({ key: 'Home', ctrl: false, alt: false, shift: false, meta: false });
      expect(tree.getSelectedPath()).toBe('/project/src');
    });

    test('End goes to last item', () => {
      tree.handleKey({ key: 'End', ctrl: false, alt: false, shift: false, meta: false });
      // Last item should be README.md (files sorted after directories)
      expect(tree.getSelectedPath()).toBe('/project/README.md');
    });

    test('vim keys work', () => {
      tree.handleKey({ key: 'j', ctrl: false, alt: false, shift: false, meta: false });
      expect(tree.getSelectedPath()).toBe('/project/tests');

      tree.handleKey({ key: 'k', ctrl: false, alt: false, shift: false, meta: false });
      expect(tree.getSelectedPath()).toBe('/project/src');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  describe('serialization', () => {
    test('getState returns state', () => {
      tree.selectPath('/project/src');
      tree.toggle(); // expand

      const state = tree.getState();

      expect(state.selectedPath).toBe('/project/src');
      expect(state.expandedPaths).toContain('/project/src');
    });

    test('setState restores state', () => {
      tree.setState({
        selectedPath: '/project/package.json',
        scrollTop: 0,
        expandedPaths: ['/project/src'],
      });

      expect(tree.getSelectedPath()).toBe('/project/package.json');

      const srcNode = tree.findNode('/project/src');
      expect(srcNode?.expanded).toBe(true);
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createFileTree', () => {
  test('creates file tree', () => {
    const ctx = createTestContext();
    const tree = createFileTree('tree1', 'Explorer', ctx);

    expect(tree).toBeInstanceOf(FileTree);
    expect(tree.id).toBe('tree1');
  });
});
