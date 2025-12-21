#!/usr/bin/env bun
/**
 * Ultra - Terminal Code Editor
 *
 * Entry point for the application.
 */

import { app } from './app.ts';

// Parse command line arguments
const args = process.argv.slice(2);

// Handle help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Ultra - Terminal Code Editor

Usage: ultra [options] [file|folder]

Options:
  -h, --help              Show this help message
  -v, --version           Show version number
  --debug                 Enable debug logging to debug.log
  --new-tui               Use the new TUI (experimental)
  --session <name>        Open a named session
  --save-session <name>   Save current session with a name on startup
  --no-session            Don't restore previous session

Examples:
  ultra                       Open Ultra with previous session (or empty)
  ultra file.ts               Open file.ts
  ultra src/                  Open folder
  ultra --new-tui             Use the new TUI
  ultra --session work        Open the "work" session
  ultra --no-session          Start fresh without restoring session
  ultra --debug file.ts       Open with debug logging

`);
  process.exit(0);
}

// Handle version flag
if (args.includes('--version') || args.includes('-v')) {
  console.log('Ultra v0.1.0');
  process.exit(0);
}

// Parse options
const debugMode = args.includes('--debug');
const newTui = args.includes('--new-tui');
const noSession = args.includes('--no-session');

// Handle --new-tui flag: launch new TUI instead
if (newTui) {
  // Import and run the new TUI
  import('./clients/tui/main.ts').catch((error) => {
    console.error('Failed to load new TUI:', error);
    process.exit(1);
  });
  // Don't continue with old TUI setup
} else {

// Parse --session option
let sessionName: string | undefined;
const sessionIndex = args.indexOf('--session');
if (sessionIndex !== -1 && args[sessionIndex + 1]) {
  sessionName = args[sessionIndex + 1];
}

// Parse --save-session option
let saveSessionName: string | undefined;
const saveSessionIndex = args.indexOf('--save-session');
if (saveSessionIndex !== -1 && args[saveSessionIndex + 1]) {
  saveSessionName = args[saveSessionIndex + 1];
}

// Filter out flags and their values to get file paths
const flagsWithValues = ['--session', '--save-session'];
const filePath = args.filter((arg, i) => {
  if (arg.startsWith('-')) return false;
  // Check if previous arg was a flag that takes a value
  if (i > 0 && flagsWithValues.includes(args[i - 1]!)) return false;
  return true;
})[0];

// Global error handler - write to debug.log
const fs = require('fs');
process.on('uncaughtException', (error: Error) => {
  const msg = `[CRASH] Uncaught Exception:\n${error.stack || error.message}\n`;
  fs.appendFileSync('debug.log', msg);
  console.error(msg);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  const msg = `[CRASH] Unhandled Rejection:\n${reason?.stack || reason}\n`;
  fs.appendFileSync('debug.log', msg);
  console.error(msg);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  app.stop();
});

process.on('SIGTERM', () => {
  app.stop();
});

// Start the application
app.start(filePath, {
  debug: debugMode,
  sessionName,
  saveSessionName,
  noSession
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

} // End of else block for old TUI
