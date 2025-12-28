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
  --gui                   Launch web GUI instead of TUI
  --gui-port <port>       Port for web GUI server (default: 7890)
  --gui-dev               Run web GUI in development mode
  --session <name>        Open a named session
  --save-session <name>   Save current session with a name on startup
  --no-session            Don't restore previous session

Examples:
  ultra                       Open Ultra with previous session (or empty)
  ultra file.ts               Open file.ts
  ultra src/                  Open folder
  ultra --gui                 Open web GUI in browser
  ultra --gui --gui-port 8080 Open web GUI on custom port
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

// Handle GUI mode
if (args.includes('--gui')) {
  // Get optional port
  const portIndex = args.indexOf('--gui-port');
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : undefined;

  // Check for dev mode
  const devMode = args.includes('--gui-dev');

  // Import and start the web server
  import('./clients/web/server/index.ts')
    .then(async ({ startWebServer }) => {
      const server = await startWebServer({
        port,
        devMode,
        openBrowser: true,
        workspaceRoot: process.cwd(),
      });

      console.log(`Ultra Web GUI running at http://localhost:${server.port}`);
      console.log('Press Ctrl+C to stop the server');

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down...');
        server.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        server.stop();
        process.exit(0);
      });
    })
    .catch((error) => {
      console.error('Failed to start web GUI:', error);
      process.exit(1);
    });
} else {
  // Import and run the TUI
  import('./clients/tui/main.ts').catch((error) => {
    console.error('Failed to load TUI:', error);
    process.exit(1);
  });
}
