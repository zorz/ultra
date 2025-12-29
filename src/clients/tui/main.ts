#!/usr/bin/env bun
/**
 * Ultra TUI - New Terminal User Interface
 *
 * Entry point for the new TUI client.
 */

import * as path from 'path';
import * as fs from 'fs';
import { TUIClient, createTUIClient } from './client/tui-client.ts';
import { setDebugEnabled, debugLog } from '../../debug.ts';
import { isBundledBinary, ensurePtyAvailable } from '../../terminal/pty-loader.ts';

// Parse command line arguments
const args = process.argv.slice(2);

// Handle help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Ultra TUI - Terminal Code Editor (New UI)

Usage: bun src/clients/tui/main.ts [options] [file|folder]

Options:
  -h, --help              Show this help message
  --debug                 Enable debug logging to debug.log

Examples:
  bun src/clients/tui/main.ts             Open current directory
  bun src/clients/tui/main.ts src/        Open folder
  bun src/clients/tui/main.ts file.ts     Open file (uses parent dir as workspace)
  bun src/clients/tui/main.ts --debug     Open with debug logging

`);
  process.exit(0);
}

// Parse options
const debugMode = args.includes('--debug');

// Enable debug logging if requested
setDebugEnabled(debugMode);

// Filter out flags to get the path argument
const pathArg = args.filter((arg) => !arg.startsWith('-'))[0];

// Resolve working directory and initial file
let workingDirectory = process.cwd();
let initialFile: string | undefined;

if (pathArg) {
  // Expand ~ to home directory
  let expandedPath = pathArg;
  if (expandedPath.startsWith('~/')) {
    expandedPath = path.join(process.env.HOME || '', expandedPath.slice(2));
  } else if (expandedPath === '~') {
    expandedPath = process.env.HOME || '';
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(process.cwd(), expandedPath);

  try {
    const stat = fs.statSync(resolvedPath);

    if (stat.isDirectory()) {
      // It's a directory - use it as the working directory
      workingDirectory = resolvedPath;
    } else if (stat.isFile()) {
      // It's a file - use parent directory as working directory, open the file
      workingDirectory = path.dirname(resolvedPath);
      initialFile = resolvedPath;
    }
  } catch {
    // Path doesn't exist - check if it looks like a file (has extension)
    // If so, use parent directory. Otherwise treat as directory to create.
    if (path.extname(pathArg)) {
      // It's a new file - use parent directory as workspace
      const parentDir = path.dirname(resolvedPath);
      // Check if parent directory exists, otherwise use CWD
      try {
        const parentStat = fs.statSync(parentDir);
        if (parentStat.isDirectory()) {
          workingDirectory = parentDir;
          initialFile = resolvedPath;
        } else {
          // Parent isn't a directory, fall back to CWD
          workingDirectory = process.cwd();
          initialFile = resolvedPath;
        }
      } catch {
        // Parent doesn't exist either, use CWD and let the file be created
        workingDirectory = process.cwd();
        initialFile = resolvedPath;
      }
    } else {
      // Looks like a directory - check if it can be used or fall back to CWD
      try {
        // Try to create the directory
        fs.mkdirSync(resolvedPath, { recursive: true });
        workingDirectory = resolvedPath;
      } catch {
        // Can't create directory, fall back to CWD
        debugLog(`[TUI Main] Warning: Cannot create directory '${pathArg}', using current directory`);
        workingDirectory = process.cwd();
      }
    }
  }
}

// Create and start the TUI client
let client: TUIClient | null = null;

async function main(): Promise<void> {
  debugLog('[TUI Main] Starting Ultra TUI...');

  // In bundled binary mode, ensure PTY support is available
  if (isBundledBinary()) {
    debugLog('[TUI Main] Running as bundled binary, checking PTY support...');
    const ptyReady = await ensurePtyAvailable();
    if (!ptyReady) {
      console.log('Installing terminal support...');
      const success = await ensurePtyAvailable();
      if (!success) {
        console.error('Failed to install terminal support. Terminal panes will not work.');
        debugLog('[TUI Main] PTY installation failed');
      }
    }
    debugLog('[TUI Main] PTY support ready');
  }

  client = createTUIClient({
    workingDirectory,
    initialFile,
    debug: debugMode,
    onExit: () => {
      debugLog('[TUI Main] Client exited, terminating process');
      process.exit(0);
    },
  });

  await client.start();

  debugLog('[TUI Main] Ultra TUI started successfully');
}

// Handle graceful shutdown
function shutdown(): void {
  debugLog('[TUI Main] Shutting down...');

  if (client) {
    client.stop().then(() => {
      debugLog('[TUI Main] Shutdown complete');
      process.exit(0);
    }).catch((error) => {
      debugLog(`[TUI Main] Shutdown error: ${error}`);
      process.exit(1);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Global error handler
process.on('uncaughtException', (error: Error) => {
  const msg = `[CRASH] Uncaught Exception:\n${error.stack || error.message}`;
  debugLog(msg);
  if (debugMode) {
    console.error(msg);
  }

  // Try to cleanup before exiting
  if (client?.isRunning()) {
    client.stop().finally(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason: unknown) => {
  const msg = `[CRASH] Unhandled Rejection:\n${reason instanceof Error ? reason.stack : reason}`;
  debugLog(msg);
  if (debugMode) {
    console.error(msg);
  }

  // Try to cleanup before exiting
  if (client?.isRunning()) {
    client.stop().finally(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

// Start the application
main().catch((error) => {
  const msg = `[TUI Main] Fatal error: ${error}`;
  debugLog(msg);
  console.error(msg);
  process.exit(1);
});
