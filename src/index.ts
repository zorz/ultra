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

Usage: ultra [options] [file...]

Options:
  -h, --help      Show this help message
  -v, --version   Show version number

Examples:
  ultra                   Open Ultra with no file
  ultra file.ts           Open file.ts
  ultra src/              Open folder

`);
  process.exit(0);
}

// Handle version flag
if (args.includes('--version') || args.includes('-v')) {
  console.log('Ultra v0.1.0');
  process.exit(0);
}

// Filter out any remaining flags and get file paths
const filePath = args.filter(arg => !arg.startsWith('-'))[0];

// Handle graceful shutdown
process.on('SIGINT', () => {
  app.stop();
});

process.on('SIGTERM', () => {
  app.stop();
});

// Start the application
app.start(filePath).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
