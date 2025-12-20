# TestECPClient Design

The `TestECPClient` is a test utility that simulates an ECP client, making it easy to send JSON-RPC requests and verify responses in tests.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      TestECPClient                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  - Maintains internal request ID counter                  │  │
│  │  - Wraps requests in JSON-RPC 2.0 format                  │  │
│  │  - Collects and exposes notifications                     │  │
│  │  - Manages service lifecycle                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    ECPRouter (real)                        │  │
│  │  Routes requests to service adapters                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐              │
│         ▼                    ▼                    ▼              │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐      │
│  │ Document    │      │    File     │      │    Git      │      │
│  │  Service    │      │   Service   │      │   Service   │      │
│  └─────────────┘      └─────────────┘      └─────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## Interface

```typescript
// tests/helpers/ecp-client.ts

interface TestECPClientOptions {
  /** Workspace root for file/git operations */
  workspaceRoot?: string;

  /** Services to initialize (default: all) */
  services?: ('document' | 'file' | 'git' | 'lsp' | 'session' | 'syntax')[];

  /** Custom service implementations for mocking */
  mocks?: {
    file?: FileService;
    git?: GitService;
    lsp?: LSPService;
    // etc.
  };

  /** Enable debug logging */
  debug?: boolean;
}

interface ECPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface ECPResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface ECPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

class TestECPClient {
  constructor(options?: TestECPClientOptions);

  /**
   * Send a request and wait for response.
   * Throws if response contains an error.
   */
  request<T = unknown>(method: string, params?: unknown): Promise<T>;

  /**
   * Send a request, returning full response including errors.
   * Does not throw on error responses.
   */
  requestRaw<T = unknown>(method: string, params?: unknown): Promise<ECPResponse<T>>;

  /**
   * Send a notification (no response expected).
   */
  notify(method: string, params?: unknown): void;

  /**
   * Get all notifications received since last clear.
   */
  getNotifications(): ECPNotification[];

  /**
   * Get notifications matching a method pattern.
   */
  getNotifications(methodPattern: string | RegExp): ECPNotification[];

  /**
   * Clear collected notifications.
   */
  clearNotifications(): void;

  /**
   * Wait for a specific notification to arrive.
   * Useful for async operations that emit notifications.
   */
  waitForNotification(
    methodPattern: string | RegExp,
    timeout?: number
  ): Promise<ECPNotification>;

  /**
   * Shutdown all services and cleanup.
   */
  shutdown(): Promise<void>;

  /**
   * Get the underlying service instance (for advanced testing).
   */
  getService<T>(name: 'document' | 'file' | 'git' | 'lsp' | 'session' | 'syntax'): T;
}
```

## Implementation Sketch

```typescript
// tests/helpers/ecp-client.ts

import { ECPRouter } from '@/ecp/router.ts';
import { LocalDocumentService } from '@/services/document/local.ts';
import { LocalFileService } from '@/services/file/local.ts';
import { GitCliService } from '@/services/git/cli.ts';
import { LocalLSPService } from '@/services/lsp/local.ts';
import { LocalSessionService } from '@/services/session/local.ts';
import { LocalSyntaxService } from '@/services/syntax/local.ts';

export class TestECPClient {
  private router: ECPRouter;
  private requestId = 0;
  private notifications: ECPNotification[] = [];
  private notificationListeners: Map<string, (n: ECPNotification) => void> = new Map();
  private services: Map<string, unknown> = new Map();

  constructor(options: TestECPClientOptions = {}) {
    // Initialize services
    const documentService = options.mocks?.document ?? new LocalDocumentService();
    const fileService = options.mocks?.file ?? new LocalFileService();
    const gitService = options.mocks?.git ?? new GitCliService(options.workspaceRoot);
    const lspService = options.mocks?.lsp ?? new LocalLSPService(options.workspaceRoot);
    const sessionService = options.mocks?.session ?? new LocalSessionService();
    const syntaxService = options.mocks?.syntax ?? new LocalSyntaxService();

    this.services.set('document', documentService);
    this.services.set('file', fileService);
    this.services.set('git', gitService);
    this.services.set('lsp', lspService);
    this.services.set('session', sessionService);
    this.services.set('syntax', syntaxService);

    // Create router with services
    this.router = new ECPRouter({
      document: documentService,
      file: fileService,
      git: gitService,
      lsp: lspService,
      session: sessionService,
      syntax: syntaxService,
    });

    // Collect notifications
    this.router.onNotification((notification) => {
      this.notifications.push(notification);

      // Check for waiting listeners
      for (const [pattern, resolve] of this.notificationListeners) {
        if (this.matchesPattern(notification.method, pattern)) {
          resolve(notification);
          this.notificationListeners.delete(pattern);
        }
      }
    });
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const response = await this.requestRaw<T>(method, params);

    if (response.error) {
      const error = new Error(`ECP Error: ${response.error.message}`);
      (error as any).code = response.error.code;
      (error as any).data = response.error.data;
      throw error;
    }

    return response.result as T;
  }

  async requestRaw<T = unknown>(method: string, params?: unknown): Promise<ECPResponse<T>> {
    const request: ECPRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    };

    const response = await this.router.handleRequest(request);
    return response as ECPResponse<T>;
  }

  notify(method: string, params?: unknown): void {
    const notification: ECPNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.router.handleNotification(notification);
  }

  getNotifications(methodPattern?: string | RegExp): ECPNotification[] {
    if (!methodPattern) return [...this.notifications];

    return this.notifications.filter((n) =>
      this.matchesPattern(n.method, methodPattern)
    );
  }

  clearNotifications(): void {
    this.notifications = [];
  }

  async waitForNotification(
    methodPattern: string | RegExp,
    timeout = 5000
  ): Promise<ECPNotification> {
    // Check if already received
    const existing = this.notifications.find((n) =>
      this.matchesPattern(n.method, methodPattern)
    );
    if (existing) return existing;

    // Wait for it
    return new Promise((resolve, reject) => {
      const patternKey = methodPattern.toString();

      const timeoutId = setTimeout(() => {
        this.notificationListeners.delete(patternKey);
        reject(new Error(`Timeout waiting for notification: ${methodPattern}`));
      }, timeout);

      this.notificationListeners.set(patternKey, (notification) => {
        clearTimeout(timeoutId);
        resolve(notification);
      });
    });
  }

  async shutdown(): Promise<void> {
    await this.router.shutdown();
  }

  getService<T>(name: string): T {
    return this.services.get(name) as T;
  }

  private matchesPattern(method: string, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return method === pattern || method.startsWith(pattern.replace('*', ''));
    }
    return pattern.test(method);
  }
}
```

## Usage Examples

### Basic Request/Response

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestECPClient } from '@test/ecp-client.ts';

describe('Document operations', () => {
  let client: TestECPClient;

  beforeEach(() => {
    client = new TestECPClient();
  });

  afterEach(async () => {
    await client.shutdown();
  });

  test('open and read document', async () => {
    const { documentId } = await client.request('document/open', {
      uri: 'memory://test.txt',
      content: 'Hello, World!'
    });

    const { content } = await client.request('document/content', { documentId });
    expect(content).toBe('Hello, World!');
  });
});
```

### Testing Error Responses

```typescript
test('returns error for invalid document', async () => {
  const response = await client.requestRaw('document/content', {
    documentId: 'nonexistent'
  });

  expect(response.error).toBeDefined();
  expect(response.error?.code).toBe(-32001); // DOCUMENT_NOT_FOUND
  expect(response.error?.message).toContain('not found');
});

// Or using expect().toThrow()
test('throws for invalid document', async () => {
  await expect(
    client.request('document/content', { documentId: 'nonexistent' })
  ).rejects.toThrow('not found');
});
```

### Testing Notifications

```typescript
test('emits didChange notification on edit', async () => {
  const { documentId } = await client.request('document/open', {
    uri: 'memory://test.txt',
    content: 'Hello'
  });

  client.clearNotifications();

  await client.request('document/insert', {
    documentId,
    position: { line: 0, column: 5 },
    text: ', World!'
  });

  const notifications = client.getNotifications('document/didChange');
  expect(notifications).toHaveLength(1);
  expect(notifications[0].params).toMatchObject({
    documentId,
    version: 2
  });
});
```

### Waiting for Async Notifications

```typescript
test('LSP publishes diagnostics', async () => {
  // Open a file with errors
  await client.request('document/open', {
    uri: workspace.fileUri('with-errors.ts'),
  });

  // Wait for LSP to analyze and send diagnostics
  const notification = await client.waitForNotification(
    'lsp/didPublishDiagnostics',
    10000 // LSP can be slow
  );

  expect(notification.params).toMatchObject({
    uri: expect.stringContaining('with-errors.ts'),
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ severity: 1 }) // Error
    ])
  });
});
```

### Using Mocks

```typescript
import { MockGitService } from '@test/mocks/git-service.ts';

test('handles git errors gracefully', async () => {
  const mockGit = new MockGitService();
  mockGit.setStatusResult({ error: 'Not a git repository' });

  const client = new TestECPClient({
    mocks: { git: mockGit }
  });

  const response = await client.requestRaw('git/status', {
    uri: 'file:///some/path'
  });

  expect(response.error).toBeDefined();
  expect(response.error?.code).toBe(-32002); // GIT_ERROR
});
```

### Accessing Services Directly

```typescript
test('buffer version increments correctly', async () => {
  const { documentId } = await client.request('document/open', {
    uri: 'memory://test.txt',
    content: 'Hello'
  });

  // Access the underlying service for detailed assertions
  const documentService = client.getService<DocumentService>('document');
  const doc = documentService.getDocument(documentId);

  expect(doc?.version).toBe(1);

  await client.request('document/insert', {
    documentId,
    position: { line: 0, column: 5 },
    text: '!'
  });

  expect(doc?.version).toBe(2);
});
```

## Testing with Real Services

For integration tests that need real file system or git:

```typescript
import { createTempWorkspace } from '@test/temp-workspace.ts';

describe('Git integration', () => {
  let client: TestECPClient;
  let workspace: TempWorkspace;

  beforeEach(async () => {
    // Create real temp directory with git repo
    workspace = await createTempWorkspace({ git: true });

    client = new TestECPClient({
      workspaceRoot: workspace.path
      // No mocks - uses real GitCliService
    });
  });

  afterEach(async () => {
    await client.shutdown();
    await workspace.cleanup();
  });

  test('real git operations', async () => {
    await workspace.writeFile('test.txt', 'content');

    const status = await client.request('git/status', {
      uri: workspace.rootUri
    });

    expect(status.untracked).toContain('test.txt');
  });
});
```

## Best Practices

1. **Always shutdown**: Call `client.shutdown()` in `afterEach` to cleanup services
2. **Clear notifications**: Call `clearNotifications()` before the action you're testing
3. **Use requestRaw for error tests**: Avoids try/catch boilerplate
4. **Prefer patterns over exact methods**: Use `'document/*'` over `'document/didChange'`
5. **Set reasonable timeouts**: LSP operations may need 5-10s in CI
6. **Use memory:// URIs for pure document tests**: Avoids file system
