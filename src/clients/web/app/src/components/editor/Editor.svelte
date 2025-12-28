<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as monaco from 'monaco-editor';
  import { documentsStore, activeDocument } from '../../lib/stores/documents';
  import { themeStore } from '../../lib/stores/theme';
  import { toMonacoTheme } from '../../lib/theme/loader';
  import { ecpClient } from '../../lib/ecp/client';

  interface Props {
    documentId: string;
  }

  let { documentId }: Props = $props();

  let editorContainer: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let model: monaco.editor.ITextModel | null = null;
  let isUpdating = false;

  // Initialize editor
  onMount(async () => {
    if (!editorContainer) return;

    // Get document content
    const doc = documentsStore.get(documentId);
    if (!doc) return;

    // Set up Monaco theme from Ultra theme
    const theme = $themeStore;
    if (theme) {
      const monacoTheme = toMonacoTheme(theme);
      monaco.editor.defineTheme('ultra-theme', monacoTheme as monaco.editor.IStandaloneThemeData);
      monaco.editor.setTheme('ultra-theme');
    }

    // Create model
    model = monaco.editor.createModel(
      doc.content,
      doc.language || 'plaintext',
      monaco.Uri.parse(doc.uri)
    );

    // Create editor
    editor = monaco.editor.create(editorContainer, {
      model,
      theme: 'ultra-theme',
      automaticLayout: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      fontLigatures: true,
      lineNumbers: 'on',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      renderWhitespace: 'selection',
      tabSize: 2,
      insertSpaces: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      smoothScrolling: true,
      padding: { top: 8 },
    });

    // Handle content changes
    model.onDidChangeContent((event) => {
      if (isUpdating) return;

      // Send changes to server
      for (const change of event.changes) {
        const startPos = model!.getPositionAt(change.rangeOffset);
        const endPos = model!.getPositionAt(change.rangeOffset + change.rangeLength);

        if (change.rangeLength > 0) {
          // Delete
          documentsStore.delete(documentId,
            { line: startPos.lineNumber - 1, column: startPos.column - 1 },
            { line: endPos.lineNumber - 1, column: endPos.column - 1 }
          );
        }

        if (change.text) {
          // Insert
          documentsStore.insert(documentId,
            { line: startPos.lineNumber - 1, column: startPos.column - 1 },
            change.text
          );
        }
      }
    });

    // Handle save command
    editor.addAction({
      id: 'ultra.save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: async () => {
        await documentsStore.save(documentId);
      },
    });

    // Subscribe to document changes from server
    const unsubscribe = ecpClient.subscribe('document/didChange', (params: unknown) => {
      const { documentId: changedDocId, changes } = params as {
        documentId: string;
        changes: Array<{
          range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
          text: string;
        }>;
      };

      if (changedDocId !== documentId || !model) return;

      isUpdating = true;
      const edits = changes.map((change) => ({
        range: new monaco.Range(
          change.range.startLine + 1,
          change.range.startColumn + 1,
          change.range.endLine + 1,
          change.range.endColumn + 1
        ),
        text: change.text,
      }));
      model.applyEdits(edits);
      isUpdating = false;
    });

    return () => {
      unsubscribe();
    };
  });

  // Cleanup
  onDestroy(() => {
    editor?.dispose();
    model?.dispose();
  });

  // Update content when documentId changes
  $effect(() => {
    if (!editor || !documentId) return;

    const doc = documentsStore.get(documentId);
    if (!doc) return;

    // Check if we need a new model
    if (model?.uri.toString() !== doc.uri) {
      model?.dispose();
      model = monaco.editor.createModel(
        doc.content,
        doc.language || 'plaintext',
        monaco.Uri.parse(doc.uri)
      );
      editor.setModel(model);
    }
  });
</script>

<div class="editor-container" bind:this={editorContainer}></div>

<style>
  .editor-container {
    width: 100%;
    height: 100%;
  }
</style>
