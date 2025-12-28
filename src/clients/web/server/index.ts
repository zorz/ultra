/**
 * Ultra Web GUI Server
 *
 * Bun-based HTTP/WebSocket server for the web GUI client.
 * Serves static files and provides WebSocket connection to ECP server.
 */

import { debugLog } from '../../../debug.ts';
import { createECPServer } from '../../../ecp/server.ts';
import { WebSocketTransport, type WebSocketTransportConfig } from './ws-transport.ts';

interface WebServerConfig {
  /** Port to listen on (default: 7890) */
  port?: number;
  /** Host to bind to (default: localhost) */
  host?: string;
  /** Open browser automatically */
  openBrowser?: boolean;
  /** Development mode (proxy to Vite) */
  devMode?: boolean;
  /** Vite dev server port (default: 5173) */
  vitePort?: number;
  /** Workspace root directory */
  workspaceRoot?: string;
  /** WebSocket transport config */
  wsConfig?: WebSocketTransportConfig;
}

interface ClientData {
  clientId: string;
}

const DEFAULT_PORT = 7890;
const DEFAULT_HOST = 'localhost';
const VITE_DEV_PORT = 5173;

function log(msg: string): void {
  debugLog(`[WebServer] ${msg}`);
}

/**
 * Start the Ultra Web GUI server.
 */
export async function startWebServer(config: WebServerConfig = {}): Promise<{
  port: number;
  stop: () => void;
}> {
  const port = config.port ?? DEFAULT_PORT;
  const host = config.host ?? DEFAULT_HOST;
  const devMode = config.devMode ?? false;
  const vitePort = config.vitePort ?? VITE_DEV_PORT;
  const workspaceRoot = config.workspaceRoot ?? process.cwd();

  // Create ECP server
  const ecpServer = createECPServer({ workspaceRoot });
  await ecpServer.initialize();

  // Create WebSocket transport
  const wsTransport = new WebSocketTransport(ecpServer, config.wsConfig);

  // Get static file path
  // When running from source: use import.meta.url
  // When running from compiled binary: use path relative to cwd or executable
  let distPath: string;
  let publicPath: string;

  // Try multiple locations for the dist folder
  const possibleDistPaths = [
    // Relative to source (for bun run dev)
    new URL('../app/dist', import.meta.url).pathname,
    // Relative to cwd (for compiled binary running from project root)
    `${process.cwd()}/src/clients/web/app/dist`,
    // Relative to executable location
    `${import.meta.dir}/../app/dist`,
  ];

  const possiblePublicPaths = [
    new URL('../app/public', import.meta.url).pathname,
    `${process.cwd()}/src/clients/web/app/public`,
    `${import.meta.dir}/../app/public`,
  ];

  // Find the first path that exists
  distPath = possibleDistPaths[0];
  publicPath = possiblePublicPaths[0];

  for (const p of possibleDistPaths) {
    try {
      const file = Bun.file(`${p}/index.html`);
      if (await file.exists()) {
        distPath = p;
        break;
      }
    } catch {
      // Path doesn't exist, try next
    }
  }

  for (const p of possiblePublicPaths) {
    try {
      const file = Bun.file(`${p}/favicon.svg`);
      if (await file.exists()) {
        publicPath = p;
        break;
      }
    } catch {
      // Path doesn't exist, try next
    }
  }

  log(`Serving static files from: ${distPath}`);

  // Create Bun server
  const server = Bun.serve<ClientData>({
    port,
    hostname: host,

    async fetch(req, server) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // WebSocket upgrade
      if (pathname === '/ws' || pathname === '/ecp') {
        const clientId = crypto.randomUUID();
        const success = server.upgrade(req, {
          data: { clientId },
        });
        if (success) {
          return undefined;
        }
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      // In dev mode, proxy to Vite
      if (devMode) {
        try {
          const viteUrl = `http://localhost:${vitePort}${pathname}${url.search}`;
          const viteRes = await fetch(viteUrl, {
            method: req.method,
            headers: req.headers,
            body: req.body,
          });
          return new Response(viteRes.body, {
            status: viteRes.status,
            headers: viteRes.headers,
          });
        } catch (error) {
          log(`Vite proxy error: ${error}`);
          return new Response(
            'Vite dev server not running. Start it with: cd src/clients/web/app && bun run dev',
            { status: 502 }
          );
        }
      }

      // Serve static files from dist
      if (pathname === '/' || pathname === '/index.html') {
        const file = Bun.file(`${distPath}/index.html`);
        if (await file.exists()) {
          return new Response(file, {
            headers: { 'Content-Type': 'text/html' },
          });
        }
        // Fallback to public folder during development
        const publicFile = Bun.file(`${publicPath}/index.html`);
        if (await publicFile.exists()) {
          return new Response(publicFile, {
            headers: { 'Content-Type': 'text/html' },
          });
        }
      }

      // Try to serve from dist
      const distFile = Bun.file(`${distPath}${pathname}`);
      if (await distFile.exists()) {
        return new Response(distFile);
      }

      // Try to serve from public
      const publicFile = Bun.file(`${publicPath}${pathname}`);
      if (await publicFile.exists()) {
        return new Response(publicFile);
      }

      // SPA fallback: serve index.html for all unmatched routes
      const indexFile = Bun.file(`${distPath}/index.html`);
      if (await indexFile.exists()) {
        return new Response(indexFile, {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      return new Response('Not Found', { status: 404 });
    },

    websocket: {
      open(ws) {
        wsTransport.handleOpen(ws);
      },
      message(ws, message) {
        wsTransport.handleMessage(ws, message);
      },
      close(ws) {
        wsTransport.handleClose(ws);
      },
    },

    error(error) {
      log(`Server error: ${error}`);
      return new Response('Internal Server Error', { status: 500 });
    },
  });

  log(`Server running at http://${host}:${port}`);
  log(`WebSocket endpoint: ws://${host}:${port}/ws`);
  if (devMode) {
    log(`Development mode: proxying to Vite at http://localhost:${vitePort}`);
  }

  // Open browser if requested
  if (config.openBrowser) {
    const url = `http://${host}:${port}`;
    openInBrowser(url);
  }

  // Return control object
  return {
    port: server.port,
    stop: () => {
      log('Stopping server...');
      wsTransport.disconnectAll();
      ecpServer.shutdown();
      server.stop();
      log('Server stopped');
    },
  };
}

/**
 * Open URL in default browser.
 */
async function openInBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    // Linux and others
    command = `xdg-open "${url}"`;
  }

  try {
    const proc = Bun.spawn(['sh', '-c', command], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await proc.exited;
    log(`Opened browser at ${url}`);
  } catch (error) {
    log(`Failed to open browser: ${error}`);
  }
}

// Export for direct execution
export default startWebServer;
