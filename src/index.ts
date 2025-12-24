#!/usr/bin/env bun
/**
 * Ultra - Terminal Code Editor
 *
 * Entry point for the application.
 */

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
  --session <name>        Open a named session
  --save-session <name>   Save current session with a name on startup
  --no-session            Don't restore previous session

Examples:
  ultra                       Open Ultra with previous session (or empty)
  ultra file.ts               Open file.ts
  ultra src/                  Open folder
  ultra --session work        Open the "work" session
  ultra --no-session          Start fresh without restoring session
  ultra --debug file.ts       Open with debug logging

`);
  process.exit(0);
}

// Handle version flag
if (args.includes('--version') || args.includes('-v')) {
  console.log('Ultra v0.5.0');
  process.exit(0);
}

// Import and run the TUI
import('./clients/tui/main.ts').catch((error) => {
  console.error('Failed to load TUI:', error);
  process.exit(1);
});
