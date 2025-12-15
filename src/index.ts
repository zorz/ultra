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
  --debug         Enable LSP debug logging to debug.log

Examples:
  ultra                   Open Ultra with no file
  ultra file.ts           Open file.ts
  ultra src/              Open folder
  ultra --debug file.ts   Open with debug logging

`);
  process.exit(0);
}

// Handle version flag
if (args.includes('--version') || args.includes('-v')) {
  console.log('Ultra v0.1.0');
  process.exit(0);
}

// Check for debug flag
const debugMode = args.includes('--debug');

// Filter out any remaining flags and get file paths
const filePath = args.filter(arg => !arg.startsWith('-'))[0];

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
app.start(filePath, { debug: debugMode }).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
