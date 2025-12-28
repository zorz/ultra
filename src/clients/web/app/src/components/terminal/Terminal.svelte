<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal as XTerm } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { ecpClient } from '../../lib/ecp/client';
  import { themeStore } from '../../lib/stores/theme';
  import { toXtermTheme } from '../../lib/theme/loader';
  import '@xterm/xterm/css/xterm.css';

  let terminalContainer: HTMLDivElement;
  let xterm: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  let terminalId: string | null = null;
  let unsubscribeData: (() => void) | null = null;
  let unsubscribeExit: (() => void) | null = null;

  onMount(async () => {
    if (!terminalContainer) return;

    // Get theme for terminal
    const theme = $themeStore;
    const xtermTheme = theme ? toXtermTheme(theme) : undefined;

    // Create xterm instance
    xterm = new XTerm({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: xtermTheme as Record<string, string> | undefined,
      allowProposedApi: true,
    });

    // Add fit addon
    fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    // Open terminal in container
    xterm.open(terminalContainer);

    // Try to use WebGL for better performance
    try {
      const webglAddon = new WebglAddon();
      xterm.loadAddon(webglAddon);
    } catch {
      // WebGL not supported, fall back to canvas
    }

    // Fit terminal to container
    fitAddon.fit();

    // Create server-side terminal
    try {
      const result = await ecpClient.request<{ terminalId: string }>('terminal/create', {
        cols: xterm.cols,
        rows: xterm.rows,
      });

      terminalId = result.terminalId;

      // Subscribe to terminal data
      unsubscribeData = ecpClient.subscribe('terminal/data', (params: unknown) => {
        const { terminalId: tid, data } = params as { terminalId: string; data: string };
        if (tid === terminalId && xterm) {
          xterm.write(data);
        }
      });

      // Subscribe to terminal exit
      unsubscribeExit = ecpClient.subscribe('terminal/exit', (params: unknown) => {
        const { terminalId: tid, exitCode } = params as { terminalId: string; exitCode: number };
        if (tid === terminalId && xterm) {
          xterm.writeln(`\r\n[Process exited with code ${exitCode}]`);
        }
      });

      // Handle user input
      xterm.onData((data) => {
        if (terminalId) {
          ecpClient.request('terminal/write', { terminalId, data });
        }
      });

    } catch (error) {
      console.error('Failed to create terminal:', error);
      xterm?.writeln('\x1b[31mFailed to create terminal session\x1b[0m');
    }

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon && xterm) {
        fitAddon.fit();

        if (terminalId) {
          ecpClient.request('terminal/resize', {
            terminalId,
            cols: xterm.cols,
            rows: xterm.rows,
          });
        }
      }
    });

    resizeObserver.observe(terminalContainer);

    return () => {
      resizeObserver.disconnect();
    };
  });

  onDestroy(async () => {
    unsubscribeData?.();
    unsubscribeExit?.();

    if (terminalId) {
      try {
        await ecpClient.request('terminal/close', { terminalId });
      } catch {
        // Ignore errors on cleanup
      }
    }

    xterm?.dispose();
  });

  // Update theme when it changes
  $effect(() => {
    const theme = $themeStore;
    if (theme && xterm) {
      const xtermTheme = toXtermTheme(theme);
      xterm.options.theme = xtermTheme as Record<string, string>;
    }
  });
</script>

<div class="terminal-wrapper" bind:this={terminalContainer}></div>

<style>
  .terminal-wrapper {
    width: 100%;
    height: 100%;
    padding: 4px 8px;
    box-sizing: border-box;
    background-color: var(--terminal-bg, #1e1e1e);
  }

  .terminal-wrapper :global(.xterm) {
    height: 100%;
  }

  .terminal-wrapper :global(.xterm-viewport) {
    overflow-y: auto;
  }

  .terminal-wrapper :global(.xterm-viewport::-webkit-scrollbar) {
    width: 10px;
  }

  .terminal-wrapper :global(.xterm-viewport::-webkit-scrollbar-thumb) {
    background-color: var(--scrollbar-bg, #424242);
    border-radius: 5px;
  }

  .terminal-wrapper :global(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background-color: var(--scrollbar-hover-bg, #555);
  }
</style>
