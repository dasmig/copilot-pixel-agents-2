import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { AgentStore } from './agentStore.js';
import { subscribeToAgentMessages } from './agentMessages.js';
import type { ServerMessage } from './types.js';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export class BrowserOfficeHost {
  private readonly basePath: string;
  private readonly clients = new Set<ServerResponse>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: AgentStore,
    private readonly webRoot: string,
    private readonly getPort: () => number,
    token = randomBytes(24).toString('hex'),
  ) {
    this.basePath = `/office/${encodeURIComponent(token)}/`;
    this.unsubscribe = subscribeToAgentMessages(store, (message) => this.broadcast(message));
  }

  get url(): string {
    return `http://127.0.0.1:${this.getPort()}${this.basePath}`;
  }

  handle(request: IncomingMessage, response: ServerResponse): boolean {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!requestUrl.pathname.startsWith(this.basePath)) return false;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      this.reply(response, 405, 'application/json', '{}');
      request.resume();
      return true;
    }

    const relativePath = requestUrl.pathname.slice(this.basePath.length);
    if (relativePath === '') {
      this.reply(response, 200, 'text/html; charset=utf-8', this.buildHtml(), request.method === 'HEAD');
      return true;
    }
    if (relativePath === 'events') {
      if (request.method === 'HEAD') {
        this.reply(response, 405, 'application/json', '{}');
      } else {
        this.openEventStream(request, response);
      }
      return true;
    }

    this.serveAsset(relativePath, response, request.method === 'HEAD');
    return true;
  }

  dispose(): void {
    this.unsubscribe();
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  private openEventStream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    response.write('retry: 2000\n\n');
    this.clients.add(response);
    this.send(response, { type: 'captureSettings', enabled: this.store.captureTaskDetails });
    this.send(response, { type: 'existingAgents', agents: this.store.getSnapshots() });
    this.send(response, { type: 'serverPort', port: this.getPort() });
    request.on('close', () => this.clients.delete(response));
  }

  private broadcast(message: ServerMessage): void {
    for (const client of this.clients) {
      if (client.destroyed || client.writableEnded) this.clients.delete(client);
      else this.send(client, message);
    }
  }

  private send(response: ServerResponse, message: ServerMessage): void {
    response.write(`data: ${JSON.stringify(message)}\n\n`);
  }

  private serveAsset(relativePath: string, response: ServerResponse, headOnly: boolean): void {
    if (relativePath !== 'main.js' && relativePath !== 'main.css' && !relativePath.startsWith('assets/')) {
      this.reply(response, 404, 'application/json', '{}');
      return;
    }

    const root = path.resolve(this.webRoot);
    const filePath = path.resolve(root, relativePath);
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      this.reply(response, 404, 'application/json', '{}');
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      this.reply(response, 404, 'application/json', '{}');
      return;
    }
    if (!stat.isFile()) {
      this.reply(response, 404, 'application/json', '{}');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': stat.size,
      'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    if (headOnly) response.end();
    else fs.createReadStream(filePath).pipe(response);
  }

  private reply(response: ServerResponse, status: number, contentType: string, body: string, headOnly = false): void {
    response.writeHead(status, {
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...(contentType.startsWith('text/html') ? {
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      } : {}),
    });
    response.end(headOnly ? undefined : body);
  }

  private buildHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="main.css" />
  <title>Copilot Pixel Agents</title>
</head>
<body>
  <div id="app"></div>
  <script src="main.js"></script>
</body>
</html>`;
  }
}