/**
 * IPC PTY Backend
 *
 * PTY backend that communicates with a child bun process running pty-bridge.ts.
 * This is used when running as a bundled binary where native modules can't be
 * loaded directly.
 */

import type {
  PTYBackend,
  PTYBackendOptions,
  TerminalCell,
  CursorPosition,
  Unsubscribe,
} from '../pty-backend.ts';
import { ScreenBuffer, AnsiParser } from '../screen-buffer.ts';
import { debugLog } from '../../debug.ts';
import { TIMEOUTS } from '../../constants.ts';

/**
 * IpcPtyBackend communicates with pty-bridge.ts via IPC.
 */
export class IpcPtyBackend implements PTYBackend {
  private process: ReturnType<typeof Bun.spawn> | null = null;
  private screenBuffer: ScreenBuffer;
  private ansiParser: AnsiParser;
  private _title: string = 'Terminal';
  private _cwd: string;
  private _cols: number;
  private _rows: number;
  private _running: boolean = false;
  private bridgePath: string;

  private shell: string;
  private args: string[];
  private env: Record<string, string>;

  // Pending RPC calls
  private nextId: number = 1;
  private pendingCalls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // Callback sets
  private dataCallbacks = new Set<(data: string) => void>();
  private updateCallbacks = new Set<() => void>();
  private exitCallbacks = new Set<(code: number) => void>();
  private titleCallbacks = new Set<(title: string) => void>();

  constructor(options: PTYBackendOptions = {}, bridgePath: string) {
    this._cols = options.cols ?? 80;
    this._rows = options.rows ?? 24;
    this._cwd = options.cwd ?? process.cwd();
    this.shell = options.shell ?? process.env.SHELL ?? '/bin/zsh';
    this.args = options.args ?? [];
    this.env = options.env ?? {};
    this.bridgePath = bridgePath;

    const scrollback = options.scrollback ?? 1000;
    this.screenBuffer = new ScreenBuffer(this._cols, this._rows, scrollback);
    this.ansiParser = new AnsiParser(this.screenBuffer);

    // Set up parser output callback for DSR responses
    this.ansiParser.onOutput((data: string) => {
      this.write(data);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IPC Communication
  // ─────────────────────────────────────────────────────────────────────────

  private send(msg: object): void {
    if (this.process?.stdin && typeof this.process.stdin !== 'number') {
      const stdin = this.process.stdin as {
        write(data: string | Uint8Array): number;
        flush(): void;
      };
      stdin.write(JSON.stringify(msg) + '\n');
      stdin.flush();
    }
  }

  private call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pendingCalls.set(id, { resolve, reject });
      this.send({ id, method, params });

      // Timeout after IPC_CALL timeout
      setTimeout(() => {
        if (this.pendingCalls.has(id)) {
          this.pendingCalls.delete(id);
          reject(new Error(`IPC call ${method} timed out`));
        }
      }, TIMEOUTS.IPC_CALL);
    });
  }

  private handleMessage(msg: {
    id?: number;
    result?: unknown;
    error?: string;
    event?: string;
    data?: unknown;
  }): void {
    // Handle RPC responses
    if (msg.id !== undefined) {
      const pending = this.pendingCalls.get(msg.id);
      if (pending) {
        this.pendingCalls.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Handle events
    switch (msg.event) {
      case 'data': {
        const data = msg.data as string;
        // Process through ANSI parser
        this.ansiParser.process(data);

        // Notify data callbacks
        for (const callback of this.dataCallbacks) {
          callback(data);
        }

        // Notify update callbacks
        for (const callback of this.updateCallbacks) {
          callback();
        }
        break;
      }

      case 'exit': {
        const code = msg.data as number;
        this._running = false;
        for (const callback of this.exitCallbacks) {
          callback(code);
        }
        break;
      }

      case 'ready':
        debugLog('[IpcPtyBackend] Bridge ready');
        break;

      case 'error':
        debugLog(`[IpcPtyBackend] Bridge error: ${msg.data}`);
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    debugLog(`[IpcPtyBackend] Starting bridge: ${this.bridgePath}`);

    // Spawn the bridge process
    // In bundled mode, we use Node.js because Bun's tty.ReadStream doesn't
    // properly emit data events from PTY file descriptors
    // In development mode, we use Bun with the TypeScript source
    const isBundled = this.bridgePath.endsWith('.mjs');
    const cmd = isBundled ? ['node', this.bridgePath] : ['bun', this.bridgePath];

    this.process = Bun.spawn(cmd, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Set up stdout line reader using Bun's native streams
    if (this.process.stdout && typeof this.process.stdout !== 'number') {
      const stdout = this.process.stdout as ReadableStream<Uint8Array>;
      this.readLines(stdout);
    }

    // Log stderr
    if (this.process.stderr && typeof this.process.stderr !== 'number') {
      const stderr = this.process.stderr as ReadableStream<Uint8Array>;
      this.readStderr(stderr);
    }

    // Wait for ready event (with timeout)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bridge startup timeout')), TIMEOUTS.IPC_BRIDGE_STARTUP);
      const checkReady = setInterval(() => {
        // The bridge sends 'ready' event which is handled in handleMessage
        // For simplicity, just wait a bit for the process to start
        clearInterval(checkReady);
        clearTimeout(timeout);
        resolve();
      }, TIMEOUTS.DB_POLL_INTERVAL);
    });

    // Spawn the PTY in the bridge
    await this.call('spawn', {
      shell: this.shell,
      args: this.args,
      cwd: this._cwd,
      env: this.env,
      cols: this._cols,
      rows: this._rows,
    });

    this._running = true;
    debugLog('[IpcPtyBackend] PTY started via bridge');
  }

  /**
   * Read lines from a ReadableStream and process JSON messages.
   */
  private async readLines(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.trim()) {
            try {
              const msg = JSON.parse(line);
              this.handleMessage(msg);
            } catch (e) {
              debugLog(`[IpcPtyBackend] Invalid message: ${line}`);
            }
          }
        }
      }
    } catch (e) {
      debugLog(`[IpcPtyBackend] Stream read error: ${e}`);
    }
  }

  /**
   * Read and log stderr.
   */
  private async readStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        debugLog(`[IpcPtyBackend] Bridge stderr: ${decoder.decode(value)}`);
      }
    } catch (e) {
      // Stream closed, ignore
    }
  }

  write(data: string): void {
    // Fire and forget - don't wait for response
    this.send({ method: 'write', params: { data } });
  }

  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.screenBuffer.resize(cols, rows);
    this.send({ method: 'resize', params: { cols, rows } });
  }

  kill(): void {
    this.send({ method: 'kill' });
    this._running = false;

    // Kill the bridge process
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  isRunning(): boolean {
    return this._running;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Screen Buffer
  // ─────────────────────────────────────────────────────────────────────────

  getBuffer(): TerminalCell[][] {
    return this.screenBuffer.getBuffer();
  }

  getCursor(): CursorPosition {
    return this.screenBuffer.getCursor();
  }

  isCursorVisible(): boolean {
    return this.screenBuffer.isCursorVisible();
  }

  getViewOffset(): number {
    return this.screenBuffer.getViewOffset();
  }

  getTotalLines(): number {
    return this.screenBuffer.getTotalLines();
  }

  scrollViewUp(lines: number): boolean {
    return this.screenBuffer.scrollViewUp(lines);
  }

  scrollViewDown(lines: number): boolean {
    return this.screenBuffer.scrollViewDown(lines);
  }

  resetViewOffset(): void {
    this.screenBuffer.resetViewOffset();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Callbacks
  // ─────────────────────────────────────────────────────────────────────────

  onData(callback: (data: string) => void): Unsubscribe {
    this.dataCallbacks.add(callback);
    return () => {
      this.dataCallbacks.delete(callback);
    };
  }

  onUpdate(callback: () => void): Unsubscribe {
    this.updateCallbacks.add(callback);
    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  onExit(callback: (code: number) => void): Unsubscribe {
    this.exitCallbacks.add(callback);
    return () => {
      this.exitCallbacks.delete(callback);
    };
  }

  onTitle(callback: (title: string) => void): Unsubscribe {
    this.titleCallbacks.add(callback);
    return () => {
      this.titleCallbacks.delete(callback);
    };
  }

  onNotification(callback: (message: string) => void): Unsubscribe {
    this.ansiParser.onNotification(callback);
    return () => {
      this.ansiParser.onNotification(() => {});
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────

  getCwd(): string | null {
    return this._cwd;
  }

  getTitle(): string {
    return this._title;
  }

  getSize(): { cols: number; rows: number } {
    return { cols: this._cols, rows: this._rows };
  }
}

/**
 * Create an IpcPtyBackend instance.
 */
export function createIpcPtyBackend(options: PTYBackendOptions = {}, bridgePath: string): PTYBackend {
  return new IpcPtyBackend(options, bridgePath);
}
