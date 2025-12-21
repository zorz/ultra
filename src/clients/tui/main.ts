#!/usr/bin/env bun
/**
 * Ultra TUI - New Terminal User Interface
 *
 * Entry point for the new TUI client.
 */

import { TUIClient, createTUIClient } from './client/tui-client.ts';
import { setDebugEnabled, debugLog } from '../../debug.ts';

// Parse command line arguments
const args = process.argv.slice(2);

// Handle help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Ultra TUI - Terminal Code Editor (New UI)

Usage: bun src/clients/tui/main.ts [options] [folder]

Options:
  -h, --help              Show this help message
  --debug                 Enable debug logging to debug.log

Examples:
  bun src/clients/tui/main.ts             Open current directory
  bun src/clients/tui/main.ts src/        Open folder
  bun src/clients/tui/main.ts --debug     Open with debug logging

`);
  process.exit(0);
}

// Parse options
const debugMode = args.includes('--debug');

// Enable debug logging if requested
setDebugEnabled(debugMode);

// Filter out flags to get folder path
const folderPath = args.filter((arg) => !arg.startsWith('-'))[0];

// Create and start the TUI client
let client: TUIClient | null = null;

async function main(): Promise<void> {
  debugLog('[TUI Main] Starting Ultra TUI...');

  client = createTUIClient({
    workingDirectory: folderPath ?? process.cwd(),
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
