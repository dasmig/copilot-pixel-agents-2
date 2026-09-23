import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { AgentStore } from './agentStore.js';
import { BrowserOfficeHost } from './browserOffice.js';
import { createHookRequestHandler } from './hookHttp.js';

const DEFAULT_PORT = 7823;

export class HooksServer {
  private server: http.Server | null = null;
  private port: number;
  private readonly browserOffice: BrowserOfficeHost;

  constructor(
    private readonly store: AgentStore,
    private readonly channel: vscode.OutputChannel,
    port = DEFAULT_PORT,
    webRoot: string,
  ) {
    this.port = port;
    this.browserOffice = new BrowserOfficeHost(store, webRoot, () => this.port);
  }

  get activePort(): number {
    return this.port;
  }

  get browserUrl(): string {
    return this.browserOffice.url;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const handleHook = createHookRequestHandler(this.store, (metadata) => this.channel.appendLine(metadata));
      this.server = http.createServer((request, response) => {
        if (!this.browserOffice.handle(request, response)) handleHook(request, response);
      });
      this.server.requestTimeout = 10_000;
      this.server.headersTimeout = 10_000;

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Try next port
          this.port++;
          this.server!.listen(this.port, '127.0.0.1');
        } else {
          reject(err);
        }
      });

      this.server.on('listening', () => {
        const address = this.server!.address();
        if (address && typeof address !== 'string') this.port = address.port;
        console.log(`[Copilot Pixel Agents] Hooks server listening on port ${this.port}`);
        this.writePortFile(this.port);
        resolve(this.port);
      });

      this.server.listen(this.port, '127.0.0.1');
    });
  }

  private writePortFile(port: number): void {
    try {
      const dir = path.join(os.homedir(), '.copilot-pixel-agents');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'port'), String(port), 'utf8');
    } catch {
      // Non-fatal; hook.sh falls back to default port
    }
  }

  stop(): void {
    this.browserOffice.dispose();
    this.server?.close();
    this.server = null;
  }
}
