/**
 * Build script for Ultra editor
 * 
 * Handles bundling terminal-kit's dynamic dependencies
 */

import { $ } from "bun";

// Build with embedded files for terminal-kit's dynamic requires
await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'bun',
  // Don't minify to help with debugging
  minify: false,
});

// For standalone binary, we need to handle terminal-kit differently
// Since it uses dynamic requires, we'll need to keep node_modules available
// OR use a different terminal library

console.log("Build complete. For standalone binary with terminal-kit,");
console.log("you'll need node_modules at runtime, or run with:");
console.log("  bun run src/index.ts");
